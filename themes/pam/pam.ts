// Port of keiyoushi/extensions-source lib-multisrc/pam/Pam.kt and Dto.kt
import {
  Base64,
  DateTimeFormatter,
  GET,
  HttpSource,
  Intl,
  Locale,
  MangasPage,
  POST,
  Page,
  Response,
  SChapter,
  SManga,
  SwitchPreferenceCompat,
  ZoneOffset,
  concat,
  substringBefore,
  toHex,
  toHttpUrl,
  utf8,
  type ClientBuilder,
  type FilterList,
  type HttpUrl,
  type PreferenceScreen,
  type Request,
} from "../../sdk/index.ts";
import { CheckBoxGroup, SortFilter, TriStateGroupFilter } from "./filters.ts";
import { messages } from "./messages.ts";
import { SecretStream, State, X25519 } from "./secretstream.ts";

// Dto.kt
interface Version {
  version: string;
}
interface BrowseManga {
  slug: string;
  title?: string;
  name?: string; // @JsonNames("name")
  image?: string | null;
  cover_image?: string | null; // @JsonNames("cover_image")
}
interface LibraryResponse {
  series: { data: BrowseManga[]; meta?: { current_page: number; last_page: number } | null };
}
interface SearchResponse {
  data: BrowseManga[];
}
interface MangaDto {
  slug: string;
  title?: string;
  name?: string;
  image?: string | null;
  cover_image?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  name_alternative?: string | null;
  release_year?: number | null;
  status?: string | null;
  type?: { name: string } | null;
  genres: { name: string }[];
  chapters: { slug: string; title: string; createdAt: string; isPremium: boolean }[];
}
interface MangaResponse {
  props: { serie: MangaDto };
}
interface Attestation {
  challenge: string;
  webgl_seed: string;
}
interface PageListResponse {
  component: string;
  version: string;
  props: {
    page_count?: number;
    chapter_token?: string | null;
    server_pubkey: string;
    reader_v2?: boolean;
    attestation?: Attestation | null;
    data: { uid: string; slug: string; serie: { slug: string } };
  };
}
interface AttestationReload {
  props: { chapter_token?: string | null; attestation?: Attestation | null };
}
interface AttestationResponse {
  ct?: string | null;
}
interface ManifestResponse {
  base: string;
  hint: string;
  count: number;
  variants?: number[];
}

const toSManga = (m: BrowseManga, createThumbnailUrl: (p: string | null | undefined) => string | null) => {
  const manga = SManga.create();
  manga.url = m.slug;
  manga.title = m.title ?? m.name ?? "";
  manga.thumbnail_url = createThumbnailUrl(m.image ?? m.cover_image) ?? undefined;
  return manga;
};

const THUMBNAIL_FRAGMENT = "thumbnail";
const ATTESTATION_ATTEMPTS = 3;
const MANIFEST_VERSION = 2;
const ECE_KEY_INFO = utf8("Content-Encoding: aes128gcm\u0000");
const ECE_NONCE_INFO = utf8("Content-Encoding: nonce\u0000");
const HIDE_PREMIUM_PREF = "pref_hide_premium_chapters";
const CHUNK_SIZE = 65536 + 17; // libsodium secretstream chunk + ABYTES
const PREFIX_LENGTH = 192;
const STREAM_HEADER_LENGTH = 24;

const subtle = globalThis.crypto.subtle;
const sha256 = async (...parts: Uint8Array[]) => new Uint8Array(await subtle.digest("SHA-256", concat(...parts) as BufferSource));
async function hmacSha256(key: Uint8Array, ...msg: Uint8Array[]): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, concat(...msg) as BufferSource));
}
const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const fragmentOf = (url: string) => {
  const i = url.indexOf("#");
  return i < 0 ? null : decodeURIComponent(url.slice(i + 1));
};

class ChapterSession {
  constructor(
    readonly chapterToken: string,
    readonly sharedSecret: Uint8Array,
    readonly clientPubkeyB64: string,
    /** Reader v2 only: input keying material for this chapter's encrypted pages. */
    readonly contentKey: Uint8Array | null = null,
  ) {}
}

