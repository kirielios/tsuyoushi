// Port of keiyoushi/extensions-source src/all/mangaup/MangaUp.kt (+ Dto.kt, ImageInterceptor.kt)
//
// Not ported: the WebView parts. getLocalStorage(baseUrl, "secret") reads the login token from a WebView and
// rejectSecret() clears it there; without a WebView only the "Secret Token" preference is used.
import {
  DateTimeFormatter,
  EditTextPreference,
  Filter,
  FilterList,
  HttpException,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  ZoneId,
  aesCbcDecrypt,
  decodeProto,
  firstInstance,
  substringAfterLast,
  toHttpUrl,
  type Chain,
  type ClientBuilder,
  type HttpUrl,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type ProtoSchema,
  type Response,
} from "../../../sdk/index.ts";

// --- Dto.kt (proto schemas: field number -> [name, type, repeated])
interface MangaTitle {
  id: number;
  name: string;
  thumbnail?: string;
  bookmarks?: number;
  lastUpdated?: string;
}
const MangaTitleSchema: ProtoSchema = { 1: ["id", "int"], 2: ["name", "string"], 3: ["thumbnail", "string"], 7: ["bookmarks", "int"], 9: ["lastUpdated", "string"] };

interface SeriesResponse {
  titles: MangaTitle[];
}
const SeriesResponseSchema: ProtoSchema = { 2: ["titles", MangaTitleSchema, true] };

interface SearchResponse {
  titles: MangaTitle[];
}
const SearchResponseSchema: ProtoSchema = { 1: ["titles", MangaTitleSchema, true] };

interface MyPageResponse {
  favorites: MangaTitle[];
  history: MangaTitle[];
}
const MyPageResponseSchema: ProtoSchema = { 1: ["favorites", MangaTitleSchema, true], 2: ["history", MangaTitleSchema, true] };

interface MangaChapter {
  id: number;
  name: string;
  subtitle?: string;
  price?: number;
  dateStr?: string;
  isFinal?: boolean;
}
interface MangaDetailResponse {
  title: string;
  author?: string;
  copyright?: string;
  schedule?: string;
  warning?: string;
  description?: string;
  tags: { name: string }[];
  thumbnail?: string;
  chapters: MangaChapter[];
}
const MangaDetailResponseSchema: ProtoSchema = {
  3: ["title", "string"],
  4: ["author", "string"],
  5: ["copyright", "string"],
  6: ["schedule", "string"],
  7: ["warning", "string"],
  8: ["description", "string"],
  10: ["tags", { 2: ["name", "string"] }, true],
  11: ["thumbnail", "string"],
  13: ["chapters", { 1: ["id", "int"], 2: ["name", "string"], 3: ["subtitle", "string"], 6: ["price", "int"], 9: ["dateStr", "string"], 12: ["isFinal", "bool"] }, true],
};

interface ViewerResponse {
  pageBlocks: { chapterId?: number; pages: { url: string; key?: string; iv?: string }[] }[];
}
const ViewerResponseSchema: ProtoSchema = { 3: ["pageBlocks", { 1: ["chapterId", "int"], 3: ["pages", { 1: ["url", "string"], 5: ["key", "string"], 6: ["iv", "string"] }, true] }, true] };

const dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.US).withZone(ZoneId.of("Asia/Tokyo"));

// Kotlin's `String + String?` prints "null" for a missing value
const concat = (a: string, b: string | undefined | null) => `${a}${b ?? "null"}`;

const updatedAt = (t: MangaTitle) => dateFormat.tryParseDate(t.lastUpdated);

function titleToSManga(t: MangaTitle, imgUrl: string): SManga {
  const m = SManga.create();
  m.url = String(t.id);
  m.title = t.name;
  m.thumbnail_url = concat(imgUrl, t.thumbnail);
  return m;
}

function detailToSManga(r: MangaDetailResponse, mangaId: string, imgUrl: string): SManga {
  const m = SManga.create();
  m.url = mangaId;
  m.title = r.title;
  m.author = r.author;
  let description = "";
  if (r.description) description += r.description;
  if (r.copyright) description += `\n\n${r.copyright}`;
  if (r.schedule) description += `\n\n${r.schedule}`;
  if (r.warning) description += `\n\n${r.warning}`;
  m.description = description;
  m.genre = r.tags.map((it) => it.name).join(", ");
  m.thumbnail_url = concat(imgUrl, r.thumbnail);
  m.status = r.chapters.some((it) => it.isFinal === true) ? SManga.COMPLETED : SManga.ONGOING;
  return m;
}

