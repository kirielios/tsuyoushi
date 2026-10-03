// Port of keiyoushi/extensions-source src/en/emaqi/Emaqi.kt
import {
  Base64,
  EditTextPreference,
  FilterList,
  HttpException,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  aesCbcDecrypt,
  firstInstanceOrNull,
  graphQLBody,
  hexBytes,
  parseGraphQLAs,
  str,
  toHex,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { GenreFilter, GenreModeFilter } from "./filters.ts";
import { CHAPTER_QUERY, COMIC_QUERY, SEARCH_QUERY, SERIES_QUERY, VOLUME_QUERY } from "./queries.ts";

// ============================== Dto.kt ==============================
interface SeriesResponse {
  homeSection: { mangaConn: MangaConn };
}
interface MangaConn {
  edges: { node: { comic: Comic } }[];
  pageInfo: { hasNextPage: boolean; endCursor: string };
}
interface Comic {
  comicId: string;
  slug: string;
  title: string;
  cover?: { url?: string | null } | null;
}
interface SearchResponse {
  search: Comic[];
}
interface ComicDataResponse {
  comicVolumes: { comic: ComicDetails; volumes: Volume[] };
  chapters: Chapter[];
}
interface ComicDetails {
  slug: string;
  title: string;
  synopsis?: string | null;
  rating?: number | null;
  creators?: string[] | null;
  publisher?: string | null;
  completed?: boolean | null;
  cover?: { url?: string | null } | null;
  genres?: { name: string }[] | null;
}
interface Chapter {
  comicId: string;
  chapterNumber: number;
  name: string;
  purchased?: boolean | null;
  free?: boolean | null;
  releasesAt?: string | null;
}
interface Volume {
  comicId: string;
  volumeNumber: number;
  eisbn?: string | null;
  slug: string;
  name: string;
  trialPage?: number | null;
  purchased?: boolean | null;
  free?: boolean | null;
  releasesAt?: string | null;
}
/** @JsonNames("manga") val chapter */
interface ViewerResponse {
  chapter?: Viewer;
  manga?: Viewer;
}
interface Viewer {
  contents?: { pages: { url: string }[]; hash: string } | null;
}
/** @JsonNames("id_token") / @JsonNames("refresh_token") */
interface LoginResponse {
  idToken?: string;
  id_token?: string;
  refreshToken?: string;
  refresh_token?: string;
}

function comicToSManga(c: Comic): SManga {
  const manga = SManga.create();
  manga.url = c.comicId;
  manga.title = c.title;
  manga.thumbnail_url = c.cover?.url ?? undefined;
  manga.memo = { slug: c.slug };
  return manga;
}

function comicDetailsToSManga(c: ComicDetails): SManga {
  const manga = SManga.create();
  manga.title = c.title;
  manga.author = c.creators?.join(", ");
  let description = "";
  if (c.synopsis != null) description += c.synopsis;
  if (c.publisher) description += `\n\nPublisher: ${c.publisher}`;
  if (c.rating != null) description += `\n\nAge limit: ${c.rating}+`;
  manga.description = description;
  manga.genre = c.genres?.map((it) => it.name).join(", ");
  manga.status = c.completed === true ? SManga.COMPLETED : SManga.ONGOING;
  manga.thumbnail_url = c.cover?.url ?? undefined;
  manga.memo = { slug: c.slug };
  return manga;
}

const isLocked = (it: { purchased?: boolean | null; free?: boolean | null }) => it.purchased === false && it.free === false;

function chapterToSChapter(c: Chapter, comicSlug: string): SChapter {
  const chapter = SChapter.create();
  const lock = isLocked(c) ? "🔒 " : "";
  chapter.url = String(c.chapterNumber);
  chapter.name = lock + c.name;
  chapter.date_upload = tryParseInstant(c.releasesAt);
  chapter.chapter_number = c.chapterNumber;
  chapter.memo = { type: "chapter", comicId: c.comicId, slug: comicSlug };
  return chapter;
}

function volumeToSChapter(v: Volume, comicSlug: string): SChapter {
  const chapter = SChapter.create();
  const isPreview = isLocked(v) && v.trialPage != null && v.trialPage > 0;
  const lock = isLocked(v) ? "🔒 " : "";
  const preview = isPreview ? "(Preview) " : "";
  chapter.url = v.eisbn ?? String(v.volumeNumber);
  chapter.name = lock + preview + (v.name || "Oneshot");
  chapter.date_upload = tryParseInstant(v.releasesAt);
  chapter.chapter_number = v.volumeNumber;
  chapter.memo = { type: "volume", comicId: v.comicId, slug: !v.slug ? comicSlug : `${comicSlug}-${v.slug}`, volumeNumber: v.volumeNumber };
  return chapter;
}

// ========================= ImageInterceptor.kt =========================
async function decryptImage(response: Response, fragment: string): Promise<Response> {
  const secretKey = hexBytes(fragment);
  const source = response.bytes();
  if (source[0] === 2) {
    const iv = source.subarray(2, 18);
    const key = await crypto.subtle.importKey("raw", secretKey as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
    return response.withBody(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 }, key, source.subarray(18) as BufferSource)));
  }
  return response.withBody(await aesCbcDecrypt(secretKey, source.subarray(0, 16), source.subarray(16)));
}

