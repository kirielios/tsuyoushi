// Port of keiyoushi/extensions-source lib-multisrc/iken/Iken.kt
import {
  Filter,
  FilterList,
  Intl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseHtml,
  str,
  substringAfterLast,
  substringBeforeLast,
  toHttpUrl,
  type Document,
  type HttpUrl,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import {
  chapterIsLocked,
  chapterToSChapter,
  mangaIsNovel,
  mangaToSManga,
  type Chapter,
  type ChapterDto,
  type Genre,
  type Manga,
  type MangaDto,
  type PageResponse,
  type RelatedMangaDto,
  type SearchResponse,
  type ViewQuery,
} from "./dto.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter, isUrlPartFilter, type Options } from "./filters.ts";
import { messages } from "./messages.ts";

export const SHOW_LOCKED_CHAPTER_PREF_KEY = "pref_show_locked_chapters";
export const USE_CHAPTERS_API_PREF_KEY = "pref_use_chapters_api";
const NUMBER_REGEX = /\d+/;

export abstract class Iken extends KeiSource {
  protected get apiUrl(): string {
    return this.baseUrl.replace("https://", "https://api.");
  }

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "ar"], messages });

  /**
   * Whether the extension should report view updates to the source website
   * through `analytics/updateViews`.
   *
   * Set to false to disable sending the request.
   */
  protected sendUpdateViews = true;

  /** The number of items to fetch per page in search/popular/latest requests. */
  protected perPage = 18;

  /** Whether image URLs should be sorted by their filenames */
  protected sortPagesByFilename = false;

  /** Jsoup.parse */
  protected parseHtml(html: string): Document {
    return parseHtml(this.host.load, html, this.baseUrl);
  }
  protected toSManga(m: Manga): SManga {
    return mangaToSManga(m, (html) => this.parseHtml(html));
  }

  // ============================== Popular ==============================

  // Popular (Search with popular order and nothing else)
  protected get popularFilter(): FilterList {
    return FilterList(new SortFilter("", this.sortFilterKey, this.sortOptions, this.sortOptions[1][1]));
  }

  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", this.popularFilter);
  }

  // ============================== Latest ===============================

  // Latest (Search with update order and nothing else)
  protected get latestFilter(): FilterList {
    return FilterList(new SortFilter("", this.sortFilterKey, this.sortOptions));
  }

  override getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", this.latestFilter);
  }

  // ============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const b = toHttpUrl(`${this.apiUrl}/api/query`).newBuilder();
    b.addQueryParameter("page", String(page));
    b.addQueryParameter("perPage", String(this.perPage));
    b.addQueryParameter("searchTerm", query.trim());
    filters.forEach((it) => isUrlPartFilter(it) && it.addUrlParameter(b));
    const url = b.build();

    return this.parseSearchMangaList(await this.client.get(url.toString()));
  }

  // Tracks the current page
  private readonly pageNumber = new Map<string, number>();

  private keyFromUrl(url: HttpUrl): string {
    const names = [...new Set(url.toURL().searchParams.keys())].sort();
    return names
      .map((paramName) => {
        const value = url.queryParameter(paramName);
        return value == null || !value.trim() ? null : `${paramName}=${value}`;
      })
      .filter((it) => it != null)
      .join("&");
  }

  protected async parseSearchMangaList(response: Response): Promise<MangasPage> {
    const data = response.parseAs<SearchResponse>();
    const requestUrl = toHttpUrl(response.url);
    const page = Number(requestUrl.queryParameter("page")!);

    const entries = data.posts.filter((it) => !mangaIsNovel(it)).map((it) => this.toSManga(it));

    const hasNextPage = data.totalCount > page * this.perPage;

    const key = this.keyFromUrl(requestUrl);
    if (page === 1) this.pageNumber.set(key, 1);

    if (!entries.length && hasNextPage) {
      this.pageNumber.set(key, this.pageNumber.get(key)! + 1);
      const newUrl = requestUrl.newBuilder().setQueryParameter("page", String(this.pageNumber.get(key)!)).build();
      return this.parseSearchMangaList(await this.client.get(newUrl.toString()));
    }

    if (!hasNextPage) this.pageNumber.delete(key);

    return new MangasPage(entries, hasNextPage);
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  protected statusFilterKey = "seriesStatus";

  protected statusFilterOptions: Options = [
    [this.intl.get("status_filter_all"), ""],
    [this.intl.get("status_filter_ongoing"), "ONGOING"],
    [this.intl.get("status_filter_completed"), "COMPLETED"],
    [this.intl.get("status_filter_canceled"), "CANCELLED"],
    [this.intl.get("status_filter_dropped"), "DROPPED"],
    [this.intl.get("status_filter_coming_soon"), "COMING_SOON"],
    [this.intl.get("status_filter_mass_released"), "MASS_RELEASED"],
  ];

  protected typeFilterKey = "seriesType";

  protected typeFilterOptions: Options = [
    [this.intl.get("type_filter_all"), ""],
    [this.intl.get("type_filter_manga"), "MANGA"],
    [this.intl.get("type_filter_manhua"), "MANHUA"],
    [this.intl.get("type_filter_manhwa"), "MANHWA"],
    [this.intl.get("type_filter_russian"), "RUSSIAN"],
    [this.intl.get("type_filter_spanish"), "SPANISH"],
  ];

  protected sortOptions: Options = [
    [this.intl.get("sort_by_last_chapter"), "lastChapterAddedAt"],
    [this.intl.get("sort_by_views"), "totalViews"],
    [this.intl.get("sort_by_added_date"), "createdAt"],
    [this.intl.get("sort_by_chapters_count"), "chaptersCount"],
    [this.intl.get("sort_by_alphabetical"), "postTitle"],
  ];

  protected sortFilterKey = "orderBy";

  protected sortDirectionOptions: Options = [
    [this.intl.get("sort_direction_descending"), "desc"],
    [this.intl.get("sort_direction_ascending"), "asc"],
  ];

  protected sortDirectionFilterKey = "orderDirection";

  protected genreFilterKey = "genreIds";

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/api/genres`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genresList = Array.isArray(data) ? (data as Genre[]).map((it): [string, string] => [it.name, String(it.id)]) : null;

    const filters: Filter[] = [
      new StatusFilter(this.intl.get("status_filter_title"), this.statusFilterKey, this.statusFilterOptions),
      new TypeFilter(this.intl.get("type_filter_title"), this.typeFilterKey, this.typeFilterOptions),
      new SortFilter(this.intl.get("sort_by_title"), this.sortFilterKey, this.sortOptions),
      new SortFilter(this.intl.get("sort_direction_title"), this.sortDirectionFilterKey, this.sortDirectionOptions),
    ].filter((filter) => !(filter instanceof Filter.Select && filter.values.length === 0));

    if (genresList?.length) {
      filters.push(new Filter.Separator(), new Filter.Header(this.intl.get("genre_filter_header")), new GenreFilter(this.intl.get("genre_filter_title"), this.genreFilterKey, genresList));
    }

    return FilterList(...filters);
  }

  // ============================== Details ==============================

  private async getMangaDetails(slug: string): Promise<MangaDto> {
    const mangaUrl = toHttpUrl(`${this.apiUrl}/api/post`).newBuilder().addQueryParameter("postSlug", slug).build();

    const response = await this.client.get(mangaUrl.toString());
    const data = response.parseAs<MangaDto>();
    if (mangaIsNovel(data.post)) throw new Error("Novels are unsupported");
    this.updateViews(data.post.id);
    return data;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = toHttpUrl(url.href).pathSegments;
    if (segments.length >= 2) {
      const slug = segments[1];
      const details = await this.getMangaDetails(slug);
      const manga = this.toSManga(details.post);
      manga.initialized = true;
      return manga;
    }

    throw new Error("Unsupported URL");
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${substringBeforeLast(manga.url, "#")}`;
  }

  protected get showLockedChapters() {
    return this.preferences.getBoolean(SHOW_LOCKED_CHAPTER_PREF_KEY, false);
  }

  /** Kotlin's List<Chapter>.getVisible(slug) extension. */
  protected getVisible(chapters: Chapter[], slug: string): SChapter[] {
    return chapters.filter((it) => this.showLockedChapters || !chapterIsLocked(it)).map((it) => chapterToSChapter(it, slug));
  }

  private get useChaptersApi(): boolean {
    return this.preferences.getBoolean(USE_CHAPTERS_API_PREF_KEY, false);
  }
  private set useChaptersApi(value: boolean) {
    this.preferences.edit().putBoolean(USE_CHAPTERS_API_PREF_KEY, value).apply();
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringBeforeLast(manga.url, "#");
    const id = substringAfterLast(manga.url, "#");

    if (this.useChaptersApi) {
      let mangaChapters: SChapter[] = [];

      const mangaDeferred = (async () => {
        if (fetchDetails) {
          const details = await this.getMangaDetails(slug);
          mangaChapters = this.getVisible(details.post.chapters ?? [], slug);
          return this.toSManga(details.post);
        }
        return manga;
      })();
      const chaptersDeferred = (async () => {
        if (fetchChapters) {
          const response = await this.client.get(`${this.apiUrl}/api/chapters?postId=${id}`);
          const chapterData = response.parseAs<ChapterDto>().post;
          return this.getVisible(chapterData.chapters, slug);
        }
        return chapters;
      })();
      const [updatedManga, chaptersResult] = await Promise.all([mangaDeferred, chaptersDeferred]);
      // Revert to manga object chapters just in case
      let updatedChapters: SChapter[];
      if (chaptersResult.length <= mangaChapters.length) {
        this.useChaptersApi = false;
        updatedChapters = mangaChapters;
      } else {
        updatedChapters = chaptersResult;
      }
      return new SMangaUpdate(updatedManga, updatedChapters);
    }

    const details = await this.getMangaDetails(slug);
    const updatedManga = this.toSManga(details.post);

    // Switch to chapters endpoint if mismatch detected
    if (!this.useChaptersApi && details.totalChapterCount != null && details.totalChapterCount > (details.post.chapters ?? []).length) {
      this.useChaptersApi = true;
      return this.fetchMangaUpdate(updatedManga, chapters, fetchDetails, fetchChapters);
    }
    const updatedChapters = this.getVisible(details.post.chapters ?? [], slug);
    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  // ========================= Related Manga =========================

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const id = substringAfterLast(manga.url, "#");
    const response = await this.client.get(`${this.apiUrl}/api/recommendations?postId=${id}&limit=25`);

    return response
      .parseAs<RelatedMangaDto>()
      .recommendations.filter((it) => !mangaIsNovel(it))
      .map((it) => this.toSManga(it));
  }

  // ============================== Pages ==============================

  override getChapterUrl(chapter: SChapter): string {
    const seriesSlug = str(chapter.memo["seriesSlug"]);
    const slug = str(chapter.memo["slug"]);
    if (seriesSlug == null || slug == null) throw new Error("Refresh Chapter List"); // `!!` upstream
    return `${this.baseUrl}/series/${seriesSlug}/${slug}`;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const rawId = str(chapter.memo["id"]);
    const id = rawId != null && /^-?\d+$/.test(rawId) ? Number(rawId) : null;
    if (id == null) throw new Error("Refresh Chapter List");
    const response = await this.client.get(`${this.apiUrl}/api/chapter?chapterId=${id}`);

    const data = response.parseAs<PageResponse>().chapter;

    if (data.isShortLinkLocked) throw new Error("Chapter locked (short link)");
    if (data.isLockedByCoins) throw new Error("Chapter locked (coins required)");
    if (data.isPermanentlyLocked) throw new Error("Chapter permanently locked");

    this.updateViews(null, id);

    const MAX = Number.MAX_SAFE_INTEGER;
    const sortedPages = this.sortPagesByFilename
      ? [...data.images].sort((a, b) => {
          const key = (url: string) => {
            const m = NUMBER_REGEX.exec(substringAfterLast(url, "/"))?.[0];
            return m != null && m.length < 10 ? Number(m) : MAX; // toIntOrNull
          };
          return key(a.url) - key(b.url);
        })
      : [...data.images].sort((a, b) => (a.order ?? MAX) - (b.order ?? MAX));

    return sortedPages.map((p, idx) => new Page(idx, "", p.url.replaceAll(" ", "%20")));
  }

  // ============================== View =============================

  /** Sends a request to increment view counter */
  protected updateViews(postId: number | null = null, chapterId: number | null = null) {
    if (!this.sendUpdateViews || (postId ?? chapterId) == null) return;

    const body: ViewQuery = { postId: postId ?? undefined, chapterId: chapterId ?? undefined };
    const headers = this.headers;
    headers.set("Content-Type", "application/json; charset=utf-8");
    this.client.enqueue({ url: `${this.apiUrl}/api/analytics/updateViews`, method: "POST", headers, body: JSON.stringify(body) });
  }

  // ============================== Preferences ==============================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = SHOW_LOCKED_CHAPTER_PREF_KEY;
    pref.title = this.intl.get("show_inaccessible_title");
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }
}
