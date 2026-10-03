// Port of keiyoushi/extensions-source src/all/kagane/Kagane.kt
import {
  ClientBuilder,
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  parseAs,
  type Chain,
  type PreferenceScreen,
  type Response,
  type SChapter,
  type SManga,
  SMangaUpdate,
} from "../../../sdk/index.ts";
import {
  bookToSChapter,
  bookToSManga,
  detailsToSManga,
  searchHasNextPage,
  type ChallengeDto,
  type DetailsDto,
  type GenreDto,
  type IntegrityDto,
  type SearchDto,
  type SourcesDto,
  type TagDto,
  type TrackerDto,
} from "./dto.ts";
import {
  CONTENT_RATINGS,
  ContentRatingFilter,
  FilterData,
  FormatFilter,
  GenresFilter,
  MatchAllGenresFilter,
  MatchAllTagsFilter,
  PublicationStatusFilter,
  SortFilter,
  SourcesFilter,
  TagsSearchFilter,
  getGenresList,
  isJsonFilter,
  type MetadataDto,
} from "./filters.ts";

const CONTENT_RATING = "pref_content_rating";
const CONTENT_RATING_DEFAULT = "pornographic";

const GENRES_ID_PREF = "pref_genre_id_exclude";

const SOURCE_DISPLAY_MODE = "pref_source_display_mode";
const SOURCE_DISPLAY_MODE_DEFAULT = "all";

const CLEAN_TITLE = "pref_clean_title";
const CLEAN_TITLE_DEFAULT = false;

const SHOW_SOURCE = "pref_show_source";
const SHOW_SOURCE_DEFAULT = false;

const SHOW_EDITION = "pref_show_edition";
const SHOW_EDITION_DEFAULT = false;

const DATA_SAVER = "data_saver_default";

const CHAPTER_TITLE_MODE = "chapter_title_mode";
const CHAPTER_TITLE_MODE_DEFAULT = "optional";
const CHAPTER_TITLE_MODES = ["optional", "always", "vol_local", "vol_chapter"];
const CHAPTER_TITLE_MODE_NAMES = [
  "Title only (e.g. 'Manga Title' / 'Ch.5')",
  "Ch.X + title (e.g. 'Ch.5 Manga Title')",
  "Vol.X Ch.Y (e.g. 'Vol.1 Ch.5')",
  "Vol.X Ch.Y + title (e.g. 'Vol.1 Ch.5 Manga Title')",
];

export default class Kagane extends KeiSource {
  private get kaganeLangs(): string[] {
    return this.lang === "zh" ? ["zh-Hans", "zh-Hant"] : [this.lang];
  }

  private get domain() {
    return this.baseUrl.replace(/^https:\/\//, "");
  }
  private get apiUrl() {
    return `https://${this.domain}/api/v2`;
  }

  private get prefs() {
    return this.preferences;
  }

  /** toJsonRequestBody(): the source headers plus the JSON media type. */
  private jsonHeaders(headers: Headers = this.headers): Headers {
    const h = new Headers(headers);
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.refreshTokenInterceptor(chain)).rateLimit(3);
  }

  private async refreshTokenInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const url = HttpUrl.parse(request.url);
    if (!url.toURL().searchParams.has("token")) {
      return chain.proceed(request);
    }

    const chapterId = url.pathSegments[4] === "datasaver" ? url.pathSegments[5] : url.pathSegments[4];

    let response = await chain.proceed({ ...request, url: url.newBuilder().setQueryParameter("token", this.accessToken).build().toString() });

    if (response.code === 401 || response.code === 403 || response.code === 507) {
      let challenge: ChallengeDto;
      try {
        challenge = await this.getChallengeResponse(chapterId);
      } catch {
        throw new Error("Failed to retrieve token");
      }

      this.accessToken = challenge.access_token;
      response = await chain.proceed({ ...request, url: url.newBuilder().setQueryParameter("token", this.accessToken).build().toString() });
    }

