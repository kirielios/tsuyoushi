// Port of keiyoushi/extensions-source src/en/kodansha/Kodansha.kt
import {
  EditTextPreference,
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  POST,
  Page,
  SManga,
  SwitchPreferenceCompat,
  firstInstance,
  parseAs,
  toHttpUrl,
  type ChainInterceptor,
  type ClientBuilder,
  type PreferenceScreen,
  type Request,
  type Response,
  type SChapter,
} from "../../../sdk/index.ts";
import {
  chapterToSChapter,
  detailsToSManga,
  entryToSManga,
  isLocked,
  requiresLogin,
  type ChapterResponse,
  type DetailsResponse,
  type EntryResponse,
  type LoginResponse,
  type PageResponse,
  type PurchasedComic,
  type ViewerResponse,
} from "./dto.ts";
import { AgeRatingFilter, GenreFilter, SortFilter, StatusFilter, type CheckBox } from "./filters.ts";

const HIDE_LOCKED_PREF_KEY = "hide_locked";
const EMAIL_PREF_KEY = "email_pref";
const PASSWORD_PREF_KEY = "password_pref";
const TOKEN = "token";
const REFRESH = "refresh";
const EXPIRES = "expires";

export default class Kodansha extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private get domain() {
    return toHttpUrl(this.baseUrl).host;
  }
  private get apiUrl() {
    return `https://api.${this.domain}`;
  }
  private get tokenUrl() {
    return `${this.apiUrl}/account/token`;
  }
  private readonly pageLimit = 24;

  private bearerToken: string | null = null;
  private tokenExpiration = 0;
  private loginFailed = false;
  // setOnPreferenceChangeListener { clearTokens() } upstream: the host has no change listeners, so a change of the
  // credentials is detected here instead
  private credentials: string | null = null;
  private tokenLock: Promise<unknown> = Promise.resolve();

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    const interceptor: ChainInterceptor = async (chain) => {
      const request = chain.request();
      if (new URL(request.url).pathname.endsWith("/account/token")) return chain.proceed(request);

      const headers = new Headers(request.headers);
      const token = await this.getToken();
      if (token.trim()) headers.set("Authorization", `Bearer ${token}`);

      const response = await chain.proceed({ ...request, headers });

      const url = new URL(request.url);
      if (response.code === 403 && url.pathname.split("/")[3]?.includes("pages") && url.host === toHttpUrl(this.apiUrl).host) {
        if (this.loginFailed) throw new Error("Invalid E-Mail or Password");
        throw new Error("Enter your credentials in Settings and purchase this product to read.");
      }
      return response;
    };
    return builder.addChainInterceptor(interceptor);
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  protected override popularMangaRequest(page: number): Request {
    const nextPage = (page - 1) * this.pageLimit;
    const url = toHttpUrl(`${this.apiUrl}/discover/v2`)
      .newBuilder()
      .addQueryParameter("sort", "0")
      .addQueryParameter("subCategory", "0")
      .addQueryParameter("includeSeries", "true")
      .addQueryParameter("showSpotLightInfo", "true")
      .addQueryParameter("category", "0")
      .addQueryParameter("fromIndex", String(nextPage))
      .addQueryParameter("count", String(this.pageLimit))
      .build();
    return GET(url, this.headers);
  }

  protected override popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected override latestUpdatesRequest(page: number): Request {
    const nextPage = (page - 1) * this.pageLimit;
    const url = toHttpUrl(`${this.apiUrl}/discover/v2`)
      .newBuilder()
      .addQueryParameter("sort", "5")
      .addQueryParameter("subCategory", "0")
      .addQueryParameter("includeSeries", "true")
      .addQueryParameter("showSpotLightInfo", "true")
      .addQueryParameter("category", "0")
      .addQueryParameter("fromIndex", String(nextPage))
      .addQueryParameter("count", String(this.pageLimit))
      .build();
    return GET(url, this.headers);
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected override searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (query.trim()) {
      const url = toHttpUrl(`${this.apiUrl}/search/V3`).newBuilder().addQueryParameter("query", query).addQueryParameter("platform", "web").addQueryParameter("showSpotLightInfo", "true").build();
      return GET(url, this.headers);
    }

    const sortFilter = firstInstance(filters, SortFilter);
    const statusFilter = firstInstance(filters, StatusFilter);
    const genreFilter = firstInstance(filters, GenreFilter);
    const ageRatingFilter = firstInstance(filters, AgeRatingFilter);
    const nextPage = (page - 1) * this.pageLimit;

    const url = toHttpUrl(`${this.apiUrl}/discover/v2`).newBuilder();
    url.addQueryParameter("fromIndex", String(nextPage));
    url.addQueryParameter("count", String(this.pageLimit));
    url.addQueryParameter("showSpotLightInfo", "true");
    url.addQueryParameter("includeSeries", "true");
    url.addQueryParameter("category", "0");
    url.addQueryParameter("subCategory", "0");
    url.addQueryParameter("sort", sortFilter.value);

    const genres = genreFilter.state
      .filter((it) => it.state)
      .map((it) => it.value)
      .join(",");
    const ageRatings = ageRatingFilter.state
      .filter((it) => it.state)
      .map((it) => (it as CheckBox).value)
      .join(",");

    if (genres) url.addQueryParameter("genreIds", genres);
    if (ageRatings) url.addQueryParameter("ageRatings", ageRatings);
    if (statusFilter.value) url.addQueryParameter("seriesStatus", statusFilter.value);

    return GET(url.build(), this.headers);
  }

  protected override searchMangaParse(response: Response): MangasPage {
    const result = response.parseAs<EntryResponse>();
    const mangas = result.response.filter((it) => it.type !== "product").map((it) => entryToSManga(it.content));
    const fullCount = result.status?.fullCount;
    const fromIndex = toHttpUrl(response.url).queryParameter("fromIndex");
    const currentPage = fromIndex != null ? Number.parseInt(fromIndex, 10) : null;
    const hasNextPage = fullCount != null && currentPage != null && currentPage + this.pageLimit < fullCount;
    return new MangasPage(mangas, hasNextPage);
  }

  override mangaDetailsRequest(manga: SManga): Request {
    const id = toHttpUrl(`${this.baseUrl}/${manga.url}`).fragment;
    const url = `${this.apiUrl}/series/V2/${id}`;
    return GET(url, this.headers);
  }

  protected override mangaDetailsParse(response: Response): SManga {
    return detailsToSManga(response.parseAs<DetailsResponse>().response, this.host);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  protected override chapterListRequest(manga: SManga): Request {
    const id = toHttpUrl(`${this.baseUrl}/${manga.url}`).fragment;
    const url = toHttpUrl(`${this.apiUrl}/product/forSeries/${id}`).newBuilder().addQueryParameter("platform", "web").build();
    return GET(url, this.headers);
  }

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    let isLoggedIn = false;
    let purchasedIds = new Set<number>();
    try {
      const purchasedResponse = await this.client.execute(GET(`${this.apiUrl}/mycomics/?onlyPurchased=true`, this.headers));
      isLoggedIn = purchasedResponse.isSuccessful;
      if (purchasedResponse.isSuccessful) purchasedIds = new Set(purchasedResponse.parseAs<PurchasedComic[]>().map((it) => it.id));
    } catch {
      purchasedIds = new Set();
    }

    const result = response.parseAs<ChapterResponse[]>();
    const out: SChapter[] = [];
    for (const volume of result) {
      const isVolumeLocked = isLocked(volume, purchasedIds);
      if (!hideLocked || !isVolumeLocked) out.push(chapterToSChapter(volume, isVolumeLocked, requiresLogin(volume, isLoggedIn)));

      for (const chapter of volume.chapters ?? []) {
        const isChapterLocked = isLocked(chapter, purchasedIds);
        if (!hideLocked || !isChapterLocked) out.push(chapterToSChapter(chapter, isChapterLocked, requiresLogin(chapter, isLoggedIn)));
      }
    }
    return out.reverse();
  }

  override getChapterUrl(chapter: SChapter): string {
    const parts = toHttpUrl(`${this.baseUrl}/${chapter.url}`).fragment!.split(":");
    const slug = parts[0];
    const volumeNum = parts[1];
    const chapterNum = parts[2];
    const url = toHttpUrl(`${this.baseUrl}/reader/${slug}`).newBuilder();
    if (volumeNum !== "null") url.addPathSegment(`volume-${volumeNum}`);
    if (chapterNum !== "null") url.addPathSegment(`chapter-${chapterNum}`);
    return url.build().toString();
  }

  protected override pageListRequest(chapter: SChapter): Request {
    const url = toHttpUrl(`${this.baseUrl}/${chapter.url}`);
    const parts = url.fragment!.split(":");
    const requiresLogin = parts[3] === "1";
    if (requiresLogin) throw new Error("Enter your credentials in Settings to read this free chapter.");

    const id = url.pathSegments[0];
    return GET(`${this.apiUrl}/comic/${id}/pages`, this.headers);
  }

  protected override pageListParse(response: Response): Page[] {
    const result = response.parseAs<ViewerResponse[]>();
    return result.map((it) => new Page(it.pageNumber, String(it.comicID)));
  }

  protected override imageUrlRequest(page: Page): Request {
    return GET(`${this.apiUrl}/comic/${page.url}/pages/${page.index + 1}`, this.headers);
  }

  protected override imageUrlParse(response: Response): string {
    return response.parseAs<PageResponse>().url;
  }

  override getFilterList(): FilterList {
    return FilterList(new SortFilter(), new StatusFilter(), new GenreFilter(), new AgeRatingFilter());
  }

  // @Synchronized: calls are queued on one promise chain
  private getToken(): Promise<string> {
    const run = this.tokenLock.then(() => this.getTokenLocked());
    this.tokenLock = run.catch(() => undefined);
    return run;
  }

  private async getTokenLocked(): Promise<string> {
    const email = this.preferences.getString(EMAIL_PREF_KEY, "")!;
    const password = this.preferences.getString(PASSWORD_PREF_KEY, "")!;
    const credentials = JSON.stringify([email, password]);
    if (this.credentials !== null && this.credentials !== credentials) this.clearTokens();
    this.credentials = credentials;

    if (this.loginFailed) return "";

    if (this.bearerToken != null && Date.now() < this.tokenExpiration) return this.bearerToken;

    const refreshToken = this.preferences.getString(REFRESH, "")!;
    if (refreshToken.trim()) {
      try {
        const newTokens = await this.refresh(refreshToken);
        this.saveTokens(newTokens);
        return newTokens.accessToken;
      } catch {
        // fall through to the password login
      }
    }

    if (email.trim() && password.trim()) {
      try {
        const newTokens = await this.login(email, password);
        this.saveTokens(newTokens);
        return newTokens.accessToken;
      } catch {
        this.loginFailed = true;
        return "";
      }
    }

    return "";
  }

  private normalize(r: LoginResponse): LoginResponse {
    const accessToken = r.accessToken ?? r.access_token;
    const refreshToken = r.refreshToken ?? r.refresh_token;
    if (accessToken == null || refreshToken == null) throw new Error("Invalid token response");
    return { accessToken, refreshToken };
  }

  private async login(email: string, password: string): Promise<LoginResponse> {
    const request = POST(this.tokenUrl, this.headers, JSON.stringify({ UserName: email, Password: password }), "application/json");
    return this.normalize((await this.client.execute(request, true)).parseAs<LoginResponse>());
  }

  private async refresh(refreshToken: string): Promise<LoginResponse> {
    const request = POST(this.tokenUrl, this.headers, JSON.stringify({ refresh_token: refreshToken }), "application/json");
    return this.normalize((await this.client.execute(request, true)).parseAs<LoginResponse>());
  }

  private saveTokens(response: LoginResponse) {
    const expiration = Date.now() + 86400 * 1000;
    this.bearerToken = response.accessToken;
    this.tokenExpiration = expiration;
    this.preferences.edit().putString(TOKEN, response.accessToken).putString(REFRESH, response.refreshToken).putString(EXPIRES, String(expiration)).apply();
  }

  private clearTokens() {
    this.loginFailed = false;
    this.bearerToken = null;
    this.tokenExpiration = 0;
    this.preferences.edit().remove(TOKEN).remove(REFRESH).remove(EXPIRES).apply();
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const hide = new SwitchPreferenceCompat(screen.context);
    hide.key = HIDE_LOCKED_PREF_KEY;
    hide.title = "Hide Paid Chapters";
    hide.setDefaultValue(false);
    screen.addPreference(hide);

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

