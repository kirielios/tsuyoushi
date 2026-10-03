// Port of keiyoushi/extensions-source src/all/globalcomix/GlobalComix.kt (+ GlobalComixConstants.kt, dto/*.kt)
import {
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SwitchPreferenceCompat,
  toHttpUrl,
  type ClientBuilder,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import { messages } from "./messages.ts";

// --- GlobalComixConstants.kt
const LOCK_SYMBOL = "🔒";
const ENGLISH = "en";
const WEB_URL = "https://globalcomix.com";
const WEB_COMIC_URL = `${WEB_URL}/c`;
const WEB_CHAPTER_URL = `${WEB_URL}/read`;
const API_URL = "https://api.globalcomix.com/v1";
const API_MANGA_URL = `${API_URL}/read`;
const API_CHAPTER_URL = `${API_URL}/readV2`;
const API_SEARCH_URL = `${API_URL}/comics`;
const CLIENT_ID = "gck_d0f170d5729446dcb3b55e6b3ebc7bf6";
const PREFIX_ID_SEARCH = "id:";
const getDataSaverPreferenceKey = (extLang: string) => `dataSaver_${extLang}`;
const getShowLockedChaptersPreferenceKey = (extLang: string) => `showLockedChapters_${extLang}`;

// --- dto
interface PaginationStateDto {
  page?: number;
  per_page?: number;
  total_pages?: number;
  total_results?: number;
}
const hasNextPage = (p: PaginationStateDto) => (p.page ?? 1) < (p.total_pages ?? 0);
interface PaginatedResponseDto<T> {
  payload?: { results?: T[]; pagination: PaginationStateDto } | null;
}
interface ResponseDto<T> {
  payload?: { results: T } | null;
}
interface PageDataDto {
  is_page_paid: boolean;
  desktop_image_url: string;
  mobile_image_url: string;
}
interface ChapterDataDto {
  id?: number;
  title: string;
  chapter: string; // Stringified number
  key: string; // UUID, required for /readV2 endpoint
  premium_only?: number | null;
  published_time: string;
  page_objects?: PageDataDto[] | null;
}
interface MangaDataDto {
  id?: number;
  name: string;
  description?: string | null;
  status_name?: string | null;
  category_name?: string | null;
  image_url?: string | null;
  artist: { name: string; roman_name?: string | null };
}

const isPremium = (c: ChapterDataDto) => (c.premium_only ?? 0) === 1;

/** SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US) in UTC; tryParse -> 0 on failure. */
function tryParseDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return 0;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

function createChapter(c: ChapterDataDto): SChapter {
  const chapterName: string[] = [];
  if (isPremium(c)) chapterName.push(LOCK_SYMBOL);
  if (c.chapter.length > 0) chapterName.push(`Ch.${c.chapter}`);
  if (c.title.length > 0) {
    if (chapterName.length > 0) chapterName.push("-");
    chapterName.push(c.title);
  }
  const chapter = SChapter.create();
  chapter.url = c.key;
  chapter.name = chapterName.join(" ");
  // toFloatOrNull() ?: 0f
  const n = Number(c.chapter);
  chapter.chapter_number = c.chapter.trim() !== "" && Number.isFinite(n) ? n : 0;
  chapter.date_upload = tryParseDate(c.published_time);
  return chapter;
}

function convertStatus(status: string): number {
  switch (status) {
    case "Ongoing":
    case "Preview":
      return SManga.ONGOING;
    case "Finished":
      return SManga.COMPLETED;
    case "On hold":
      return SManga.ON_HIATUS;
    case "Cancelled":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

function createManga(m: MangaDataDto): SManga {
  const it = SManga.create();
  it.initialized = true;
  it.url = String(m.id ?? -1);
  it.description = m.description ?? undefined;
  it.author = m.artist.roman_name ?? m.artist.name;
  it.status = m.status_name != null ? convertStatus(m.status_name) : SManga.UNKNOWN;
  it.genre = m.category_name ?? undefined;
  it.title = m.name;
  it.thumbnail_url = m.image_url ?? undefined;
  return it;
}

const titleSpecialCharactersRegex = /[^a-z0-9]+/g;
export const titleToSlug = (title: string) => title.trim().toLowerCase().replace(titleSpecialCharactersRegex, "-");

export default class GlobalComix extends HttpSource {
  // the site's own lang codes for these differ from Tachiyomi's lang codes
  private get extLang(): string {
    switch (this.lang) {
      case "sq":
        return "al";
      case "pt-BR":
        return "br";
      case "zh-Hans":
        return "cn";
      case "cs":
        return "cz";
      case "da":
        return "dk";
      case "fil":
        return "fo";
      case "he":
        return "iw";
      case "ja":
        return "jp";
      case "ko":
        return "kr";
      case "ms":
        return "my";
      case "sv":
        return "se";
      case "uk":
        return "ua";
      case "zh-Hant":
        return "zh";
      default:
        return this.lang;
    }
  }

  override get supportsLatest() {
    return true;
  }

  private _intl?: Intl;
  private get intl() {
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: ENGLISH, availableLanguages: [ENGLISH], messages }));
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Referer", `${this.baseUrl}/`);
    h.set("Origin", this.baseUrl);
    h.set("x-gc-client", CLIENT_ID);
    h.set("x-gc-identmode", "cookie");
    return h;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(3);
  }

  private simpleQueryRequest(page: number, orderBy: string | null, query: string | null): Request {
    const url = toHttpUrl(API_SEARCH_URL).newBuilder().addQueryParameter("lang_id[]", this.extLang).addQueryParameter("p", String(page));
    if (orderBy != null) url.addQueryParameter("sort", orderBy);
    if (query != null) url.addQueryParameter("q", query);
    return GET(url.build(), this.headers);
  }

  protected popularMangaRequest(page: number): Request {
    return this.simpleQueryRequest(page, null, null);
  }
  protected popularMangaParse(response: Response): MangasPage {
    return this.mangaListParse(response);
  }
  protected latestUpdatesRequest(page: number): Request {
    return this.simpleQueryRequest(page, "recent", null);
  }
  protected latestUpdatesParse(response: Response): MangasPage {
    return this.mangaListParse(response);
  }

  private mangaListParse(response: Response): MangasPage {
    const isSingleItemLookup = response.url.startsWith(API_MANGA_URL);
    if (!isSingleItemLookup) {
      // Normally, the response is a paginated list of mangas
      const dto = response.parseAs<PaginatedResponseDto<MangaDataDto>>().payload!;
      return new MangasPage((dto.results ?? []).map(createManga), hasNextPage(dto.pagination));
    }
    // However, when using the 'id:' query prefix (via the UrlActivity for example), the response is a single manga
    return new MangasPage([createManga(response.parseAs<ResponseDto<MangaDataDto>>().payload!.results)], false);
  }

  // upstream handles URLs in fetchSearchManga, so bypass KeiSource's URL handling
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = toHttpUrl(query);
      if (url.host !== toHttpUrl(this.baseUrl).host) throw new Error("Unsupported url");
      const titleId = url.pathSegments[1];
      return super.fetchSearchManga(page, `${PREFIX_ID_SEARCH}${titleId}`, filters);
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    // If the query is a slug ID, return the manga directly
    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const mangaSlugId = query.slice(PREFIX_ID_SEARCH.length);
      if (mangaSlugId.length === 0) throw new Error(this.intl.get("invalid_manga_id"));
      return GET(toHttpUrl(API_MANGA_URL).newBuilder().addPathSegment(mangaSlugId).build(), this.headers);
    }
    return this.simpleQueryRequest(page, "relevance", query);
  }
  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  override getMangaUrl(manga: SManga): string {
    return `${WEB_COMIC_URL}/${titleToSlug(manga.title)}`;
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(toHttpUrl(API_MANGA_URL).newBuilder().addPathSegment(titleToSlug(manga.title)).build(), this.headers);
  }
  protected mangaDetailsParse(response: Response): SManga {
    return createManga(response.parseAs<ResponseDto<MangaDataDto>>().payload!.results);
  }

  protected override chapterListRequest(manga: SManga): Request {
    const url = toHttpUrl(API_SEARCH_URL)
      .newBuilder()
      .addPathSegment(manga.url) // manga.url contains the the comic id
      .addPathSegment("releases")
      .addQueryParameter("lang_id", this.extLang)
      .addQueryParameter("all", "true")
      .toString();
    return GET(url, this.headers);
  }
  protected chapterListParse(response: Response): SChapter[] {
    const showLocked = this.showLockedChapters;
    return (response.parseAs<PaginatedResponseDto<ChapterDataDto>>().payload!.results ?? []).filter((dto) => !(isPremium(dto) && !showLocked)).map(createChapter);
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/read/${chapter.url}`;
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(`${API_CHAPTER_URL}/${chapter.url}`, this.headers);
  }
  protected pageListParse(response: Response): Page[] {
    const segments = new URL(response.url).pathname.split("/");
    const chapterKey = segments[segments.length - 1];
    const chapterWebUrl = `${WEB_CHAPTER_URL}/${chapterKey}`;
    const useDataSaver = this.useDataSaver;
    return response
      .parseAs<ResponseDto<ChapterDataDto>>()
      .payload!.results.page_objects!.map((dto) => (useDataSaver ? dto.mobile_image_url : dto.desktop_image_url))
      .map((url, index) => new Page(index, `${chapterWebUrl}/${index}`, url));
  }

  protected imageUrlParse(_response: Response): string {
    return "";
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const dataSaverPref = new SwitchPreferenceCompat(screen.context);
    dataSaverPref.key = getDataSaverPreferenceKey(this.extLang);
    dataSaverPref.title = this.intl.get("data_saver");
    dataSaverPref.summary = this.intl.get("data_saver_summary");
    dataSaverPref.setDefaultValue(false);

    const showLockedChaptersPref = new SwitchPreferenceCompat(screen.context);
    showLockedChaptersPref.key = getShowLockedChaptersPreferenceKey(this.extLang);
    showLockedChaptersPref.title = this.intl.get("show_locked_chapters");
    showLockedChaptersPref.summary = this.intl.get("show_locked_chapters_summary");
    showLockedChaptersPref.setDefaultValue(true);

    screen.addPreference(dataSaverPref);
    screen.addPreference(showLockedChaptersPref);
  }

  private get useDataSaver() {
    return this.preferences.getBoolean(getDataSaverPreferenceKey(this.extLang), false);
  }
  private get showLockedChapters() {
    return this.preferences.getBoolean(getShowLockedChaptersPreferenceKey(this.extLang), true);
  }
}
