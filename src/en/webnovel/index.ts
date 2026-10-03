// Port of keiyoushi/extensions-source src/en/webnovel/WebNovel.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  parseAs,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  type Chain,
  type ClientBuilder,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import {
  comicDetailInfoToSManga,
  filterSearchItemToSManga,
  browseToMangasPage,
  isLocked,
  isVisible,
  querySearchToMangasPage,
  type ChapterContentResponse,
  type ComicChapterListResponse,
  type ComicDetailInfoResponse,
  type FilterSearchResponse,
  type QuerySearchResponse,
  type ResponseWrapper,
} from "./dto.ts";
import { ContentStatusFilter, GenreFilter, SortByFilter } from "./filters.ts";

const BASE_API_ENDPOINT = "/go/pcm";

const QUERY_SEARCH_PATH = "/search/result";
const FILTER_SEARCH_PATH = "/category/categoryAjax";

const MIGRATE_MESSAGE = 'Migrate this entry from "Webnovel.com" to "Webnovel.com" to update its URL';

const DIGIT_REGEX = /(\d+)/;

const CSRF_TOKEN_NAME = "_csrfToken";

const WEBNOVEL_UPLOAD_TIME = "https://keiyoushi.github.io/webnovel-upload-time";

interface ChapterPageEntry {
  id: string;
  url: string;
}

/** String.toLongOrNull() */
const isLong = (s: string) => /^[+-]?\d+$/.test(s);

export default class WebNovel extends KeiSource {
  private get baseApiUrl() {
    return `${this.baseUrl}${BASE_API_ENDPOINT}`;
  }

  private get baseCoverURl() {
    return this.baseUrl.replace("www", "book-pic");
  }

  private get baseCdnUrl() {
    return this.baseUrl.replace("www", "comic-image");
  }

