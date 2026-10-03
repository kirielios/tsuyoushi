// Port of keiyoushi/extensions-source src/id/softkomik/Softkomik.kt
import {
  ClientBuilder,
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  extractNextJs,
  hasKeys,
  isNotBlank,
  substringAfter,
  substringBefore,
  toHttpUrl,
  trimEnd,
  type Chain,
  type HttpUrl,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { GenreFilter, MinChapterFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

// Dto.kt
interface LibDataDto {
  data: MangaDto[];
  maxPage: number;
  page: number;
}
interface MangaDto {
  gambar: string;
  title: string;
  title_slug: string;
  status?: string | null;
  type?: string | null;
}
interface MangaDetailsDto {
  gambar: string;
  title: string;
  author?: string | null;
  Genre?: string[] | null;
  sinopsis?: string | null;
  status?: string | null;
  type?: string | null;
}
interface ChapterDto {
  chapter: string;
}
interface ChapterPageImagesDto {
  imageSrc: string[];
}
interface ChapterPageDataDto {
  _id: string;
  imageSrc?: string[];
  storageInter2?: boolean | null;
  backBS3?: boolean | null;
  created_at: string;
}
interface ChapterListDto {
  chapter: ChapterDto[];
}
interface SessionDto {
  ex: number;
  sign: string;
  token: string;
  contentAccess?: ContentAccessDto | null;
}
interface ContentAccessDto {
  token: string;
  sign: string;
}
interface BearerTokenDto {
  token: string;
  ex: number;
}

interface SessionRoute {
  key: string;
  sessionApiUrl: string;
  webViewUrl: string;
  slug: string | null;
  isChapterListRequest: boolean;
  isChapterImageRequest: boolean;
}

const requiredLoginSuffix = "login-required";
const requiredLoginFragment = `#${requiredLoginSuffix}`;
const requiredLoginGenres = ["ecchi", "mature"];
const sessionKeyChapterList = "chapter-list";
const sessionKeyChapterImage = "chapter-image";
const apiUrl = "https://api.softkomik.org";

// Inlined in the site's chapter chunk as `String("...").trim()` and appended to every image URL.
const imageIdParam = "T4Kmwztku";
const trapImagePath = "/baca-image.jpeg";
const coverUrl = "https://cover.softdevices.my.id/softkomik-cover";
const userAgentMobileSafariRegex = /\s*Mobile Safari\/\d+(?:\.\d+)*/gi;
const primaryCdnUrl = "https://psy1.komik.im";
const secondaryCdnUrl = "https://image.komik.im/softkomik";
const cdnUrls = [primaryCdnUrl, secondaryCdnUrl];

const removePrefix = (s: string, p: string) => (s.startsWith(p) ? s.slice(p.length) : s);
const toFloatOrNull = (s: string) => (/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?\s*$/.test(s) ? parseFloat(s) : null);
const toIntOrNull = (s: string) => (/^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null);

export default class Softkomik extends KeiSource {
  // session cache by URL/page route.
  private readonly sessionsByUrlKey = new Map<string, SessionDto>();
  private bearerToken: BearerTokenDto | null = null;

  private get rscHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("rsc", "1");
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.imageInterceptor(chain)).addChainInterceptor((chain) => this.apiAuthInterceptor(chain));
  }

  // ======================== Popular ========================
  getPopularManga(page: number): Promise<MangasPage> {
    return this.getLibraryPage(this.libraryUrlBuilder(page).addQueryParameter("sortBy", "popular").build());
  }

  // ======================== Latest ========================
  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getLibraryPage(this.libraryUrlBuilder(page).addQueryParameter("sortBy", "newKomik").build());
  }

  // ======================== Search ========================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.length > 0) {
      const url = toHttpUrl(`${apiUrl}/komik`).newBuilder().addQueryParameter("name", query).addQueryParameter("search", "true").addQueryParameter("limit", "20").addQueryParameter("page", String(page)).build();

      return this.toMangasPage((await this.client.get(String(url))).parseAs<LibDataDto>());
    }

    const url = this.libraryUrlBuilder(page);

    for (const filter of filters) {
      if (filter instanceof StatusFilter) url.addQueryParameter("status", filter.selected);
      else if (filter instanceof TypeFilter) url.addQueryParameter("type", filter.selected);
      else if (filter instanceof GenreFilter) url.addQueryParameter("genre", filter.selected);
      else if (filter instanceof SortFilter) url.addQueryParameter("sortBy", filter.selected);
      else if (filter instanceof MinChapterFilter) {
        const minValue = toIntOrNull(filter.state);
        if (minValue != null && minValue > 0) url.addQueryParameter("min", String(minValue));
      }
    }

    return this.getLibraryPage(url.build());
  }

  private libraryUrlBuilder(page: number) {
    return toHttpUrl(`${this.baseUrl}/komik/library`).newBuilder().addQueryParameter("page", String(page));
  }

  private async getLibraryPage(url: HttpUrl): Promise<MangasPage> {
    const libData = extractNextJs<LibDataDto>(await this.client.get(String(url), this.rscHeaders), hasKeys("data", "maxPage", "page"));
    if (libData == null) throw new Error("Could not find library data");

    return this.toMangasPage(libData);
  }

  private toMangasPage(lib: LibDataDto): MangasPage {
    const mangas = lib.data.map((manga) => {
      const m = SManga.create();
      m.url = manga.title_slug;
      m.title = manga.title;
      m.thumbnail_url = `${coverUrl}/${removePrefix(manga.gambar, "/")}`;
      return m;
    });
    return new MangasPage(mangas, lib.page < lib.maxPage);
  }

  // ======================== Details ========================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const first = decodeURIComponent(url.pathname.slice(1).split("/")[0] ?? "");
    const slug = isNotBlank(first) ? first : null;
    if (slug == null) return null;

    return this.getMangaDetails(slug);
  }

  private async getMangaDetails(slug: string): Promise<SManga> {
    const manga = extractNextJs<MangaDetailsDto>(await this.client.get(`${this.baseUrl}/${slug}`, this.rscHeaders), hasKeys("gambar", "title"));
    if (manga == null) throw new Error("Could not find manga details");

    const m = SManga.create();
    m.url = slug;
    m.title = manga.title;
    m.author = manga.author ?? undefined;
    m.description = manga.sinopsis ?? undefined;
    m.genre = manga.Genre?.join(", ");
    switch (manga.status?.toLowerCase()) {
      case "ongoing":
        m.status = SManga.ONGOING;
        break;
      case "tamat":
        m.status = SManga.COMPLETED;
        break;
      default:
        m.status = SManga.UNKNOWN;
    }
    m.thumbnail_url = `${coverUrl}/${removePrefix(manga.gambar, "/")}`;
    return m;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${manga.url}`;
  }

  // ======================== Chapters ========================
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? await this.getMangaDetails(manga.url) : manga;
    const chapterList = fetchChapters ? await this.getChapterList(details) : chapters;

    return new SMangaUpdate(details, chapterList);
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    // isRequiredLogin manga with genre ecchi or mature
    const isRequiredLogin = requiredLoginGenres.some((keyword) => (manga.genre ?? "").toLowerCase().includes(keyword));
    const slug = manga.url;
    const dto = (await this.client.get(`${apiUrl}/komik/${slug}/chapter?limit=9999999`)).parseAs<ChapterListDto>();

    return dto.chapter
      .map((chapter) => {
        const chapterNumStr = chapter.chapter;
        const chapterNum = toFloatOrNull(substringBefore(chapterNumStr, ".")) ?? -1;
        const displayNum = this.formatChapterDisplay(chapterNumStr);
        let chapterUrl = `/${slug}/chapter/${chapterNumStr}`;
        if (isRequiredLogin) chapterUrl += requiredLoginFragment;
        const c = SChapter.create();
        c.url = chapterUrl;
        c.name = `Chapter ${displayNum}`;
        c.chapter_number = chapterNum;
        return c;
      })
      .sort((a, b) => b.chapter_number - a.chapter_number);
  }

  private formatChapterDisplay(chapterStr: string): string {
    const parts = chapterStr.split(".");
    const numPart = parts[0];
    const suffix = parts.slice(1).join(".");

    const floatVal = toFloatOrNull(numPart);
    if (floatVal == null) return chapterStr;
    const formatted = floatVal === Math.trunc(floatVal) ? String(Math.trunc(floatVal)) : trimEnd(trimEnd(String(floatVal), "0"), ".");

    return suffix.length > 0 ? `${formatted}.${suffix}` : formatted;
  }

  // ======================== Pages ========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const isRequiredLogin = substringAfter(chapter.url, "#", "").includes(requiredLoginSuffix);
    const segments = substringBefore(chapter.url, "#").replace(/^\/+|\/+$/g, "").split("/");
    const slug = segments[0];
    const chapterNum = segments[2];

    const data = extractNextJs<ChapterPageDataDto>(await this.client.get(`${this.baseUrl}${chapter.url}`, this.rscHeaders), hasKeys("_id", "created_at"));
    if (data == null) throw new Error("Could not find chapter data");

    let imageSrc = data.imageSrc ?? [];
    if (imageSrc.length === 0) {
      const urlApi = `${apiUrl}/komik/${slug}/chapter/${chapterNum}/imgs/${data._id}`;

      const token = this.getBearerTokenFromCookie();
      if (token == null && isRequiredLogin) throw new Error("Chapter memerlukan login di WebView");
      let authHeaders: Headers;
      if (token != null) {
        authHeaders = this.headersBuilder();
        authHeaders.set("Authorization", token.token);
      } else {
        authHeaders = this.headers;
      }

      imageSrc = (await this.client.get(urlApi, authHeaders)).parseAs<ChapterPageImagesDto>().imageSrc;
    }

    // for manga/manhwa that requires login, the API still returns 200 but with empty image list.
    if (imageSrc.length === 0) throw new Error("Chapter kosong atau memerlukan login di WebView");

    const imageBaseUrl = data.backBS3 === true ? primaryCdnUrl : data.storageInter2 === true ? secondaryCdnUrl : primaryCdnUrl;

    return imageSrc.map((img, i) => new Page(i, "", `${imageBaseUrl}/${removePrefix(img, "/")}?id=${imageIdParam}`));
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const newHeaders = this.headersBuilder();
    newHeaders.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    return { url: page.imageUrl!, headers: newHeaders };
  }

  // ============================= Utilities ==============================

  private async imageInterceptor(chain: Chain): Promise<Response> {
    const originalRequest = chain.request();
    const userAgent = originalRequest.headers.get("User-Agent");
    const normalizedUserAgent = this.normalizeUserAgent(userAgent);

    let request = originalRequest;
    if (normalizedUserAgent !== userAgent) {
      const headers = new Headers(originalRequest.headers);
      headers.set("User-Agent", normalizedUserAgent ?? "");
      request = { ...originalRequest, headers };
    }

    // upstream catches UnknownHostException; the host reports every network failure as a plain error
    const tryProceed = async (req: Request) => {
      try {
        return await chain.proceed(req);
      } catch {
        return null;
      }
    };

    const response = await tryProceed(request);

    if (response?.isSuccessful === true && !this.isTrapImage(response)) return response;

    const currentHost = cdnUrls.find((it) => request.url.startsWith(it));

    // Only chapter CDN URLs should use retry host fallback.
    // Non-CDN hosts (e.g. cover URL) should return the original response or throw if it failed, without trying other hosts.
    if (currentHost == null) {
      if (response) return response;
      return chain.proceed(request); // rethrows the network error
    }

    const imagePath = removePrefix(removePrefix(request.url, currentHost), "/");
    const otherHosts = cdnUrls.filter((it) => it !== currentHost);

    let latestResponse: Response | null = null;
    for (const newHost of otherHosts) {
      const newUrl = String(toHttpUrl(`${newHost}/${imagePath}`));
      latestResponse = await tryProceed({ ...request, url: newUrl });
      if (latestResponse?.isSuccessful === true && !this.isTrapImage(latestResponse)) return latestResponse;
    }

    if (latestResponse != null && this.isTrapImage(latestResponse)) throw new Error("Gambar diblokir oleh situs, extension perlu diperbarui");

    if (latestResponse == null) throw new Error(`All CDN hosts failed for: ${imagePath}`);
    return latestResponse;
  }

  private isTrapImage(response: Response): boolean {
    return new URL(response.url).pathname.endsWith(trapImagePath);
  }

  private async apiAuthInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();

    if (!request.url.startsWith(apiUrl)) return chain.proceed(request);

    const route = this.resolveSessionRoute(toHttpUrl(request.url));
    const apiSession = await this.getSession(route);
    const newRequest = this.withHeaders(request, apiSession);

    const response = await chain.proceed(newRequest);
    if (response.isSuccessful) return response;

    // Fallback to webivew just in case credentials were still invalid
    const webviewSession = this.getSessionViaWebView(route);
    return chain.proceed(this.withHeaders(request, webviewSession));
  }

  private getBearerTokenFromCookie(): BearerTokenDto | null {
    const currentToken = this.bearerToken;
    if (currentToken != null && currentToken.ex > Date.now()) return currentToken;

    const cookies = this.client.cookieJar.loadForRequest(this.baseUrl);
    const cookieToken = cookies.find((it) => it.name === "tokkey");
    if (cookieToken == null) return null;

    const rawValue = cookieToken.value;
    let token: string;
    try {
      token = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      token = rawValue;
    }
    const ex = cookieToken.expiresAt;
    this.bearerToken = { token, ex };
    return this.bearerToken;
  }

  private resolveSessionRoute(url: HttpUrl): SessionRoute {
    const segments = url.pathSegments;
    const komikIndex = segments.indexOf("komik");
    // slug is always the segment after "komik" in both chapter list and chapter image API
    const slug = komikIndex !== -1 ? (segments[komikIndex + 1] ?? null) : null;
    // chapter list API $apiUrl/komik/${manga.url}/chapter?limit=9999999
    const isChapterListRequest = komikIndex !== -1 && segments[komikIndex + 2] === "chapter";
    // chapter image API $apiUrl/komik/${manga.url}/chapter/${chapter}/imgs/${data._id}
    const isChapterImageRequest = isChapterListRequest && segments.includes("imgs");

    const sessionKey = isChapterImageRequest ? sessionKeyChapterImage : sessionKeyChapterList;

    const sessionApiUrl = isChapterImageRequest ? `${this.baseUrl}/api/session/chapter/oaisos` : `${this.baseUrl}/api/session/aksjkas`;
    let webViewUrl: string;
    if (isChapterImageRequest) {
      const chapterSegment = this.resolveWebViewChapterSegment(url);
      webViewUrl = chapterSegment != null ? `${this.baseUrl}/${slug}/chapter/${chapterSegment}` : `${this.baseUrl}/${slug}/chapter/001`;
    } else if (isChapterListRequest) {
      webViewUrl = `${this.baseUrl}/${slug}`;
    } else {
      webViewUrl = `${this.baseUrl}/komik/list`; // this for manga list with filters.
    }

    return { key: sessionKey, sessionApiUrl, slug, isChapterListRequest, isChapterImageRequest, webViewUrl };
  }

  private async getSession(route: SessionRoute): Promise<SessionDto> {
    const cached = this.sessionsByUrlKey.get(route.key);
    if (cached && cached.ex > Date.now()) return cached;

    const apiHeaders = this.headersBuilder();
    apiHeaders.set("Accept", "application/json");
    apiHeaders.set("Content-Type", "application/json");
    apiHeaders.set("X-Requested-With", "XMLHttpRequest");

    const hasCookies = this.client.cookieJar.loadForRequest(this.baseUrl).some((it) => it.name === "zEm9be" || it.name === "AhyyL");

    if (!hasCookies) {
      await this.client.get(this.baseUrl, undefined, { ensureSuccess: false });
      await this.client.get(`${this.baseUrl}/api/me`, apiHeaders, { ensureSuccess: false });
    }

    let response: Response | null = null;
    try {
      response = await this.client.get(route.sessionApiUrl, apiHeaders, { ensureSuccess: false });
    } catch {
      response = null;
    }

    if (response?.isSuccessful === true) {
      const newSession = response.parseAs<SessionDto>();
      this.sessionsByUrlKey.set(route.key, newSession);
      return newSession;
    }

    // Softkomik frequently renames their session API endpoint. When the direct
    // call fails (commonly with HTTP 404), fall back to capturing the session
    // headers that the site's own JavaScript sends from a live WebView — that
    // path survives URL changes without an extension update.
    return this.getSessionViaWebView(route);
  }

  private resolveWebViewChapterSegment(url: HttpUrl): string | null {
    const segments = url.pathSegments;
    const chapterIndex = segments.indexOf("chapter");
    if (chapterIndex === -1) return null;
    const rawChapter = segments[chapterIndex + 1] ?? null;

    const chapterNumber = rawChapter != null ? toIntOrNull(rawChapter) : null;
    return chapterNumber != null && chapterNumber < 100 ? String(chapterNumber).padStart(3, "0") : rawChapter;
  }

  // because softkomik often changes their api session url, upstream loads the page in a WebView and captures the
  // X-Token / X-Sign headers the site's own JavaScript sends. Not ported: that runs the site's code.
  private getSessionViaWebView(_route: SessionRoute): never {
    throw new Error("Gagal mendapatkan session. Coba lagi.");
  }

  // Normalizes the User-Agent by removing "Mobile Safari" because it can cause 401 errors.
  private normalizeUserAgent(userAgent: string | null): string | null {
    if (userAgent == null || !userAgent.trim()) return null;

    const r = userAgent.replace(userAgentMobileSafariRegex, "").trim();
    return r || null;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Filter tidak bisa digabungkan dengan pencarian teks."),
      new Filter.Separator(),
      new SortFilter(),
      new StatusFilter(),
      new TypeFilter(),
      new GenreFilter(),
      new MinChapterFilter(),
    );
  }

  // Clean garabage at trailing of signature and token
  private withHeaders(request: Request, session: SessionDto): Request {
    const headers = new Headers(request.headers);
    headers.set("X-Token", this.cleanB64(session.token));
    headers.set("X-Sign", session.sign.slice(0, 64));
    // sent by the site for chapters gated behind an account
    if (session.contentAccess) {
      headers.set("X-Content-Token", session.contentAccess.token);
      headers.set("X-Content-Sign", session.contentAccess.sign);
    }
    return { ...request, headers };
  }

  private cleanB64(s: string): string {
    const it = substringBefore(s, "=");
    return it + "=".repeat((4 - (it.length % 4)) % 4);
  }
}