const HIDE_LOCKED_PREF_KEY = "hide_locked";
const EMAIL_PREF_KEY = "email_pref";
const PASSWORD_PREF_KEY = "password_pref";
const TOKEN = "token";
const REFRESH = "refresh";
const EXPIRES = "expires";
/** Not upstream: the credentials the tokens belong to, standing in for the preferences' change listeners. */
const CREDENTIALS = "token_credentials";
const LOGIN_KEY = "AIzaSyC6NaQ5vOOartIGTPJHGgSP1OBjpSNKrZo";
const SEARCH_LIMIT = 50;
const OAEP_PARAMS: RsaHashedKeyGenParams = { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

export default class Emaqi extends KeiSource {
  private get domain() {
    return toHttpUrl(this.baseUrl).host;
  }
  private get apiUrl() {
    return `https://api.${this.domain}/graphql`;
  }
  private tokenMutex: Promise<unknown> = Promise.resolve();
  private _keyPair?: Promise<CryptoKeyPair>;
  private get keyPair() {
    return (this._keyPair ??= crypto.subtle.generateKey(OAEP_PARAMS, true, ["encrypt", "decrypt"]));
  }

  private cursor: string | null = null;
  private loginFailed = false;

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);
      const fragment = toHttpUrl(request.url).fragment;

      if (fragment == null || !response.isSuccessful) return response;
      return decryptImage(response, fragment);
    });
  }

  private jsonHeaders(headers: Headers) {
    const h = new Headers(headers);
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    if (page === 1) this.cursor = null;
    return this.toMangasPage(
      await this.client.post(this.apiUrl, this.jsonHeaders(await this.apiHeaders()), graphQLBody({ query: SERIES_QUERY, operationName: "FetchHomeSection", variables: { slug: "this-week-s-bestsellers", mangaAfter: this.cursor } })),
    );
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    if (page === 1) this.cursor = null;
    return this.toMangasPage(await this.client.post(this.apiUrl, this.jsonHeaders(await this.apiHeaders()), graphQLBody({ query: SERIES_QUERY, operationName: "FetchHomeSection", variables: { slug: "hot-release", mangaAfter: this.cursor } })));
  }

  private toMangasPage(response: Response): MangasPage {
    const result = parseGraphQLAs<SeriesResponse>(response.text()).homeSection.mangaConn;
    this.cursor = result.pageInfo.endCursor;
    const mangas = result.edges.map((it) => comicToSManga(it.node.comic));
    const hasNextPage = result.pageInfo.hasNextPage;
    return new MangasPage(mangas, hasNextPage);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genres = firstInstanceOrNull(filters, GenreFilter)?.checked ?? [];
    const mode = firstInstanceOrNull(filters, GenreModeFilter)?.isOr;
    const tagSlugGroups = mode === true ? [{ tagSlugs: genres }] : genres.map((it) => ({ tagSlugs: [it] }));
    const response = await this.client.post(
      this.apiUrl,
      this.jsonHeaders(await this.apiHeaders()),
      graphQLBody({
        query: SEARCH_QUERY,
        operationName: "Search",
        variables: { input: { keyword: query, tagSlugGroups, page, limit: SEARCH_LIMIT } },
      }),
    );
    const result = parseGraphQLAs<SearchResponse>(response.text());
    const mangas = result.search.map(comicToSManga);
    const hasNextPage = mangas.length === SEARCH_LIMIT;
    return new MangasPage(mangas, hasNextPage);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new GenreFilter(), new GenreModeFilter());
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${str(manga.memo["slug"])!}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const comicId = manga.url.split("#")[0]; // for old url compatibility
    const response = await this.client.post(this.apiUrl, this.jsonHeaders(await this.apiHeaders()), graphQLBody({ query: COMIC_QUERY, operationName: "FetchComicData", variables: { comicId } }));
    const result = parseGraphQLAs<ComicDataResponse>(response.text());
    const comic = result.comicVolumes.comic;

    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    const chapterList = result.chapters
      .filter((it) => !hideLocked || !isLocked(it))
      .map((it) => chapterToSChapter(it, comic.slug))
      .reverse();

    const volumeList = result.comicVolumes.volumes
      .filter((it) => !hideLocked || !isLocked(it))
      .map((it) => volumeToSChapter(it, comic.slug))
      .reverse();

    return new SMangaUpdate(comicDetailsToSManga(comic), [...chapterList, ...volumeList]);
  }

  // Volume: https://emaqi.com/reader/isekai-territory-reform-starting-public-works-with-earth-magic-vol-1
  // OneShot: https://emaqi.com/reader/the-tracks-we-left
  // Chapter: https://emaqi.com/reader/dealing-with-mikadono-sisters-is-a-breeze?type=chapter&chapter=1
  override getChapterUrl(chapter: SChapter): string {
    const slug = str(chapter.memo["slug"])!;
    if (str(chapter.memo["type"]) === "volume") return `${this.baseUrl}/reader/${slug}`;
    return `${this.baseUrl}/reader/${slug}?type=chapter&chapter=${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const comicId = str(chapter.memo["comicId"])!;
    const body =
      str(chapter.memo["type"]) === "volume"
        ? graphQLBody({ query: VOLUME_QUERY, operationName: "FetchMangaContents", variables: { comicId, volumeNumber: Number(chapter.memo["volumeNumber"]) } })
        : graphQLBody({ query: CHAPTER_QUERY, operationName: "FetchChapterContents", variables: { comicId, chapterNumber: Number.parseInt(chapter.url, 10) } });

    const keyPair = await this.keyPair;
    const contentHeaders = this.jsonHeaders(await this.apiHeaders());
    contentHeaders.set("X-Hash", Base64.encode(new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey))));

    const viewer = parseGraphQLAs<ViewerResponse>((await this.client.post(this.apiUrl, contentHeaders, body)).text());
    const contents = (viewer.chapter ?? viewer.manga)!.contents;
    if (contents == null || contents.pages.length === 0) {
      if (this.loginFailed) {
        throw new Error("Invalid E-Mail or Password");
      }
      throw new Error("Enter your credentials in Settings and purchase this chapter to read.");
    }

    const key = toHex(new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, keyPair.privateKey, Base64.decode(contents.hash) as BufferSource)));

    return contents.pages.map((page, i) => new Page(i, "", `${page.url}#${key}`));
  }

  private async apiHeaders(): Promise<Headers> {
    const token = await this.getToken();
    if (token == null) return this.headers;
    const headers = this.headersBuilder();
    headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  private getToken(): Promise<string | null> {
    const run = this.tokenMutex.then(() => this.getTokenLocked());
    this.tokenMutex = run.catch(() => undefined);
    return run;
  }

  private async getTokenLocked(): Promise<string | null> {
    // setOnPreferenceChangeListener { clearTokens() } upstream: the host has no change listeners
    const credentials = JSON.stringify([this.preferences.getString(EMAIL_PREF_KEY, ""), this.preferences.getString(PASSWORD_PREF_KEY, "")]);
    if (this.preferences.getString(CREDENTIALS, credentials) !== credentials) this.clearTokens();
    this.preferences.edit().putString(CREDENTIALS, credentials).apply();

    if (this.loginFailed) return null;
    // getLong/putLong upstream: numbers are stored as-is
    if (Date.now() < this.preferences.getInt(EXPIRES, 0)) return this.preferences.getString(TOKEN, null);

    const refreshToken = this.preferences.getString(REFRESH, "")!;
    const tokens = (refreshToken ? await this.refresh(refreshToken) : null) ?? (await this.login());
    if (tokens == null) return null;

    const idToken = (tokens.idToken ?? tokens.id_token)!;
    this.preferences
      .edit()
      .putString(TOKEN, idToken)
      .putString(REFRESH, (tokens.refreshToken ?? tokens.refresh_token)!)
      .putInt(EXPIRES, Date.now() + 3_600_000)
      .apply();
    return idToken;
  }

  private async login(): Promise<LoginResponse | null> {
    const email = this.preferences.getString(EMAIL_PREF_KEY, "")!;
    const password = this.preferences.getString(PASSWORD_PREF_KEY, "")!;
    if (!email || !password) return null;
    const url = toHttpUrl("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword").newBuilder().addQueryParameter("key", LOGIN_KEY).build();

    try {
      return (await this.client.post(url.toString(), this.jsonHeaders(this.headers), JSON.stringify({ email, password, returnSecureToken: true }))).parseAs<LoginResponse>();
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      this.loginFailed = true;
      return null;
    }
  }

  private async refresh(refreshToken: string): Promise<LoginResponse | null> {
    const url = toHttpUrl("https://securetoken.googleapis.com/v1/token").newBuilder().addQueryParameter("key", LOGIN_KEY).build();

    try {
      return (await this.client.post(url.toString(), this.jsonHeaders(this.headers), JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }))).parseAs<LoginResponse>();
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      return null;
    }
  }

  private clearTokens() {
    this.loginFailed = false;
    this.preferences.edit().remove(TOKEN).remove(REFRESH).remove(EXPIRES).apply();
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const hideLocked = new SwitchPreferenceCompat(screen.context);
    hideLocked.key = HIDE_LOCKED_PREF_KEY;
    hideLocked.title = "Hide Locked Chapters";
    hideLocked.setDefaultValue(false);
    screen.addPreference(hideLocked);

    // inputType TYPE_TEXT_VARIATION_EMAIL_ADDRESS / TYPE_TEXT_VARIATION_PASSWORD: the app's form decides
    const email = new EditTextPreference(screen.context);
    email.key = EMAIL_PREF_KEY;
    email.title = "E-Mail";
    screen.addPreference(email);

    const password = new EditTextPreference(screen.context);
    password.key = PASSWORD_PREF_KEY;
    password.title = "Password";
    screen.addPreference(password);
  }
}