  // upstream: addNetworkInterceptor(csrf) and addInterceptor(expired image urls); the network one sits after the other
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.expiredImageUrlInterceptor(chain)).addChainInterceptor((chain) => this.csrfTokenInterceptor(chain));
  }

  // Popular
  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortByFilter(1)));
  }

  // Latest
  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortByFilter(5)));
  }

  // Search
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: string;
    if (query.trim()) {
      url = toHttpUrl(`${this.baseApiUrl}${QUERY_SEARCH_PATH}?type=manga&pageIndex=${page}`).newBuilder().addQueryParameter("keywords", query).toString();
    } else {
      const sort = firstInstanceOrNull(filters, SortByFilter)?.selectedValue ?? "";
      const contentStatus = firstInstanceOrNull(filters, ContentStatusFilter)?.selectedValue ?? "";
      const genre = firstInstanceOrNull(filters, GenreFilter)?.selectedValue ?? "";

      url = `${this.baseApiUrl}${FILTER_SEARCH_PATH}?categoryType=2&pageIndex=${page}&categoryId=${genre}&bookStatus=${contentStatus}&orderBy=${sort}`;
    }

    const response = await this.client.get(url);
    const coverUrl = (id: string, coverUpdatedAt: number) => this.getCoverUrl(id, coverUpdatedAt);

    return url.includes(QUERY_SEARCH_PATH)
      ? querySearchToMangasPage(this.parseAsForWebNovel<QuerySearchResponse>(response), coverUrl)
      : browseToMangasPage(this.parseAsForWebNovel<FilterSearchResponse>(response), coverUrl, filterSearchItemToSManga);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (url.hostname !== toHttpUrl(this.baseUrl).host || pathSegments[0] !== "comic") return null;

    const manga = SManga.create();
    manga.url = substringAfterLast(pathSegments[1], "_");

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    return result;
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator(), new ContentStatusFilter(), new SortByFilter(), new GenreFilter());
  }

  // Manga updates
  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comic/${this.mangaId(manga)}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const [comicId, chapterId] = this.mangaAndChapterId(chapter);
    return `${this.baseUrl}/comic/${comicId}/${chapterId}`;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(m, c);
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const response = await this.client.get(`${this.baseApiUrl}/comic/getComicDetailPage?comicId=${this.mangaId(manga)}`);
    return comicDetailInfoToSManga(this.parseAsForWebNovel<ComicDetailInfoResponse>(response).comicInfo, (id, cv) => this.getCoverUrl(id, cv));
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const chapterList = this.parseAsForWebNovel<ComicChapterListResponse>(await this.client.get(`${this.baseApiUrl}/comic/getChapterList?comicId=${this.mangaId(manga)}`));

    const comic = chapterList.comicInfo;
    const chapters = [...chapterList.comicChapters].reverse();

    let accurateUpdateTimes: Record<string, number> = {};
    try {
      accurateUpdateTimes = (await this.client.get(`${WEBNOVEL_UPLOAD_TIME}/${comic.comicId}.json`)).parseAs<Record<string, number>>();
    } catch {
      accurateUpdateTimes = {};
    }

    const updateTimes = chapters.map((it) => accurateUpdateTimes[it.chapterId] ?? this.toDate(it.publishTime));

    const filteredChapters = chapters.filter((it) => isVisible(it));

    // When new privileged chapter is released oldest privileged chapter becomes normal one (in most cases)
    // but since those normal chapter retain the original upload time we improvise. (This isn't optimal but meh)
    // (zip pairs the filtered chapters with the unfiltered times by position, as upstream)
    return filteredChapters.slice(0, updateTimes.length).map((chapter, i) => {
      const c = SChapter.create();
      c.name = isLocked(chapter) ? `🔒 ${chapter.chapterName}` : chapter.chapterName;
      c.url = `${comic.comicId}:${chapter.chapterId}`;
      c.date_upload = updateTimes[i];
      return c;
    });
  }

  private toDate(s: string): number {
    if (s.toLowerCase().includes("now")) return Date.now();

    const digits = DIGIT_REGEX.exec(s)?.[0];
    const number = digits !== undefined ? Number.parseInt(digits, 10) : Number.NaN;
    if (Number.isNaN(number)) return 0;

    // Calendar.add: year/month arithmetic clamps the day of month
    const d = new Date();
    const addMonths = (n: number) => {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    };
    if (s.includes("year")) addMonths(-number * 12);
    else if (s.includes("month")) addMonths(-number);
    else if (s.includes("day")) d.setDate(d.getDate() - number);
    else if (s.includes("hour")) d.setHours(d.getHours() - number);
    else if (s.includes("minute")) d.setMinutes(d.getMinutes() - number);
    else return 0;

    return d.getTime();
  }

  // LinkedHashMap with a capacity of 25. When exceeding the capacity the oldest entry is removed.
  private readonly chapterPageCache = new Map<string, ChapterPageEntry[]>();

  // Pages
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const [comicId, chapterId] = this.mangaAndChapterId(chapter);
    const response = await this.client.get(this.pageListUrl(comicId, chapterId));
    return this.parsePageList(response, chapterId);
  }

  private pageListUrl(comicId: string, chapterId: string): string {
    // Given a high [width] value WebNovel returns the highest resolution image publicly available
    return `${this.baseApiUrl}/comic/getContent?comicId=${comicId}&chapterId=${chapterId}&width=9999`;
  }

  /**
   * `chapterId` keys the cache: upstream keys it by the response's Long chapterId, which does not survive a JS number
   * (17-digit ids), so the id the page list was requested with is used instead.
   */
  private parsePageList(response: Response, chapterId: string): Page[] {
    const chapterContent = this.parseAsForWebNovel<ChapterContentResponse>(response).chapterInfo;
    const entries = chapterContent.chapterPage.map((it) => ({ id: it.pageId, url: it.url }));
    this.chapterPageCache.set(chapterId, entries);
    if (this.chapterPageCache.size > 25) this.chapterPageCache.delete(this.chapterPageCache.keys().next().value!);
    return entries.map((chapterPage, i) => new Page(i, "", chapterPage.url));
  }

  // Utilities
  private mangaId(manga: SManga): string {
    if (!isLong(manga.url)) throw new Error(MIGRATE_MESSAGE);
    return manga.url;
  }

  private mangaAndChapterId(chapter: SChapter): [string, string] {
    const [comicId, chapterId] = chapter.url.split(":");
    if ([comicId, chapterId].some((it) => it === undefined || !isLong(it))) throw new Error(MIGRATE_MESSAGE);
    return [comicId, chapterId];
  }

  private getCoverUrl(comicId: string, coverUpdatedAt: number): string {
    return `${this.baseCoverURl}/bookcover/${comicId}?imageId=${coverUpdatedAt}&imageMogr2/thumbnail/1024x`;
  }

  private async csrfTokenInterceptor(chain: Chain): Promise<Response> {
    const originalRequest = chain.request();
    if (!originalRequest.url.includes(BASE_API_ENDPOINT)) return chain.proceed(originalRequest);

    // A network interceptor sees the Cookie header the jar produced; here the jar is read directly
    const cookieHeader = () => {
      const own = originalRequest.headers.get("cookie");
      const jar = this.client.cookieJar.loadForRequest(originalRequest.url).map((c) => `${c.name}=${c.value}`);
      return [...(own ? [own] : []), ...jar].join("; ");
    };
    let cookie = cookieHeader();
    if (!cookie.includes(CSRF_TOKEN_NAME)) {
      // upstream relies on cookies the WebView set; a plain visit to the site sets the token cookie as well
      await this.client.execute({ url: `${this.baseUrl}/`, method: "GET", headers: this.headers }).catch(() => undefined);
      cookie = cookieHeader();
    }
    if (!cookie.includes(CSRF_TOKEN_NAME)) throw new Error("Open in WebView to set necessary cookies.");
    const csrfToken = substringBefore(substringAfter(cookie, `${CSRF_TOKEN_NAME}=`), ";");

    const newUrl = toHttpUrl(originalRequest.url).newBuilder().addQueryParameter(CSRF_TOKEN_NAME, csrfToken).build();

    return chain.proceed({ ...originalRequest, url: newUrl.toString() });
  }

  private async expiredImageUrlInterceptor(chain: Chain): Promise<Response> {
    const originalRequest = chain.request();
    const originalRequestUrl = toHttpUrl(originalRequest.url);

    // If original request is not a page url or the url is still valid we just continue with og request
    if (!originalRequest.url.includes(this.baseCdnUrl) || this.isPageUrlStillValid(originalRequestUrl)) return chain.proceed(originalRequest);

    const [, comicId, chapterId, pageFileName] = originalRequestUrl.pathSegments;

    // Page url is not valid anymore so we check if cache has updated one
    const pageId = substringBefore(pageFileName, "!");
    const cachedPageUrl = this.chapterPageCache.get(chapterId)?.find((it) => it.id === pageId)?.url;
    if (cachedPageUrl !== undefined && this.isPageUrlStillValid(toHttpUrl(cachedPageUrl))) return chain.proceed(originalRequest);

    // Time to get it from site
    const request: Request = { url: this.pageListUrl(comicId, chapterId), method: "GET", headers: this.headers };
    this.parsePageList(await chain.proceed(request), chapterId);

    const newPageUrl = this.chapterPageCache.get(chapterId)?.find((it) => it.id === pageId)?.url;
    if (newPageUrl === undefined) throw new Error("Couldn't regenerate expired image url");

    return chain.proceed({ ...originalRequest, url: newPageUrl });
  }

  private isPageUrlStillValid(imageUrl: ReturnType<typeof toHttpUrl>): boolean {
    const t = imageUrl.queryParameter("t");
    if (t === null || !isLong(t)) throw new Error("Couldn't get image generation time from page url");
    const urlGenerationTime = Number.parseInt(t, 10) * 1000;

    // Urls are valid for 10 minutes after generation. We check for 9min and 30s just to be safe
    return Date.now() - urlGenerationTime <= 570000;
  }

  private parseAsForWebNovel<T>(response: Response): T {
    const parsed = parseAs<ResponseWrapper<T>>(response.text());
    if (parsed.code !== 0) throw new Error(`Error ${parsed.code}: ${parsed.msg}`);
    if (parsed.data == null) throw new Error("Received response data was null");
    return parsed.data;
  }
}