    return response;
  }

  // ============================== Popular ===============================

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(
      page,
      "",
      FilterList(new SortFilter({ index: 1, ascending: false }), new ContentRatingFilter(new Set(this.contentRating)), new GenresFilter([], this.excludedGenreIds)),
    );
  }

  // =============================== Latest ===============================

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(
      page,
      "",
      FilterList(new SortFilter({ index: 6, ascending: false }), new ContentRatingFilter(new Set(this.contentRating)), new GenresFilter([], this.excludedGenreIds)),
    );
  }

  // =============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let sortParam = "";

    const body: Record<string, unknown> = {};
    if (query.trim()) body.title = query;

    const displayMode = this.sourceDisplayMode;
    body.source_type = displayMode === "official" ? ["Official"] : ["Official", "Unofficial", "Mixed"];

    let genresMatchAll: boolean | null = null;
    let tagsMatchAll: boolean | null = null;

    for (const filter of filters) {
      if (filter instanceof MatchAllGenresFilter) genresMatchAll = filter.state ? true : null;
      else if (filter instanceof MatchAllTagsFilter) tagsMatchAll = filter.state ? true : null;
      else if (filter instanceof SortFilter) sortParam = filter.toUriPart();
    }

    for (const filter of filters) {
      if (filter instanceof GenresFilter) {
        filter.addToJsonObject(body, "genres", genresMatchAll);
      } else if (filter instanceof TagsSearchFilter) {
        const rawInput = filter.state.trim();
        if (rawInput) {
          const tagEntries = rawInput
            .split(",")
            .map((it) => it.trim())
            .filter((it) => it);

          const includeIds: string[] = [];
          const excludeIds: string[] = [];

          for (const entry of tagEntries) {
            const isExclude = entry.startsWith("-");
            const tagName = isExclude ? entry.slice(1).trim() : entry;

            const tagId = filter.tagData[tagName.toLowerCase()];
            if (tagId != null) (isExclude ? excludeIds : includeIds).push(tagId);
          }

          if (includeIds.length || excludeIds.length) {
            const tags: Record<string, unknown> = {};
            if (tagsMatchAll === true) tags.match_all = true;
            tags.values = includeIds;
            if (excludeIds.length) tags.exclude = excludeIds;
            body.tags = tags;
          }
        }
      } else if (filter instanceof SourcesFilter) {
        filter.addToJsonObject(body);
      } else if (isJsonFilter(filter)) {
        filter.addToJsonObject(body);
      }
    }

    // Add languages specific to this source instance
    body.content_lang = this.kaganeLangs;

    const url = HttpUrl.parse(`${this.apiUrl}/search/series`).newBuilder();
    url.addQueryParameter("page", String(page - 1));
    url.addQueryParameter("size", String(35)); // Default items per request
    if (sortParam) url.addQueryParameter("sort", sortParam);

    const response = await this.client.post(url.build().toString(), this.jsonHeaders(), JSON.stringify(body));
    const dto = response.parseAs<SearchDto>();
    const mangas = (dto.content ?? []).map((it) => bookToSManga(it, it.series_id, this.apiUrl, this.showSource, this.sources, this.cleanTitle));
    return new MangasPage(mangas, searchHasNextPage(dto));
  }

  // ====================== Manga Details + Chapters ======================

  private async getMangaById(seriesId: string): Promise<DetailsDto> {
    const url = `${this.apiUrl}/series/${seriesId}`;
    return (await this.client.get(url)).parseAs<DetailsDto>();
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const seriesId = segments[1];
    const manga = this.parseMangaDetails(await this.getMangaById(seriesId));
    manga.url = seriesId;
    manga.initialized = true;
    return manga;
  }

  private parseMangaDetails(details: DetailsDto): SManga {
    const sourceName = details.source_id != null ? (this.sources[details.source_id] ?? null) : null;
    return detailsToSManga(this.host, details, this.apiUrl, sourceName, this.baseUrl, this.showEdition, this.showSource, this.cleanTitle);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const seriesId = manga.url;
    const dto = await this.getMangaById(seriesId);

    const updatedManga = this.parseMangaDetails(dto);
    updatedManga.url = manga.url;
    if (dto.tracker_id) updatedManga.memo = { trackerId: dto.tracker_id };
    const updatedChapters = this.parseChapterList(dto, seriesId);

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private parseChapterList(details: DetailsDto, seriesId: string): SChapter[] {
    const useSourceChapterNumber = ["Dark Horse Comics", "Flame Comics", "MangaDex", "Square Enix Manga"].includes(details.format ?? "");

    return (details.series_books ?? []).map((book) => bookToSChapter(book, seriesId, useSourceChapterNumber, this.chapterTitleMode)).reverse();
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  // =========================== Related Manga ============================
  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const trackerId = manga.memo?.trackerId;
    if (typeof trackerId !== "string") return [];

    const series = (await this.client.get(`${this.apiUrl}/trackers/${trackerId}/series`)).parseAs<TrackerDto>().book_series ?? [];
    return series.map((it) => bookToSManga(it, it.id, this.apiUrl, this.showSource, this.sources, this.cleanTitle));
  }

  // =============================== Pages ================================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.url.includes(";")) {
      throw new Error("Outdated chapter URL. Please refresh the chapter list");
    }

    const chapterId = HttpUrl.parse(`${this.baseUrl}${chapter.url}`).pathSegments.at(-1)!;
    const challengeResp = await this.getChallengeResponse(chapterId);

    this.accessToken = challengeResp.access_token;
    const cacheUrl = challengeResp.cache_url;

    const pageList = challengeResp.manifest?.pages ?? [];

    return pageList.map((page) => {
      const pageUrl = HttpUrl.parse(`${cacheUrl}/api/v2/books/page`).newBuilder();
      if (this.dataSaver) pageUrl.addPathSegment("datasaver");
      pageUrl.addPathSegment(chapterId);
      pageUrl.addPathSegment(`${page.page_id}.${page.ext ?? "jxl"}`);
      pageUrl.addQueryParameter("token", this.accessToken);
      const s = pageUrl.build().toString();

      return new Page(page.page_no, s, s);
    });
  }

  private accessToken = "";
  private integrityToken = "";
  private integrityExp = Date.now();

  private async getIntegrityToken(): Promise<string> {
    if (this.integrityExp < Date.now()) {
      await this.client.get(`${this.baseUrl}/`);

      const res = (await this.client.post(`${this.baseUrl}/api/integrity`, this.jsonHeaders(), "")).parseAs<IntegrityDto>();
      this.integrityToken = res.token;
      this.integrityExp = res.exp * 1000;
    }

    return this.integrityToken;
  }

  private async getChallengeResponse(chapterId: string): Promise<ChallengeDto> {
    const integrityToken = await this.getIntegrityToken();

    const challengeUrl = HttpUrl.parse(`${this.apiUrl}/books/${chapterId}`).newBuilder().addQueryParameter("is_datasaver", String(this.dataSaver)).build();

    const headers = this.jsonHeaders();
    headers.append("x-integrity-token", integrityToken);

    const response = await this.client.post(challengeUrl.toString(), headers, "{}");

    return response.parseAs<ChallengeDto>();
  }

  // ============================ Preferences =============================

  private get contentRating(): string[] {
    const maxRating = this.prefs.getString(CONTENT_RATING, CONTENT_RATING_DEFAULT);
    const index = CONTENT_RATINGS.findIndex((it) => it === maxRating);
    return CONTENT_RATINGS.slice(0, Math.max(index, 0) + 1);
  }

  private get excludedGenreIds(): Set<string> {
    return new Set(this.prefs.getStringSet(GENRES_ID_PREF, []));
  }

  private get sourceDisplayMode(): string {
    return this.prefs.getString(SOURCE_DISPLAY_MODE, SOURCE_DISPLAY_MODE_DEFAULT) ?? SOURCE_DISPLAY_MODE_DEFAULT;
  }

  private get cleanTitle(): boolean {
    return this.prefs.getBoolean(CLEAN_TITLE, CLEAN_TITLE_DEFAULT);
  }

  private get showEdition(): boolean {
    return !this.cleanTitle && this.prefs.getBoolean(SHOW_EDITION, SHOW_EDITION_DEFAULT);
  }

  private get showSource(): boolean {
    return !this.cleanTitle && this.prefs.getBoolean(SHOW_SOURCE, SHOW_SOURCE_DEFAULT);
  }

  private get dataSaver(): boolean {
    return this.prefs.getBoolean(DATA_SAVER, false);
  }

  private get chapterTitleMode(): string {
    return this.prefs.getString(CHAPTER_TITLE_MODE, CHAPTER_TITLE_MODE_DEFAULT)!;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const rating = new ListPreference();
    rating.key = CONTENT_RATING;
    rating.title = "Content Rating";
    rating.entries = CONTENT_RATINGS.map((it) => it.charAt(0).toUpperCase() + it.slice(1));
    rating.entryValues = CONTENT_RATINGS;
    rating.summary = "%s";
    rating.setDefaultValue(CONTENT_RATING_DEFAULT);
    screen.addPreference(rating);

    const genreFilter = firstInstanceOrNull(this.getFilterList(this.filterData), GenresFilter);
    const genreMap = new Map((genreFilter?.state ?? []).map((it) => [it.id, it.name.charAt(0).toUpperCase() + it.name.slice(1)]));

    // setEnabled(genreMap.isNotEmpty()) and the summary listener have no equivalent in the app's settings form
    const genres = new MultiSelectListPreference();
    genres.key = GENRES_ID_PREF;
    genres.title = "Exclude Genres";
    genres.entries = [...genreMap.values()];
    genres.entryValues = [...genreMap.keys()];
    genres.summary = [...genreMap.keys()]
      .filter((it) => this.excludedGenreIds.has(it))
      .map((id) => genreMap.get(id))
      .join(", ");
    genres.setDefaultValue([]);
    screen.addPreference(genres);

    const display = new ListPreference();
    display.key = SOURCE_DISPLAY_MODE;
    display.title = "Source Display Selection";
    display.summary = "%s";
    display.entries = ["Show All (Official + Scanlations)", "Official Sources Only"];
    display.entryValues = ["all", "official"];
    display.setDefaultValue(SOURCE_DISPLAY_MODE_DEFAULT);
    screen.addPreference(display);

    const showEdition = new SwitchPreferenceCompat();
    showEdition.key = SHOW_EDITION;
    showEdition.title = "Show edition name in title";
    showEdition.setDefaultValue(SHOW_EDITION_DEFAULT);
    screen.addPreference(showEdition);

    const showSource = new SwitchPreferenceCompat();
    showSource.key = SHOW_SOURCE;
    showSource.title = "Show source name in title";
    showSource.setDefaultValue(SHOW_SOURCE_DEFAULT);
    screen.addPreference(showSource);

    const clean = new SwitchPreferenceCompat();
    clean.key = CLEAN_TITLE;
    clean.title = "Clean title";
    clean.summary = "Removes extra brackets or parentheses in title (Disables others)";
    clean.setDefaultValue(CLEAN_TITLE_DEFAULT);
    screen.addPreference(clean);

    const saver = new SwitchPreferenceCompat();
    saver.key = DATA_SAVER;
    saver.title = "Data saver";
    saver.setDefaultValue(false);
    screen.addPreference(saver);

    const mode = new ListPreference();
    mode.key = CHAPTER_TITLE_MODE;
    mode.title = "Chapter title format";
    mode.entries = CHAPTER_TITLE_MODE_NAMES;
    mode.entryValues = CHAPTER_TITLE_MODES;
    mode.summary = "How the chapter title should be displayed";
    mode.setDefaultValue(CHAPTER_TITLE_MODE_DEFAULT);
    screen.addPreference(mode);
  }

  // ============================= Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  /**
   * Upstream's no-arg getFilterList() reads KeiSource's cached filter data; the host keeps that cache here, so the
   * last fetched data is remembered for the `sources` map and the genre preference.
   */
  private filterData: unknown = null;

  override async fetchFilterData(): Promise<unknown> {
    const [genres, tags, sources] = await Promise.all([
      this.client.get(`${this.apiUrl}/genres/list`).then((r) => Object.fromEntries(r.parseAs<GenreDto[]>().map((it) => [it.id, it.genre_name]))),
      this.client.get(`${this.apiUrl}/tags/list`).then((r) => Object.fromEntries(r.parseAs<TagDto[]>().map((it) => [it.tag_name.toLowerCase(), it.id]))),
      this.client.post(`${this.apiUrl}/sources/list`, this.jsonHeaders(), JSON.stringify({ source_types: null })).then((r) => r.parseAs<SourcesDto>().sources),
    ]);

    const meta: MetadataDto = { genres, tags, sources };
    this.filterData = meta;
    return meta;
  }

  sourceCache: Record<string, string> | null = null;

  get sources(): Record<string, string> {
    if (!this.sourceCache || !Object.keys(this.sourceCache).length) {
      this.getFilterList(this.filterData);
    }
    return (this.sourceCache ??= {});
  }

  override getFilterList(data: unknown = null): FilterList {
    const meta = data != null ? (typeof data === "string" ? parseAs<MetadataDto>(data) : (data as MetadataDto)) : null;

    const filters: Filter[] = [new SortFilter(), new ContentRatingFilter(new Set(this.contentRating)), new FormatFilter(), new PublicationStatusFilter(), new Filter.Separator()];

    if (meta != null) {
      this.filterData = meta;
      this.sourceCache = Object.fromEntries(meta.sources.map((it) => [it.source_id, it.title]));

      const displayMode = this.sourceDisplayMode;
      const validSources = meta.sources.filter((source) => (displayMode === "official" ? source.source_type.toLowerCase() === "official" : true));

      const sourceFilters = validSources.map((it) => new FilterData(it.source_id, it.title)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      filters.push(new MatchAllGenresFilter(), new GenresFilter(getGenresList(meta), this.excludedGenreIds), new MatchAllTagsFilter(), new TagsSearchFilter(meta.tags), new SourcesFilter(sourceFilters));
    }

    return FilterList(...filters);
  }
}