class ChapterState {
  constructor(
    readonly session: ChapterSession,
    readonly manifest: ManifestResponse | null,
  ) {}
}

export abstract class Pam extends HttpSource {
  protected readonly baseHttpUrl: HttpUrl = toHttpUrl(this.baseUrl);

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "fr"], messages });

  private xsrfCookie(): string | null {
    const it = this.client.cookieJar.loadForRequest(this.baseHttpUrl.toString()).find((c) => c.name === "XSRF-TOKEN");
    return it ? decodeURIComponent(it.value) : null;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor((chain) => this.imageInterceptor(chain.request(), chain.proceed))
      .rateLimit(1, 2000, (url) => url.hash.slice(1) !== THUMBNAIL_FRAGMENT);
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Origin", `https://${this.baseHttpUrl.host}`);
    h.set("Referer", `${this.baseUrl}/`);
    return h;
  }

  private version: string | null = null;
  private csrfToken: string | null = null;
  private apiLock: Promise<unknown> = Promise.resolve();

  /** @Synchronized upstream: calls are serialised so only one of them reloads the tokens. */
  private apiRequest(url: HttpUrl, body: string | null, includeXSRFToken: boolean, includeCSRFToken: boolean, includeVersion: boolean): Promise<Request> {
    const run = this.apiLock.then(() => this.apiRequestLocked(url, body, includeXSRFToken, includeCSRFToken, includeVersion));
    this.apiLock = run.catch(() => undefined);
    return run;
  }

  private async apiRequestLocked(url: HttpUrl, body: string | null, includeXSRFToken: boolean, includeCSRFToken: boolean, includeVersion: boolean): Promise<Request> {
    let xsrfToken = this.xsrfCookie();

    if ((includeXSRFToken && xsrfToken == null) || (includeCSRFToken && this.csrfToken == null) || (includeVersion && this.version == null)) {
      const it = await this.client.execute(GET(this.baseHttpUrl, this.headers));
      if (!it.isSuccessful) throw new Error(`HTTP Error ${it.code}`);
      const document = it.asJsoup();

      this.version = (JSON.parse(document.selectFirst("#app")!.attr("data-page")) as Version).version;
      this.csrfToken = document.selectFirst("meta[name=csrf-token]")!.attr("content");
      xsrfToken = this.xsrfCookie();
      if (xsrfToken == null) throw new Error("XSRF-TOKEN cookie not found");
    }

    const headers = this.headersBuilder();
    headers.set("Accept", "application/json");
    headers.set("X-Requested-With", "XMLHttpRequest");
    if (includeVersion) {
      headers.set("X-Inertia", "true");
      headers.set("X-Inertia-Version", this.version!);
    }
    if (includeXSRFToken) headers.set("X-XSRF-TOKEN", xsrfToken!);
    if (includeCSRFToken) headers.set("X-CSRF-TOKEN", this.csrfToken!);

    return body != null ? POST(url.toString(), headers, body, "application/json; charset=utf-8") : GET(url, headers);
  }

  protected popularMangaRequest(page: number) {
    return this.searchMangaRequest(page, "", this.popularFilters);
  }

  protected popularMangaParse(response: Response) {
    return this.searchMangaParse(response);
  }

  protected latestUpdatesRequest(page: number) {
    return this.searchMangaRequest(page, "", this.latestFilters);
  }

  protected latestUpdatesParse(response: Response) {
    return this.searchMangaParse(response);
  }

  protected abstract readonly popularFilters: FilterList;
  protected abstract readonly latestFilters: FilterList;

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Promise<Request> {
    if (query !== "") {
      const url = this.baseHttpUrl.newBuilder().addPathSegments("api/v1/search/series").addQueryParameter("q", query).build();
      return this.apiRequest(url, null, true, false, false);
    }

    const url = this.baseHttpUrl.newBuilder();
    url.addPathSegment("library");
    if (page > 1) url.addQueryParameter("page", String(page));

    for (const group of filters) {
      if (!(group instanceof TriStateGroupFilter)) continue;
      switch (group.name) {
        case "Genres":
        case "Genres/Thèmes":
          if (group.included.length) url.addQueryParameter("include_genres", group.included.join(","));
          if (group.excluded.length) url.addQueryParameter("exclude_genres", group.excluded.join(","));
          break;
        case "Types":
          if (group.included.length) url.addQueryParameter("include_types", group.included.join(","));
          if (group.excluded.length) url.addQueryParameter("exclude_types", group.excluded.join(","));
          break;
      }
    }

    const status = filters.find((it) => it instanceof CheckBoxGroup) as CheckBoxGroup | undefined;
    if (status && status.checked.length) url.addQueryParameter("status", status.checked.join(","));
    const sort = filters.find((it) => it instanceof SortFilter) as SortFilter | undefined;
    if (sort) {
      url.addQueryParameter("orderby", sort.sort);
      if (sort.ascending) url.addQueryParameter("order", "asc");
    }

    return this.apiRequest(url.build(), null, true, false, false);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const thumb = (p: string | null | undefined) => this.createThumbnailUrl(p);
    if (toHttpUrl(response.url).queryParameter("q") != null) {
      const data = response.parseAs<SearchResponse>().data;
      return new MangasPage(
        data.map((it) => toSManga(it, thumb)),
        false,
      );
    }
    const data = response.parseAs<LibraryResponse>().series;
    return new MangasPage(
      data.data.map((it) => toSManga(it, thumb)),
      data.meta ? data.meta.current_page < data.meta.last_page : false,
    );
  }

  override mangaDetailsRequest(manga: SManga): Promise<Request> {
    return this.apiRequest(toHttpUrl(`${this.baseUrl}/serie/${manga.url}`), null, true, false, true);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/serie/${manga.url}`;
  }

  /** Upstream derives it from pageListRequest; that builder is async here, the URL is the same. */
  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  protected mangaDetailsParse(response: Response): SManga {
    const data = response.parseAs<MangaResponse>().props.serie;
    const manga = SManga.create();
    manga.url = data.slug;
    manga.title = data.title ?? data.name ?? "";
    manga.thumbnail_url = this.createThumbnailUrl(data.image ?? data.cover_image) ?? undefined;
    manga.author = data.author ?? undefined;
    manga.artist = data.artist ?? undefined;
    let description = "";
    if (data.description != null) description += `${data.description.trim()}\n\n`;
    if (data.release_year != null) description += `${this.intl.get("release_year")}: ${data.release_year}\n\n`;
    if (data.name_alternative != null) description += `${this.intl.get("alternative_names")}: ${data.name_alternative}`;
    manga.description = description.trim();
    manga.genre = [...(data.type?.name != null ? [data.type.name] : []), ...data.genres.map((it) => it.name)].join(", ");
    switch (data.status?.toLowerCase()) {
      case "ongoing":
      case "upcoming":
        manga.status = SManga.ONGOING;
        break;
      case "finished":
        manga.status = SManga.COMPLETED;
        break;
      case "dropped":
        manga.status = SManga.CANCELLED;
        break;
      case "onhold":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  protected createThumbnailUrl(imagePath: string | null | undefined): string | null {
    if (imagePath == null) return null;
    return `${this.baseUrl}${imagePath}#${THUMBNAIL_FRAGMENT}`;
  }

  protected override chapterListRequest(manga: SManga) {
    return this.mangaDetailsRequest(manga);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const data = response.parseAs<MangaResponse>().props.serie;
    const hidePremium = this.preferences.getBoolean(HIDE_PREMIUM_PREF, false);
    return data.chapters
      .filter((it) => !(it.isPremium && hidePremium))
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = `/serie/${data.slug}/chapter/${it.slug}`;
        chapter.name = (it.isPremium ? "🔒 " : "") + it.title;
        chapter.date_upload = this.dateFormat.tryParseDateTime(substringBefore(it.createdAt, "."), ZoneOffset.UTC);
        return chapter;
      })
      .reverse();
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = HIDE_PREMIUM_PREF;
    pref.title = this.intl.get("pref_hide_premium_title");
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }

  protected override pageListRequest(chapter: SChapter): Promise<Request> {
    return this.apiRequest(toHttpUrl(`${this.baseUrl}${chapter.url}`), null, true, false, true);
  }

  /**
   * Baked into the reader's WASM signer, and rebuilt per site: the attestation endpoint answers a wrong secret with
   * an endless `refresh` rather than an error, so a site whose values are not known here can never mint a chapter
   * token. See upstream's IMPLEMENT.md for how to recover them from a site's signer.
   */
  protected abstract readonly readerSecret: Uint8Array;

  protected abstract readonly kdfDomain: string;

  /** Where readerSecret sits relative to the bytes signed by the attestation and manifest HMACs. */
  protected abstract signedPayload(payload: Uint8Array): Uint8Array;

  /** Field order of the manifest signature payload. */
  protected abstract manifestPayload(uid: string, version: number, ts: number, nonce: string): string;

  /** Order in which readerSecret, the ECDH secret and the KDF info feed each page-key round. */
  protected abstract contentKeyMaterial(sharedSecret: Uint8Array, info: Uint8Array): Uint8Array[];

  /** How many times the page-key digest is folded over itself before unmasking the hint. */
  protected abstract readonly contentKeyRounds: number;

  private readonly sessions = new Map<string, ChapterSession>();
  private readonly sessionLocks = new Map<string, Promise<ChapterSession>>();

  private sessionKey(serieSlug: string, chapterSlug: string) {
    return `${this.name.slice(0, 3).toLowerCase()}-${serieSlug}--${chapterSlug}`;
  }

  private async openChapter(body: PageListResponse): Promise<ChapterState> {
    const props = body.props;
    const serverPub = Base64.decode(props.server_pubkey);
    if (serverPub.length !== 32) throw new Error("server pubkey must be 32 bytes");

    const priv = randomBytes(32);
    const clientPub = X25519.publicKey(priv);
    const shared = X25519.scalarMult(priv, serverPub);
    priv.fill(0);
    const clientPubkeyB64 = Base64.encode(clientPub);

    if (!props.reader_v2) {
      const token = props.chapter_token;
      if (token == null) throw new Error("Chapter token missing");
      return new ChapterState(new ChapterSession(token, shared, clientPubkeyB64), null);
    }

    const token = await this.attest(body, clientPubkeyB64);
    const manifest = await this.requestManifest(props.data.uid, token, clientPubkeyB64);
    return new ChapterState(new ChapterSession(token, shared, clientPubkeyB64, await this.contentKey(manifest, shared)), manifest);
  }

  /**
   * Reader v2 mints the chapter token from an attestation exchange instead of shipping it in the page props. The
   * first exchange is always answered with `refresh`, which retires the challenge embedded in the page: only the
   * challenge handed back by the partial reload gets a token.
   */
  private async attest(body: PageListResponse, clientPubkeyB64: string): Promise<string> {
    const attestation = body.props.attestation;
    if (attestation == null) throw new Error("Missing attestation challenge");
    const device = await this.deviceReport(attestation.webgl_seed);
    let challenge = attestation.challenge;

    for (let i = 0; i < ATTESTATION_ATTEMPTS; i++) {
      const request = {
        c: challenge,
        v: await this.hmacSha256Hex(device, utf8(challenge)),
        sp: await this.hmacSha256Hex(challenge, this.signedPayload(utf8(`${device}\u0000${clientPubkeyB64}`))),
        d: device,
        pk: clientPubkeyB64,
      };
      const minted = (await this.client.execute(await this.apiRequest(toHttpUrl(`${this.baseUrl}/api/v1/t`), JSON.stringify(request), true, false, false))).parseAs<AttestationResponse>().ct;
      if (minted != null) return minted;

      const reloaded = (await this.client.execute(this.attestationReloadRequest(body))).parseAs<AttestationReload>().props;
      if (reloaded.chapter_token != null) return reloaded.chapter_token;
      const next = reloaded.attestation?.challenge;
      if (next == null) throw new Error("Attestation refused");
      challenge = next;
    }
    throw new Error("Attestation refused");
  }

  private attestationReloadRequest(body: PageListResponse): Request {
    const url = toHttpUrl(`${this.baseUrl}/serie/${body.props.data.serie.slug}/chapter/${body.props.data.slug}`);
    const headers = this.headersBuilder();
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("X-Inertia", "true");
    headers.set("X-Inertia-Version", body.version);
    headers.set("X-Inertia-Partial-Component", body.component);
    headers.set("X-Inertia-Partial-Data", "chapter_token,attestation");
    return GET(url, headers);
  }

  /**
   * Stands in for the browser fingerprint the site collects through canvas and WebGL. The server only checks that
   * it matches the HMAC we send alongside it, so a fixed plausible report is enough.
   */
  private async deviceReport(webglSeed: string): Promise<string> {
    return (
      `{"webdriver":false,"webgl_vendor":"Qualcomm","webgl_renderer":"Adreno (TM) 730",` +
      `"webgl_proof":"${await this.sha256Hex("webgl_proof")}","gl_sig":"8192|1|1|23",` +
      `"device_memory":null,"hardware_concurrency":8,"effective_type":null,"save_data":false,` +
      `"screen_width":1080,"screen_height":2340,"viewport_width":1080,"viewport_height":2130,` +
      `"device_pixel_ratio":2.75,"max_touch_points":5,"has_touch":true,` +
      `"locale":"en-US","timezone":"America/New_York","platform":"Linux armv8l",` +
      `"canvas_hash":"${await this.sha256Hex(webglSeed)}"}`
    );
  }

  private async requestManifest(uid: string, chapterToken: string, clientPubkeyB64: string): Promise<ManifestResponse> {
    const ts = Math.floor(Date.now() / 1000);
    const nonce = this.hexNonce();
    const request = {
      v: MANIFEST_VERSION,
      c: uid,
      t: chapterToken,
      ts,
      n: nonce,
      s: await this.hmacSha256Hex(chapterToken, this.signedPayload(utf8(this.manifestPayload(uid, MANIFEST_VERSION, ts, nonce)))),
    };
    const call = await this.apiRequest(toHttpUrl(`${this.baseUrl}/api/v1/m`), JSON.stringify(request), true, false, false);
    call.headers.set("X-Client-Pubkey", clientPubkeyB64);
    return (await this.client.execute(call)).parseAs<ManifestResponse>();
  }

  /** The manifest hint is the page key masked with a digest chain over the ECDH secret, worthless to any other session. */
  private async contentKey(manifest: ManifestResponse, sharedSecret: Uint8Array): Promise<Uint8Array> {
    const segments = manifest.base.split("/").filter((it) => it !== "");
    if (!(segments.length >= 4 && segments[0] === "p")) throw new Error(`unexpected manifest base: ${manifest.base}`);

    const info = utf8(`${this.kdfDomain}|${segments[1]}|${segments[2]}`);
    let folded = new Uint8Array(0);
    const material = this.contentKeyMaterial(sharedSecret, info);
    for (let i = 0; i < this.contentKeyRounds; i++) folded = await sha256(folded, ...material);

    const hint = Base64.decode(manifest.hint);
    return Uint8Array.from({ length: 32 }, (_, i) => folded[i] ^ hint[i]);
  }

  private ensureSession(serieSlug: string, chapterSlug: string): Promise<ChapterSession> {
    const id = this.sessionKey(serieSlug, chapterSlug);
    const existing = this.sessions.get(id);
    if (existing) return Promise.resolve(existing);
    const pending = this.sessionLocks.get(id);
    if (pending) return pending;

    const run = (async () => {
      const url = toHttpUrl(`${this.baseUrl}/serie/${serieSlug}/chapter/${chapterSlug}`);
      const resp = await this.client.execute(await this.apiRequest(url, null, true, false, true));
      if (!resp.isSuccessful) throw new Error(`Could not rebuild chapter session: HTTP ${resp.code}`);
      const sess = (await this.openChapter(resp.parseAs<PageListResponse>())).session;
      this.sessions.set(id, sess);
      return sess;
    })().finally(() => this.sessionLocks.delete(id));
    this.sessionLocks.set(id, run);
    return run;
  }

  protected async pageListParse(response: Response): Promise<Page[]> {
    const body = response.parseAs<PageListResponse>();
    const props = body.props;
    const id = this.sessionKey(props.data.serie.slug, props.data.slug);
    const state = await this.openChapter(body);
    this.sessions.set(id, state.session);

    const manifest = state.manifest;
    if (manifest == null) {
      return Array.from(
        { length: props.page_count ?? 0 },
        (_, i) => new Page(i, `${id}#${i + 1}`, `${this.baseUrl}/serie/${props.data.serie.slug}/chapter/${props.data.slug}/page/${i + 1}#${id}`),
      );
    }

    const variants = manifest.variants ?? [];
    const variant = variants.length ? `-${Math.max(...variants)}` : "";
    return Array.from({ length: manifest.count }, (_, i) => new Page(i, `${id}#${i + 1}`, `${this.baseUrl}${manifest.base}${i + 1}${variant}.ece#${id}`));
  }

  private hexNonce(byteCount = 16): string {
    return toHex(randomBytes(byteCount));
  }

  private async hmacSha256Hex(key: string, msg: string | Uint8Array): Promise<string> {
    return toHex(await hmacSha256(utf8(key), typeof msg === "string" ? utf8(msg) : msg));
  }

  private async sha256Hex(value: string): Promise<string> {
    return toHex(await sha256(utf8(value)));
  }

  /** imageRequest upstream; async here (it may rebuild the chapter session), so getImage is overridden instead. */
  protected async pageImageRequest(page: Page): Promise<Request> {
    const parsed = toHttpUrl(page.imageUrl!);
    if (parsed.encodedPath.endsWith(".ece")) return GET(parsed, this.headers);

    const seg = parsed.pathSegments;
    if (!(seg.length >= 6 && seg[0] === "serie" && seg[2] === "chapter" && seg[4] === "page")) throw new Error(`unexpected page URL shape: ${parsed.encodedPath}`);
    const serieSlug = seg[1];
    const chapterSlug = seg[3];
    const pageIndex = parseInt(seg[5], 10);

    const session = await this.ensureSession(serieSlug, chapterSlug);
    const sessionId = this.sessionKey(serieSlug, chapterSlug);

    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = this.hexNonce();
    const sig = await this.hmacSha256Hex(session.chapterToken, `${pageIndex}${ts}${nonce}`);

    const url = this.baseHttpUrl
      .newBuilder()
      .addPathSegment("serie")
      .addPathSegment(serieSlug)
      .addPathSegment("chapter")
      .addPathSegment(chapterSlug)
      .addPathSegment("page")
      .addPathSegment(String(pageIndex))
      .addQueryParameter("token", session.chapterToken)
      .addQueryParameter("ts", ts)
      .addQueryParameter("nonce", nonce)
      .addQueryParameter("sig", sig)
      .fragment(sessionId)
      .build();

    const h = this.headersBuilder();
    h.set("X-Client-Pubkey", session.clientPubkeyB64);
    return GET(url, h);
  }

  override async getImage(page: Page): Promise<Response> {
    return this.executeSuccess(await this.pageImageRequest(page));
  }

  private withBody(response: Response, body: Uint8Array, contentType: string): Response {
    return new Response(this.host, { status: response.code, url: response.url, headers: { "content-type": contentType }, body });
  }

  private async imageInterceptor(request: Request, proceed: (r: Request) => Promise<Response>): Promise<Response> {
    const response = await proceed(request);

    const sessionId = fragmentOf(request.url);
    if (sessionId == null) return response;
    const session = this.sessions.get(sessionId);
    if (!session) return response;

    if (session.contentKey != null) {
      if (!response.isSuccessful) return response;
      return this.withBody(response, await this.decryptEce(response.bytes(), session.contentKey), "image/webp");
    }

    const pageNameRaw = response.header("X-Page-Name");
    if (pageNameRaw == null) return response;
    const keyHintB64 = response.header("X-Key-Hint");
    if (keyHintB64 == null) return response;
    const keyHint = Base64.decode(keyHintB64);
    if (keyHint.length < 32) throw new Error("X-Key-Hint must decode to >= 32 bytes");

    const sha = await sha256(session.sharedSecret, utf8(pageNameRaw));
    const streamKey = Uint8Array.from({ length: 32 }, (_, i) => sha[i] ^ keyHint[i]);

    // Upstream decrypts while streaming; the body is fully buffered here, so the chunks are sliced from it.
    const raw = response.bytes();
    const ssHeader = raw.subarray(PREFIX_LENGTH, PREFIX_LENGTH + STREAM_HEADER_LENGTH);
    const secretStream = new SecretStream();
    const state = new State();
    secretStream.initPull(state, ssHeader, streamKey);
    const out: Uint8Array[] = [];
    for (let pos = PREFIX_LENGTH + STREAM_HEADER_LENGTH; pos < raw.length; pos += CHUNK_SIZE) {
      const result = secretStream.pull(state, raw.subarray(pos, pos + CHUNK_SIZE));
      if (result == null) throw new Error("Decryption failed");
      out.push(result.message);
      if (result.tag === SecretStream.TAG_FINAL) break;
    }
    return this.withBody(response, concat(...out), "image/jpg");
  }

  /** RFC 8188 `aes128gcm`, the container reader v2 serves its pages in. */
  private async decryptEce(payload: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
    if (payload.length < 21) throw new Error("ece: payload shorter than the header");

    const salt = payload.slice(0, 16);
    const recordSize = new DataView(payload.buffer, payload.byteOffset + 16, 4).getInt32(0);
    let pos = 21 + payload[20];
    if (!(recordSize >= 18 && pos < payload.length)) throw new Error("ece: malformed header");

    const key = await subtle.importKey("raw", (await this.hkdf(ikm, salt, ECE_KEY_INFO, 16)) as BufferSource, "AES-GCM", false, ["decrypt"]);
    const nonce = await this.hkdf(ikm, salt, ECE_NONCE_INFO, 12);
    const out: Uint8Array[] = [];
    let sequence = 0;

    while (pos < payload.length) {
      const record = payload.subarray(pos, Math.min(pos + recordSize, payload.length));
      pos += record.length;
      if (record.length < 18) throw new Error(`ece: record ${sequence} too short`);

      const iv = nonce.slice();
      let counter = sequence;
      for (let i = 11; i >= 0; i--) {
        if (counter === 0) break;
        iv[i] ^= counter & 0xff;
        counter >>>= 8;
      }

      const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 }, key, record as BufferSource));

      // Records are zero-padded up to a delimiter byte: 2 on the last one, 1 elsewhere.
      let last = plain.length - 1;
      while (last >= 0 && plain[last] === 0) last--;
      const isFinal = pos >= payload.length;
      if (!(last >= 0 && plain[last] === (isFinal ? 2 : 1))) throw new Error(`ece: record ${sequence} has the wrong delimiter`);

      out.push(plain.subarray(0, last));
      sequence++;
    }
    return concat(...out);
  }

  private async hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const prk = await hmacSha256(salt, ikm);
    return (await hmacSha256(prk, info, Uint8Array.of(1))).slice(0, length);
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("Not used");
  }
}