function chapterToSChapter(c: MangaChapter, mangaId: string): SChapter {
  const ch = SChapter.create();
  ch.url = String(c.id);
  let title = c.name + (c.subtitle != null ? ` - ${c.subtitle}` : "");
  if (c.isFinal === true) title += " [Final]";
  ch.name = c.price != null ? `🔒 ${title}` : title;
  ch.date_upload = dateFormat.tryParseDate(c.dateStr);
  ch.memo = { titleId: mangaId };
  return ch;
}

/** keiyoushi's String.decodeHex(): even length, hex digits only. */
function decodeHex(s: string): Uint8Array {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error(`Invalid hex: ${s}`);
  return Uint8Array.from(s.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
}

const HIDE_PAID_PREF = "hide_paid_chapters";
const SECRET_PREF = "secret_token";
const FAVORITES = "favorites";
const HISTORY = "history";

class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

export default class MangaUp extends KeiSource {
  private readonly domain = "manga-up.com";
  private get apiUrl() {
    return `https://global-api.${this.domain}/api`;
  }
  private get imgUrl() {
    return `https://global-img.${this.domain}`;
  }
  private get manualSecret(): string {
    return this.preferences.getString(SECRET_PREF, "")!;
  }

  private secret: string | null = null;
  private rejectedSecret: string | null = null;

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor((chain) => this.imageIntercept(chain));
  }

  // ImageInterceptor.kt
  private async imageIntercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    const response = await chain.proceed(request);
    const fragment = new URL(request.url).hash.replace(/^#/, "");

    if (!fragment || !fragment.includes(":") || !response.isSuccessful) return response;

    const [key, iv] = fragment.split(":");
    return response.withBody(await aesCbcDecrypt(decodeHex(key), decodeHex(iv), response.bytes()));
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/search`).newBuilder()).addQueryParameter("lang", this.lang).build();

    const result = decodeProto<SeriesResponse>((await this.apiRequest(url)).bytes(), SeriesResponseSchema);
    const mangas = [...result.titles].sort((a, b) => (b.bookmarks ?? 0) - (a.bookmarks ?? 0)).map((it) => titleToSManga(it, this.imgUrl));

    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/search`).newBuilder()).addQueryParameter("lang", this.lang).build();

    const result = decodeProto<SeriesResponse>((await this.apiRequest(url)).bytes(), SeriesResponseSchema);
    const mangas = [...result.titles].sort((a, b) => updatedAt(b) - updatedAt(a)).map((it) => titleToSManga(it, this.imgUrl));

    return new MangasPage(mangas, false);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genre = firstInstance(filters, SelectFilter).value;
    if (query.trim() !== "") {
      const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/manga/search`).newBuilder()).addQueryParameter("word", query).addQueryParameter("lang", this.lang).build();

      const result = decodeProto<SearchResponse>((await this.apiRequest(url)).bytes(), SearchResponseSchema);
      return new MangasPage(result.titles.map((it) => titleToSManga(it, this.imgUrl)), false);
    }

    if (genre === FAVORITES || genre === HISTORY) {
      if (this.getSecret() == null) throw new Error(`Log in via WebView to access your ${genre}.`);

      const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/my_page`).newBuilder()).addQueryParameter("lang", this.lang).build();

      const result = decodeProto<MyPageResponse>((await this.apiRequest(url)).bytes(), MyPageResponseSchema);
      const titles = genre === FAVORITES ? result.favorites : result.history;
      return new MangasPage(titles.map((it) => titleToSManga(it, this.imgUrl)), false);
    }

    if (genre.length === 0) return this.getPopularManga(page);

    const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/manga/tag`).newBuilder()).addQueryParameter("tag_id", genre).addQueryParameter("lang", this.lang).build();

    const result = decodeProto<SearchResponse>((await this.apiRequest(url)).bytes(), SearchResponseSchema);
    return new MangasPage(result.titles.map((it) => titleToSManga(it, this.imgUrl)), false);
  }

  protected override async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url = toHttpUrl(u.href);
    const host = toHttpUrl(this.baseUrl).host;
    if (url.host !== host && url.host !== `www.${host}`) throw new Error("Unsupported URL");
    const titleId = url.pathSegments[1];
    if (titleId === undefined) return null;
    const manga = SManga.create();
    manga.url = titleId;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${substringAfterLast(manga.url, "/")}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const hidePaid = this.preferences.getBoolean(HIDE_PAID_PREF, false);
    const titleId = substringAfterLast(manga.url, "/"); // for old url compatibility
    const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/manga/detail_v2`).newBuilder())
      .addQueryParameter("title_id", titleId)
      .addQueryParameter("quality", "high")
      .addQueryParameter("ui_lang", this.lang)
      .build();

    const result = decodeProto<MangaDetailResponse>((await this.apiRequest(url)).bytes(), MangaDetailResponseSchema);
    return new SMangaUpdate(
      detailToSManga(result, titleId, this.imgUrl),
      result.chapters.filter((it) => !hidePaid || it.price == null).map((it) => chapterToSChapter(it, titleId)),
    );
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/manga/${String(chapter.memo.titleId)}/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = this.addCommonParameters(toHttpUrl(`${this.apiUrl}/manga/viewer_v2`).newBuilder())
      .addQueryParameter("chapter_id", chapter.url)
      .addQueryParameter("quality", "high")
      .addQueryParameter("lang", this.lang)
      .build();

    const result = decodeProto<ViewerResponse>((await this.apiRequest(url, true)).bytes(), ViewerResponseSchema);

    const pages = result.pageBlocks.find((it) => it.chapterId === Number.parseInt(chapter.url, 10))?.pages.filter((it) => !it.url.includes("tutorial"));

    if (!pages || pages.length === 0) throw new Error("Log in via WebView and purchase this chapter to read.");

    return pages.map((page, i) => new Page(i, "", `${this.imgUrl}${page.url}#${page.key ?? "null"}:${page.iv ?? "null"}`));
  }

  private addCommonParameters(b: HttpUrlBuilder): HttpUrlBuilder {
    b.addQueryParameter("app_ver", "0");
    b.addQueryParameter("os_ver", "0");
    const secret = this.getSecret();
    if (secret != null) b.addQueryParameter("secret", secret);
    return b;
  }

  private async apiRequest(url: HttpUrl, post = false): Promise<Response> {
    const response = post ? await this.client.post(url.toString(), undefined, new Uint8Array(0), { ensureSuccess: false }) : await this.client.get(url.toString(), undefined, { ensureSuccess: false });
    if (response.isSuccessful) return response;

    const secret = url.queryParameter("secret");
    if (secret != null) {
      switch (response.code) {
        // malformed secret
        case 500:
          if (secret === this.manualSecret) throw new Error("Invalid Secret");
          break;
        // invalid secret -> login was aborted; UA mismatch from previous login
        case 401: {
          this.rejectSecret(secret);
          const newSecret = this.getSecret();
          const retry = url.newBuilder();
          if (newSecret != null) retry.setQueryParameter("secret", newSecret);
          else retry.removeAllQueryParameters("secret");
          return this.apiRequest(retry.build(), post);
        }
      }
    }
    throw new HttpException(response.code, response.url);
  }

  // Upstream serialises these under a Mutex because getLocalStorage awaits a WebView; here they are synchronous.
  private getSecret(): string | null {
    const manual = this.manualSecret;
    if (manual.trim() !== "") return manual !== this.rejectedSecret ? manual : null;

    // ponytail: no WebView, so the secret WebView login stored in localStorage cannot be read; add a host API if the app gets one
    return this.secret;
  }

  private rejectSecret(failed: string) {
    this.rejectedSecret = failed;
    if (this.secret === failed) this.secret = null;
    // upstream also removes the secret from the WebView's localStorage (runWebView), not available here
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new SelectFilter("Genres", [
        ["All", ""],
        ["Action", "13"],
        ["Adventure", "14"],
        ["Comedy", "15"],
        ["School Life", "16"],
        ["Dark Fantasy", "17"],
        ["Suspense", "18"],
        ["Historical", "19"],
        ["Game", "20"],
        ["Media Tie-ins", "21"],
        ["LGBTQ+", "253"],
        ["Completed", "256"],
        ["Own History", HISTORY],
        ["Own Favorites", FAVORITES],
      ]),
    );
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const hide = new SwitchPreferenceCompat(screen.context);
    hide.key = HIDE_PAID_PREF;
    hide.title = "Hide Locked Chapters";
    hide.summary = "Hide chapters that require points to unlock.";
    hide.setDefaultValue(false);
    screen.addPreference(hide);

    // upstream's setOnBindEditTextListener makes the input a password field; the app renders its own text input
    const secret = new EditTextPreference(screen.context);
    secret.key = SECRET_PREF;
    secret.title = "Secret Token";
    secret.summary = "Paste your token here to log in with it directly.\nLeave empty to log in through WebView.";
    screen.addPreference(secret);
  }
}
