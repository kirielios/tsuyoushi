// Port of keiyoushi/extensions-source src/all/mangaball/MangaBall.kt
import { KeiSource, MangasPage, Page, SMangaUpdate, SwitchPreferenceCompat, firstInstanceOrNull, toHttpUrl, type FilterList, type PreferenceScreen, type SChapter, type SManga } from "../../../sdk/index.ts";
import {
  chapterDtoToSChapter,
  mangaDtoToSManga,
  searchToMangasPage,
  titleDtoToSManga,
  type ChapterDetailResponse,
  type ChapterListResponse,
  type SearchResponse,
  type TitleResponse,
} from "./dto.ts";
import { ContentFilter, DemographicFilter, FormatFilter, GenreFilter, SortFilter, StatusFilter, TagModeFilter, ThemeFilter, TriStateGroupFilter, TypeFilter } from "./filters.ts";
import { addScanlatorBlacklistPreference, filterBlacklistedScanlators, rememberScanlators, scanlatorBlacklist } from "./scanlatorBlacklist.ts";

const NSFW_PREF = "nsfw_pref";
const LEGACY_HOST = "mangaball.net";

const SITE_LANGS: Record<string, string[]> = {
  ar: ["ar"],
  bg: ["bg"],
  bn: ["bn"],
  ca: ["ca", "ca-ad", "ca-es", "ca-fr", "ca-it", "ca-pt"],
  cs: ["cs"],
  da: ["da"],
  de: ["de"],
  el: ["el"],
  en: ["en"],
  es: ["es", "es-ar", "es-mx", "es-es", "es-la", "es-419"],
  fa: ["fa"],
  fi: ["fi"],
  fr: ["fr"],
  he: ["he"],
  hi: ["hi"],
  hu: ["hu"],
  id: ["id"],
  it: ["it", "it-it"],
  is: ["ib", "ib-is", "is"],
  ja: ["ja", "jp"],
  ko: ["ko", "kr"],
  kn: ["kn", "kn-in", "kn-my", "kn-sg", "kn-tw"],
  ml: ["ml", "ml-in", "ml-my", "ml-sg", "ml-tw"],
  ms: ["ms"],
  ne: ["ne"],
  nl: ["nl", "nl-be"],
  no: ["no"],
  pl: ["pl"],
  "pt-BR": ["pt-br", "pt-pt"],
  ro: ["ro"],
  ru: ["ru"],
  sk: ["sk"],
  sl: ["sl"],
  sq: ["sq"],
  sr: ["sr", "sr-cyrl"],
  sv: ["sv"],
  ta: ["ta"],
  th: ["th", "th-hk", "th-kh", "th-la", "th-my", "th-sg"],
  tr: ["tr"],
  uk: ["uk"],
  vi: ["vi"],
  zh: ["zh", "zh-cn", "zh-hk", "zh-mo", "zh-sg", "zh-tw", "cn"],
};

