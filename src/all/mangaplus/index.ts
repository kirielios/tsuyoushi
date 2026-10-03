// Port of keiyoushi/extensions-source src/all/mangaplus/MangaPlus.kt
import {
  ClientBuilder,
  FilterList,
  Intl,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  PreferenceScreen,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  decodeProto,
  distinctBy,
  firstInstance,
  firstInstanceOrNull,
  hexBytes,
  substringAfterLast,
  type Chain,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import {
  LANGUAGE_ENGLISH,
  LANGUAGE_FRENCH,
  LANGUAGE_GERMAN,
  LANGUAGE_INDONESIAN,
  LANGUAGE_PORTUGUESE_BR,
  LANGUAGE_RUSSIAN,
  LANGUAGE_SPANISH,
  LANGUAGE_THAI,
  LANGUAGE_VIETNAMESE,
  MangaPlusResponseSchema,
  chapterListOf,
  chapterToSChapter,
  isExpired,
  langPopup,
  titleDetailToSManga,
  titleLanguage,
  titleToSManga,
  type MangaPlusResponse,
  type Popup,
  type SuccessResult,
  type TagName,
  type Title,
  type TitleDetailView,
} from "./dto.ts";
import { GenreFilter, TypeFilter } from "./filters.ts";
import { messages } from "./messages.ts";

const API_URL = "https://jumpg-webapi.tokyo-cdn.com/api";

const MANGAPLUS_HOSTS = ["mangaplus.shueisha.co.jp", "www.mangaplus.shueisha.co.jp", "jumpg-webapi.tokyo-cdn.com", "www.jumpg-webapi.tokyo-cdn.com"];

const QUALITY_PREF_KEY = "imageResolution";
const QUALITY_PREF_ENTRY_VALUES = ["low", "high", "super_high"];
const QUALITY_PREF_DEFAULT_VALUE = QUALITY_PREF_ENTRY_VALUES[2];

const SPLIT_PREF_KEY = "splitImage";
const SPLIT_PREF_DEFAULT_VALUE = true;

const SUBTITLE_ONLY_KEY = "subtitleOnly";
const SUBTITLE_ONLY_DEFAULT_VALUE = false;

const NOT_FOUND_SUBJECT = "Not Found";

const parseAsProto = (response: Response): MangaPlusResponse => decodeProto<MangaPlusResponse>(response.bytes(), MangaPlusResponseSchema);

export default class MangaPlus extends KeiSource {
  private get internalLangName(): string {
    switch (this.lang) {
      case "en": return "eng";
      case "es": return "esp";
      case "fr": return "fra";
      case "id": return "ind";
      case "pt-BR": return "ptb";
      case "ru": return "rus";
      case "th": return "tha";
      case "vi": return "vie";
      case "de": return "deu";
      default: throw new Error(`Unsupported lang: ${this.lang}`);
    }
  }

  private get internalLangCode(): number {
    switch (this.lang) {
      case "en": return LANGUAGE_ENGLISH;
      case "es": return LANGUAGE_SPANISH;
      case "fr": return LANGUAGE_FRENCH;
      case "id": return LANGUAGE_INDONESIAN;
      case "pt-BR": return LANGUAGE_PORTUGUESE_BR;
      case "ru": return LANGUAGE_RUSSIAN;
      case "th": return LANGUAGE_THAI;
      case "vi": return LANGUAGE_VIETNAMESE;
      case "de": return LANGUAGE_GERMAN;
      default: throw new Error(`Unsupported lang: ${this.lang}`);
    }
  }

  private get apiUrlHost() {
    return new URL(API_URL).host;
  }
  private get baseUrlHost() {
    return new URL(this.baseUrl).host;
  }

  private readonly session = globalThis.crypto.randomUUID();

  protected configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addInterceptor((request) => this.sessionTokenIntercept(request))
      .addChainInterceptor((chain) => this.imageIntercept(chain))
      .rateLimit(1, 1000, (it) => it.host === this.apiUrlHost)
      .rateLimit(2, 1000, (it) => it.host === this.baseUrlHost);
  }

  private sessionTokenIntercept(request: Request): Request {
    if (new URL(request.url).host !== this.apiUrlHost) return request;
    const headers = new Headers(request.headers);
    headers.set("SESSION-TOKEN", this.session);
    return { ...request, headers };
  }

  private _intl?: Intl;
  private get intl(): Intl {
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "pt-BR", "vi"], messages }));
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const result = parseAsProto(await this.client.get(`${API_URL}/title_list/rankingV2?lang=${this.internalLangName}&type=hottest&clang=${this.internalLangName}`));

    const titles = this.filterByLang(this.successOrThrow(result).titleRankingView!.rankedTitles.flatMap((it) => it.titles));

    return new MangasPage(titles.map(titleToSManga), false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const result = parseAsProto(await this.client.get(`${API_URL}/web/web_homeV4?lang=${this.internalLangName}&clang=${this.internalLangName}`));

    const webHomeView = this.successOrThrow(result).webHomeView!;
    const entries = [...webHomeView.groups.flatMap((it) => it.titles), ...(webHomeView.featured?.title ? [webHomeView.featured.title] : [])];
    const titles = this.filterByLang(
      entries
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .flatMap((it) => it.latestChapters)
        .map((it) => it.title),
    ).map(titleToSManga);

    return new MangasPage(titles, false);
  }

  // =============================== Search ===============================

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const typeFilter = firstInstance(filters, TypeFilter);
    const genreSlug = firstInstanceOrNull(filters, GenreFilter)?.slug ?? "";

    // allV2 returns everything while v3 returns based on type filter (serializations/completed etc.)
    const useAllTitles = query.length > 0 && genreSlug.length === 0 && typeFilter.isDefault;

    let titles: Title[];
    if (useAllTitles) {
      titles = this.filterByLang(
        this.successOrThrow(parseAsProto(await this.client.get(`${API_URL}/title_list/allV2`))).allTitlesView!.allTitlesGroup.flatMap((it) => it.titles),
      );
    } else {
      titles = this.filterByLang(
        this.successOrThrow(parseAsProto(await this.client.get(this.allTitlesV3Url(typeFilter.type))))
          .allTitlesViewV3!.titles.filter((it) => genreSlug.length === 0 || it.genres.some((genre) => genre.slug === genreSlug))
          .map((it) => it.title),
      );
    }

    const q = query.toLowerCase();
    const filtered = titles.filter((title) => query.length === 0 || (title.name ?? "").toLowerCase().includes(q) || (title.author ?? "").toLowerCase().includes(q));

    return new MangasPage(filtered.map(titleToSManga), false);
  }

  get supportsFilterFetching(): boolean {
    return true;
  }

  async fetchFilterData(): Promise<unknown> {
    const result = parseAsProto(await this.client.get(this.allTitlesV3Url(TypeFilter.DEFAULT_TYPE)));
    return result.success?.allTitlesViewV3?.tags ?? [];
  }

  getFilterList(data: unknown = null): FilterList {
    const genres = (data as TagName[] | null) ?? [];
    const list: FilterList = [new TypeFilter()];
    if (genres.length > 0) list.push(new GenreFilter(genres));
    return list;
  }

  protected async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (!MANGAPLUS_HOSTS.includes(url.host)) return null;

    const pathSegments = url.pathname.split("/").slice(1);
    let titleId: string | null | undefined = null;
    if (pathSegments[0] === "titles") titleId = pathSegments[1];
    else if (pathSegments[0] === "viewer") titleId = pathSegments[1] != null ? await this.titleIdFromChapter(pathSegments[1]) : null;
    else if (pathSegments[pathSegments.length - 1] === "sns_share") titleId = url.searchParams.get("title_id");
    if (!titleId) return null;

    const titleDetail = await this.getTitleDetails(titleId);
    if (titleLanguage(titleDetail.title) !== this.internalLangCode) return null;

    return titleDetailToSManga(titleDetail);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const titleDetail = await this.getTitleDetails(substringAfterLast(manga.url, "/"));
    if (titleLanguage(titleDetail.title) !== this.internalLangCode) throw new Error(this.intl.get("not_available"));

    const subtitleOnly = this.subtitleOnly();
    const chapterList = chapterListOf(titleDetail)
      .filter((it) => !isExpired(it))
      .map((it) => chapterToSChapter(it, subtitleOnly))
      .reverse();

    return new SMangaUpdate(titleDetailToSManga(titleDetail), chapterList);
  }

  get supportsRelatedMangas(): boolean {
    return true;
  }

  async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const genres = new Set((manga.genre?.split(", ") ?? []).filter((it) => it.length > 0));
    if (genres.size === 0) return [];

    const titleId = substringAfterLast(manga.url, "/");
    const result = parseAsProto(await this.client.get(this.allTitlesV3Url(TypeFilter.DEFAULT_TYPE)));

    return this.filterByLang((result.success?.allTitlesViewV3?.titles ?? []).filter((entry) => entry.genres.some((it) => genres.has(it.name ?? ""))).map((it) => it.title))
      .filter((it) => String(it.titleId ?? 0) !== titleId)
      .map(titleToSManga);
  }

  // Remove the '#' and map to the url format used on the website.
  getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url.substring(1);
  }

  getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url.substring(1);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = substringAfterLast(chapter.url, "/");
    const result = parseAsProto(await this.client.get(this.mangaViewerUrl(chapterId)));

    const viewer = this.successOrThrow(result, (error) => {
      if (error?.subject === NOT_FOUND_SUBJECT) return this.intl.get("chapter_expired");
      if (error?.body) return error.body;
      return this.intl.get("unknown_error");
    }).mangaViewer!;

    const viewToken = viewer.viewToken ?? "";

    return viewer.pages
      .map((it) => it.mangaPage)
      .filter((it) => it != null)
      .map((page, i) => {
        const encryptionKey = page.encryptionKey != null ? `#${page.encryptionKey}` : "";
        return new Page(i, viewToken, (page.imageUrl ?? "") + encryptionKey);
      });
  }

  imageRequest(page: Page): { url: string; headers: Headers } {
    const imageHeaders = this.headersBuilder();
    imageHeaders.set("Plus-Vw-Token", page.url);
    return { url: page.imageUrl!, headers: imageHeaders };
  }

  private async getTitleDetails(titleId: string): Promise<TitleDetailView> {
    const result = parseAsProto(await this.client.get(`${API_URL}/title_detailV3?title_id=${titleId}&clang=${this.internalLangName}`));

    return this.successOrThrow(result, (error) => {
      if (error?.subject === NOT_FOUND_SUBJECT) return this.intl.get("title_removed");
      if (error?.body) return error.body;
      return this.intl.get("unknown_error");
    }).titleDetailView!;
  }

  private async titleIdFromChapter(chapterId: string): Promise<string | null> {
    const result = parseAsProto(await this.client.get(this.mangaViewerUrl(chapterId)));
    const titleId = result.success?.mangaViewer?.titleId;
    return titleId != null ? String(titleId) : null;
  }

  private mangaViewerUrl(chapterId: string): string {
    const url = new URL(`${API_URL}/manga_viewer_v3`);
    url.searchParams.append("chapter_id", chapterId);
    url.searchParams.append("split", this.splitImages() ? "yes" : "no");
    url.searchParams.append("img_quality", this.imageQuality());
    url.searchParams.append("clang", this.internalLangName);
    return url.toString();
  }

  private allTitlesV3Url(type: string): string {
    return `${API_URL}/title_list/all_v3?type=${type}&lang=${this.internalLangName}&clang=${this.internalLangName}`;
  }

  private filterByLang(titles: Title[]): Title[] {
    return distinctBy(
      titles.filter((it) => (it.titleId ?? 0) !== 0 && titleLanguage(it) === this.internalLangCode),
      (it) => it.titleId,
    );
  }

  private successOrThrow(response: MangaPlusResponse, errorMessage: (popup: Popup | undefined) => string = (it) => (it?.body ? it.body : this.intl.get("unknown_error"))): SuccessResult {
    if (response.success) return response.success;
    throw new Error(errorMessage(response.error ? langPopup(response.error, this.internalLangCode) : undefined));
  }

  private async imageIntercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    const response = await chain.proceed(request);
    const encryptionKey = new URL(request.url).hash.slice(1);

    if (encryptionKey.length === 0) {
      return response;
    }

    const keyStream = hexBytes(encryptionKey);
    const bytes = new Uint8Array(response.bytes());
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] ^= keyStream[i % keyStream.length];
    }
    return response.withBody(bytes);
  }

  // ============================= Preferences ============================

  setupPreferenceScreen(screen: PreferenceScreen): void {
    const quality = new ListPreference(screen.context);
    quality.key = `${QUALITY_PREF_KEY}_${this.lang}`;
    quality.title = this.intl.get("image_quality");
    quality.entries = [this.intl.get("image_quality_low"), this.intl.get("image_quality_medium"), this.intl.get("image_quality_high")];
    quality.entryValues = QUALITY_PREF_ENTRY_VALUES;
    quality.setDefaultValue(QUALITY_PREF_DEFAULT_VALUE);
    quality.summary = "%s";
    screen.addPreference(quality);

    const split = new SwitchPreferenceCompat(screen.context);
    split.key = `${SPLIT_PREF_KEY}_${this.lang}`;
    split.title = this.intl.get("split_double_pages");
    split.summary = this.intl.get("split_double_pages_summary");
    split.setDefaultValue(SPLIT_PREF_DEFAULT_VALUE);
    screen.addPreference(split);

    const subtitle = new SwitchPreferenceCompat(screen.context);
    subtitle.key = `${SUBTITLE_ONLY_KEY}_${this.lang}`;
    subtitle.title = this.intl.get("subtitle_only");
    subtitle.summary = this.intl.get("subtitle_only_summary");
    subtitle.setDefaultValue(SUBTITLE_ONLY_DEFAULT_VALUE);
    screen.addPreference(subtitle);
  }

  private imageQuality(): string {
    return this.preferences.getString(`${QUALITY_PREF_KEY}_${this.lang}`, QUALITY_PREF_DEFAULT_VALUE)!;
  }

  private splitImages(): boolean {
    return this.preferences.getBoolean(`${SPLIT_PREF_KEY}_${this.lang}`, SPLIT_PREF_DEFAULT_VALUE);
  }

  private subtitleOnly(): boolean {
    return this.preferences.getBoolean(`${SUBTITLE_ONLY_KEY}_${this.lang}`, SUBTITLE_ONLY_DEFAULT_VALUE);
  }
}
