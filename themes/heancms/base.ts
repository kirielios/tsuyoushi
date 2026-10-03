// Port of keiyoushi/extensions-source lib-multisrc/heancms/HeanCms.kt
import {
  EditTextPreference,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseHtml,
  substringAfterLast,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  type Filter,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import {
  chapterToSChapter,
  hasNextPage,
  seriesToSManga,
  tokenIsExpired,
  type HeanCmsChapterDto,
  type HeanCmsChapterPayloadDto,
  type HeanCmsErrorsDto,
  type HeanCmsGenreDto,
  type HeanCmsPagePayloadDto,
  type HeanCmsQuerySearchDto,
  type HeanCmsSeriesDto,
  type HeanCmsTokenPayloadDto,
} from "./dto.ts";
import { Genre, GenreFilter, SortByFilter, StatusFilter, type SortProperty, type Status } from "./filters.ts";

const ACCEPT_IMAGE = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const ACCEPT_JSON = "application/json, text/plain, */*";

const PER_PAGE_CHAPTERS = 1000;

const SHOW_PAID_CHAPTERS_PREF = "pref_show_paid_chap";
const SHOW_PAID_CHAPTERS_DEFAULT = false;

const USER_PREF = "pref_user";
const PASSWORD_PREF = "pref_password";

const TOKEN_PREF = "pref_token";
/** Not upstream: stands in for the change listeners that clear the token when the credentials are edited. */
const TOKEN_CREDENTIALS_PREF = "pref_token_credentials";

export abstract class HeanCms extends KeiSource {
  protected get apiUrl(): string {
    return this.baseUrl.replace("://", "://api.");
  }

  /** Whether the source supports login and gated (paid) chapters behind a bearer token. */
  protected enableLogin = false;

  protected coverPath = "";

  protected get cdnUrl(): string {
    return this.apiUrl;
  }

  protected mangaSubDirectory = "series";

  protected latestSortBy = "desc";

  private toSManga(s: HeanCmsSeriesDto): SManga {
    return seriesToSManga(s, this.cdnUrl, this.coverPath, this.mangaSubDirectory, (html) => parseHtml(this.host.load, html, this.baseUrl));
  }

  private async authHeaders(): Promise<Headers> {
    if (!this.enableLogin || !this.user || !this.password) return this.headers;

    // setOnPreferenceChangeListener upstream: editing the credentials resets the token
    const credentials = JSON.stringify([this.user, this.password]);
    if (this.preferences.getString(TOKEN_CREDENTIALS_PREF, "") !== credentials) {
      this.tokenData = {};
      this.preferences.edit().putString(TOKEN_CREDENTIALS_PREF, credentials).apply();
    }

    const tokenData = this.tokenData;
    const token = tokenIsExpired(tokenData) ? await this.getToken() : tokenData.token;

    if (token != null) {
      const headers = this.headers;
      headers.append("Authorization", `Bearer ${token}`);
      return headers;
    }
    return this.headers;
  }

  private async getToken(): Promise<string | null> {
    const body = new URLSearchParams();
    body.append("email", this.user);
    body.append("password", this.password);

    const response = await this.client.post(`${this.apiUrl}/login`, this.headers, body, { ensureSuccess: false });

    if (!response.isSuccessful) {
      const result = response.parseAs<HeanCmsErrorsDto>();
      const message = result.errors?.[0]?.message ?? "Unknown error occurred while logging in";
      throw new Error(message);
    }

    const result = response.parseAs<HeanCmsTokenPayloadDto>();
    this.tokenData = result;
    return result.token ?? null;
  }

  // ============================== Popular ==============================

  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.queryUrlBuilder(page, "", "All", "desc", "total_views", "[]");
    return this.parseSearchMangaList(await this.client.get(url));
  }

  // ============================== Latest ===============================

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.queryUrlBuilder(page, "", "All", this.latestSortBy, "latest", "[]");
    return this.parseSearchMangaList(await this.client.get(url));
  }

  // ============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortByFilter = filters.find((it) => it instanceof SortByFilter);
    const statusFilter = filters.find((it) => it instanceof StatusFilter);

    const tagIds =
      "[" +
      (filters.find((it) => it instanceof GenreFilter)?.state ?? [])
        .filter((it) => it.state)
        .map((it) => it.id)
        .join(",") +
      "]";

    const url = this.queryUrlBuilder(page, query, statusFilter?.selected?.value ?? "All", sortByFilter?.state?.ascending === true ? "asc" : "desc", sortByFilter?.selected ?? "total_views", tagIds);

    return this.parseSearchMangaList(await this.client.get(url));
  }

  private queryUrlBuilder(page: number, query: string, status: string, order: string, orderBy: string, tagIds: string): string {
    return toHttpUrl(`${this.apiUrl}/query`)
      .newBuilder()
      .addQueryParameter("query_string", query)
      .addQueryParameter("status", status)
      .addQueryParameter("order", order)
      .addQueryParameter("orderBy", orderBy)
      .addQueryParameter("series_type", "Comic")
      .addQueryParameter("page", String(page))
      .addQueryParameter("perPage", "12")
      .addQueryParameter("tags_ids", tagIds)
      .addQueryParameter("adult", "true")
      .build()
      .toString();
  }

  private parseSearchMangaList(response: Response): MangasPage {
    const result = response.parseAs<HeanCmsQuerySearchDto>();
    const mangaList = (result.data ?? []).map((it) => this.toSManga(it));
    return new MangasPage(mangaList, result.meta ? hasNextPage(result.meta) : false);
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/tags`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = Array.isArray(data) ? (data as HeanCmsGenreDto[]).map((it) => new Genre(it.name, it.id)) : null;

    const filters: Filter[] = [new StatusFilter("Status", this.getStatusList()), new SortByFilter("Sort By", this.getSortProperties())];

    if (genres?.length) filters.push(new GenreFilter("Genres", genres));

    return FilterList(...filters);
  }

  protected getStatusList(): Status[] {
    return [
      { name: "All", value: "All" },
      { name: "Ongoing", value: "Ongoing" },
      { name: "On hiatus", value: "Hiatus" },
      { name: "Dropped", value: "Dropped" },
      { name: "Completed", value: "Completed" },
      { name: "Canceled", value: "Canceled" },
    ];
  }

  protected getSortProperties(): SortProperty[] {
    return [
      { name: "Title", value: "title" },
      { name: "Views", value: "total_views" },
      { name: "Latest", value: "latest" },
      { name: "Created at", value: "created_at" },
    ];
  }

  // ============================== Related ==============================

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const genreNames = new Set((manga.genre?.split(", ") ?? []).filter((it) => it.trim()));

    const filters = this.getFilterList();
    const genreFilter = filters.find((it) => it instanceof GenreFilter);
    genreFilter?.state.forEach((it) => (it.state = genreNames.has(it.name)));

    let result: MangasPage;
    if (genreFilter?.state?.some((it) => it.state) === true) {
      result = await this.getSearchMangaList(1, "", filters);
    } else {
      const author = manga.author?.trim() ?? "";
      if (!author) return [];
      result = await this.getSearchMangaList(1, author, FilterList());
    }
    return result.mangas;
  }

  // ============================== Details ==============================

  private async fetchSeries(slug: string): Promise<HeanCmsSeriesDto> {
    const apiHeaders = this.headers;
    apiHeaders.append("Accept", ACCEPT_JSON);
    return (await this.client.get(`${this.apiUrl}/series/${slug}`, apiHeaders)).parseAs<HeanCmsSeriesDto>();
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) throw new Error("Unsupported URL");

    const slug = toHttpUrl(url.href).pathSegments[1];
    if (slug == null) throw new Error("Unsupported URL");

    const manga = this.toSManga(await this.fetchSeries(slug));
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    const seriesSlug = substringBefore(substringAfterLast(manga.url, "/"), "#");
    return `${this.baseUrl}/${this.mangaSubDirectory}/${seriesSlug}`;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!manga.url.includes("#")) {
      throw new Error(`The URL of the series has changed. Migrate from ${this.name} to ${this.name} to update the URL`);
    }

    const slug = substringBefore(substringAfterLast(manga.url, "/"), "#");
    const seriesId = substringAfterLast(manga.url, "#");

    const [m, c] = await Promise.all([
      fetchDetails ? this.fetchSeries(slug).then((it) => this.toSManga(it)) : Promise.resolve(manga),
      fetchChapters ? this.fetchChapters(seriesId, slug) : Promise.resolve(chapters),
    ]);
    return new SMangaUpdate(m, c);
  }

  private async fetchChapters(seriesId: string, seriesSlug: string): Promise<SChapter[]> {
    const showPaidChapters = this.showPaidChapters;
    const currentTimestamp = Date.now();
    const apiHeaders = this.headers;
    apiHeaders.append("Accept", ACCEPT_JSON);

    const chapterList: HeanCmsChapterDto[] = [];
    let page = 1;
    let next: boolean;
    do {
      const url = toHttpUrl(`${this.apiUrl}/chapter/query`)
        .newBuilder()
        .addQueryParameter("page", String(page))
        .addQueryParameter("perPage", String(PER_PAGE_CHAPTERS))
        .addQueryParameter("series_id", seriesId)
        .build();

      const result = (await this.client.get(url.toString(), apiHeaders)).parseAs<HeanCmsChapterPayloadDto>();
      chapterList.push(...result.data);
      next = hasNextPage(result.meta);
      page++;
    } while (next);

    return chapterList
      .filter((it) => it.price === 0 || showPaidChapters)
      .map((it) => chapterToSChapter(it, seriesSlug, this.mangaSubDirectory))
      .filter((it) => it.date_upload <= currentTimestamp);
  }

  // ============================== Pages ==============================

  override getChapterUrl(chapter: SChapter) {
    return this.baseUrl + substringBeforeLast(chapter.url, "#");
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = this.apiUrl + chapter.url.replace(`/${this.mangaSubDirectory}/`, "/chapter/");
    const result = (await this.client.get(url, await this.authHeaders())).parseAs<HeanCmsPagePayloadDto>();

    if ((result.paywall ?? false) && result.chapter.chapter_data == null) throw new Error("Paid chapter unavailable.");

    return (result.chapter.chapter_data?.images ?? []).map((img, i) => new Page(i, "", this.toAbsoluteUrl(img)));
  }

  /** Kotlin's String.toAbsoluteUrl() extension. */
  protected toAbsoluteUrl(s: string): string {
    return s.startsWith("https://") || s.startsWith("http://") ? s : `${this.cdnUrl}/${this.coverPath}${s}`;
  }

  override imageRequest(page: Page) {
    const imageHeaders = this.headers;
    imageHeaders.append("Accept", ACCEPT_IMAGE);
    return { url: page.imageUrl!, headers: imageHeaders };
  }

  // ============================== Preferences ==============================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const paid = new SwitchPreferenceCompat(screen.context);
    paid.key = SHOW_PAID_CHAPTERS_PREF;
    paid.title = "Display paid chapters";
    // summaryOn / summaryOff: the settings form shows one summary, so it follows the current value
    paid.summary = this.showPaidChapters ? "Paid chapters will appear." : "Only free chapters will be displayed.";
    paid.setDefaultValue(SHOW_PAID_CHAPTERS_DEFAULT);
    screen.addPreference(paid);

    if (this.enableLogin) {
      const user = new EditTextPreference(screen.context);
      user.key = USER_PREF;
      user.title = "Username/Email";
      user.summary = "Ignored if empty.";
      user.setDefaultValue("");
      screen.addPreference(user);

      const password = new EditTextPreference(screen.context);
      password.key = PASSWORD_PREF;
      password.title = "Password";
      password.summary = "Ignored if empty.";
      password.setDefaultValue("");
      screen.addPreference(password);
    }
  }

  private get showPaidChapters(): boolean {
    return this.preferences.getBoolean(SHOW_PAID_CHAPTERS_PREF, SHOW_PAID_CHAPTERS_DEFAULT);
  }

  private get user(): string {
    return this.preferences.getString(USER_PREF, "") ?? "";
  }

  private get password(): string {
    return this.preferences.getString(PASSWORD_PREF, "") ?? "";
  }

  private get tokenData(): HeanCmsTokenPayloadDto {
    return JSON.parse(this.preferences.getString(TOKEN_PREF, "{}")!) as HeanCmsTokenPayloadDto;
  }
  private set tokenData(data: HeanCmsTokenPayloadDto) {
    this.preferences.edit().putString(TOKEN_PREF, JSON.stringify(data)).apply();
  }
}