export default class MangaBall extends KeiSource {
  private get siteLang(): string[] {
    return SITE_LANGS[this.lang] ?? [this.lang];
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.searchAdvanced(page, "", [], "views", "desc");
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.searchAdvanced(page, "", [], "lastupdate", "desc");
  }

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.searchAdvanced(page, query, filters);
  }

  private async searchAdvanced(page: number, query: string, filters: FilterList, sortBy?: string, sortOrder?: string): Promise<MangasPage> {
    const sort = firstInstanceOrNull(filters, SortFilter);

    const url = toHttpUrl(`${this.baseUrl}/api/v1/title/search-advanced`).newBuilder();
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", "24");
    url.addQueryParameter("sort_by", sortBy ?? sort?.sortBy ?? "lastupdate");
    url.addQueryParameter("sort_order", sortOrder ?? sort?.sortOrder ?? "desc");
    url.addQueryParameter("tag_mode", firstInstanceOrNull(filters, TagModeFilter)?.selected ?? "AND");
    url.addQueryParameter("adult_mode", this.hideNsfwPreference() ? "no_18" : "all");

    if (query.trim()) url.addQueryParameter("keyword", query.trim());

    const type = firstInstanceOrNull(filters, TypeFilter)?.selected;
    if (type) url.addQueryParameter("type", type);
    const demographic = firstInstanceOrNull(filters, DemographicFilter)?.selected;
    if (demographic) url.addQueryParameter("publicationDemographic", demographic);
    const status = firstInstanceOrNull(filters, StatusFilter)?.selected;
    if (status) url.addQueryParameter("status", status);

    const groups = filters.filter((it): it is TriStateGroupFilter<string> => it instanceof TriStateGroupFilter);
    const included = groups.flatMap((it) => it.included);
    if (included.length) url.addQueryParameter("included_tags", included.join(","));

    const excluded = groups.flatMap((it) => it.excluded);
    if (excluded.length) url.addQueryParameter("excluded_tags", excluded.join(","));

    return searchToMangasPage((await this.client.get(url.build().toString(), this.headers)).parseAs<SearchResponse>());
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [new SortFilter(), new TypeFilter(), new DemographicFilter(), new StatusFilter(), new TagModeFilter(), new ContentFilter(), new FormatFilter(), new GenreFilter(), new ThemeFilter()];
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host && url.host !== LEGACY_HOST) return null;

    const segments = url.pathname.split("/").filter((it) => it.length);
    let id: string | null | undefined;
    switch (segments[0]) {
      case "title-detail":
        id = segments[1];
        break;
      case "chapter-detail": {
        const chapterId = segments[1];
        id = chapterId != null ? (await this.client.get(`${this.baseUrl}/api/v1/chapter-detail?chapter_id=${chapterId}`)).parseAs<ChapterDetailResponse>().data.chapter.title_id : undefined;
        break;
      }
      default:
        id = null;
    }
    if (id == null) return null;

    return this.getMangaDetails(id);
  }

  override getMangaUrl(manga: SManga): string {
    // The slug form only server-renders a stub page, so link to the id form the site itself uses.
    const id = (manga.memo?.id as string | undefined) ?? manga.url;
    return `${this.baseUrl}/title-detail/${id}`;
  }

  private async getMangaDetails(idOrSlug: string): Promise<SManga> {
    return titleDtoToSManga((await this.client.get(`${this.baseUrl}/api/v1/title/detail/${idOrSlug}`)).parseAs<TitleResponse>().data);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const titleId = (manga.memo?.id as string | undefined) ?? null;

    if (fetchChapters && titleId != null) {
      const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga.url) : Promise.resolve(manga), this.getChapterList(titleId)]);
      return new SMangaUpdate(m, c);
    }

    // Entries saved by older versions have no id in memo, so one details fetch is needed to
    // resolve it. Returning that manga persists the id, saving the fetch on later refreshes.
    const updatedManga = titleId == null || fetchDetails ? await this.getMangaDetails(manga.url) : manga;

    const updatedChapters = fetchChapters ? await this.getChapterList(updatedManga.memo.id as string) : chapters;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  /** OkHttp 5 appends "; charset=utf-8" to String bodies and this API rejects anything but a bare "application/json". */
  private jsonPost(url: string, body: unknown) {
    const headers = this.headers;
    headers.set("Content-Type", "application/json");
    return this.client.post(url, headers, new TextEncoder().encode(JSON.stringify(body)));
  }

  private async getChapterList(titleId: string): Promise<SChapter[]> {
    const response = (await this.jsonPost(`${this.baseUrl}/api/v1/chapter/chapter-listing-by-title-id`, { title_id: titleId })).parseAs<ChapterListResponse>();
    const chapters = response.data.flatMap((it) => {
      const c = chapterDtoToSChapter(it, this.siteLang);
      return c ? [c] : [];
    });

    rememberScanlators(
      this.preferences,
      chapters.flatMap((it) => (it.scanlator != null ? [it.scanlator] : [])),
    );

    return filterBlacklistedScanlators(chapters, scanlatorBlacklist(this.preferences));
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/chapter-detail/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pages = (await this.client.get(`${this.baseUrl}/api/v1/chapter-detail?chapter_id=${chapter.url}`)).parseAs<ChapterDetailResponse>().data.chapter.pages ?? [];

    this.updateViews(chapter.url);

    return pages.map((url, index) => new Page(index, "", url));
  }

  private updateViews(chapterId: string) {
    // enqueue: fire and forget; failures were only logged upstream
    this.jsonPost(`${this.baseUrl}/api/v1/views/update`, { object_id: chapterId, object_type: "chapter" }).catch(() => undefined);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const nsfw = new SwitchPreferenceCompat(screen.context);
    nsfw.key = NSFW_PREF;
    nsfw.title = "Hide NSFW content";
    nsfw.summary = "Hide titles marked as 18+";
    nsfw.setDefaultValue(false);
    screen.addPreference(nsfw);

    addScanlatorBlacklistPreference(screen, this.preferences);
  }

  private hideNsfwPreference() {
    return this.preferences.getBoolean(NSFW_PREF, false);
  }
}
