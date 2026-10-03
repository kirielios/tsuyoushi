// Port of keiyoushi/extensions-source src/en/duskscans/DuskScans.kt
import {
  CheckBoxPreference, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, extractNextJs, firstInstanceOrNull, hasKeys, toHttpUrl,
  type ClientBuilder, type PreferenceScreen,
} from "../../../sdk/index.ts";
import { chapterToSChapter, isLocked, mangaToSManga, matchesQuery, pageUrls, type ChapterDetailDto, type FilterDataDto, type MangaDto, type SeriesPageDto } from "./dto.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

const PREF_SHOW_PREMIUM = "pref_show_premium";
const PREF_SHOW_PREMIUM_DEFAULT = false;

const sortedBy = <T>(list: T[], key: (it: T) => number | string, descending: boolean): T[] =>
  [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (descending ? -1 : 1);
  });

export default class DuskScans extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  private get baseUrlHost() {
    return toHttpUrl(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3, 1000, (url) => url.host === this.baseUrlHost);
  }

  private async getCatalog(): Promise<MangaDto[]> {
    return (await this.client.get(`${this.apiUrl}/manga`)).parseAs<MangaDto[]>();
  }

  // ============================== Popular ===============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    const mangas = sortedBy(await this.getCatalog(), (it) => it.views ?? 0, true);
    return new MangasPage(mangas.map(mangaToSManga), false);
  }

  // ============================== Latest ================================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const mangas = await this.getCatalog(); // already ordered by newest chapter release date
    return new MangasPage(mangas.map(mangaToSManga), false);
  }

  // ============================== Search ================================

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const mangas = await this.getCatalog();

    const status = firstInstanceOrNull(filters, StatusFilter)?.checked ?? [];
    const type = firstInstanceOrNull(filters, TypeFilter)?.checked ?? [];
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);
    const included = genreFilter?.included ?? [];
    const excluded = genreFilter?.excluded ?? [];

    const filtered = mangas.filter(
      (it) =>
        (query.trim() === "" || matchesQuery(it, query)) &&
        (status.length === 0 || (it.status != null && status.includes(it.status))) &&
        (type.length === 0 || (it.type != null && type.includes(it.type))) &&
        included.every((g) => (it.genres ?? []).includes(g)) &&
        !(it.genres ?? []).some((g) => excluded.includes(g)),
    );

    let sorted: MangaDto[];
    switch (firstInstanceOrNull(filters, SortFilter)?.state ?? 0) {
      case 1:
        sorted = sortedBy(filtered, (it) => it.createdAt ?? "", true);
        break;
      case 2:
        sorted = sortedBy(filtered, (it) => it.views ?? 0, true);
        break;
      case 3:
        sorted = sortedBy(filtered, (it) => it.rating ?? 0, true);
        break;
      case 4:
        sorted = sortedBy(filtered, (it) => it.title, false);
        break;
      default:
        sorted = filtered;
    }

    return new MangasPage(sorted.map(mangaToSManga), false);
  }

  // ============================== Details ================================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.split("/").filter((s) => s !== "");
    if (url.host !== this.baseUrlHost || segments[0] !== "series") return null;
    const slug = segments[1];
    if (!slug || slug.trim() === "") return null;
    const series = await this.getSeriesPage(slug);
    return series ? mangaToSManga(series.initialManga) : null;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const series = await this.getSeriesPage(manga.url);
    if (!series) throw new Error("Series not found");

    const showPremium = this.preferences.getBoolean(PREF_SHOW_PREMIUM, PREF_SHOW_PREMIUM_DEFAULT);
    return new SMangaUpdate(
      mangaToSManga(series.initialManga),
      series.initialChapters.filter((it) => showPremium || !isLocked(it)).map((it) => chapterToSChapter(it, manga.url)),
    );
  }

  // get both manga details and chapters (already ordered newest first)
  private async getSeriesPage(slug: string): Promise<SeriesPageDto | null> {
    const rscHeaders = this.headersBuilder();
    rscHeaders.append("RSC", "1");
    return extractNextJs<SeriesPageDto>(await this.client.get(`${this.baseUrl}/series/${slug}`, rscHeaders), hasKeys("initialManga", "initialChapters"));
  }

  // ============================== Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    const slug = chapter.memo.slug as string;
    const number = chapter.memo.number as string;
    return `${this.baseUrl}/series/${slug}/chapter-${number}`;
  }

  // ============================== Pages ==================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(`${this.apiUrl}/chapter/${chapter.url}`);
    return pageUrls(response.parseAs<ChapterDetailDto>()).map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // ============================== Filters ================================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<FilterDataDto> {
    const catalog = await this.getCatalog();
    const distinctSorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      genres: distinctSorted(catalog.flatMap((it) => it.genres ?? [])),
      statuses: distinctSorted(catalog.flatMap((it) => (it.status != null ? [it.status] : []))),
      types: distinctSorted(catalog.flatMap((it) => (it.type != null ? [it.type] : []))),
    };
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as FilterDataDto | null;
    const list: FilterList = [new SortFilter()];
    if (filterData?.statuses?.length) list.push(new StatusFilter(filterData.statuses));
    if (filterData?.types?.length) list.push(new TypeFilter(filterData.types));
    if (filterData?.genres?.length) list.push(new GenreFilter(filterData.genres));
    return list;
  }

  // ============================ Preferences ============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new CheckBoxPreference(screen.context);
    p.key = PREF_SHOW_PREMIUM;
    p.title = "Show premium chapters";
    p.summary = "Include chapters that require payment or login to read";
    p.setDefaultValue(PREF_SHOW_PREMIUM_DEFAULT);
    screen.addPreference(p);
  }
}
