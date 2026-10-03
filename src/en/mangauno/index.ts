// Port of keiyoushi/extensions-source src/en/mangauno/Mangauno.kt
import { Filter, FilterList, KeiSource, ListPreference, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfterLast, toHttpUrl, type PreferenceScreen } from "../../../sdk/index.ts";
import { chapterToSChapter, detailsToSManga, toSMangaList, type DetailsResponse, type FacetsDto, type ListResponse, type PageListResponse } from "./dto.ts";
import { AdultFilter, CheckBoxFilter, GenreGroup, SortFilter, StatusFilter, TagGroup, TypeFilter, YearGroup } from "./filters.ts";

const TITLE_PREF = "PREF_TITLE_LANG";
const PAGE_SIZE = 24;

export default class Mangauno extends KeiSource {
  private get apiUrl(): string {
    return `${this.baseUrl}/api`;
  }

  private get useEnglishTitle(): boolean {
    return this.preferences.getString(TITLE_PREF, "english") === "english";
  }

  override get supportsFilterFetching() {
    return true;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.apiUrl}/list/popular?page=${page}&limit=${PAGE_SIZE}`);
    const mangas = toSMangaList(response.parseAs<ListResponse>(), this.useEnglishTitle);
    return new MangasPage(mangas, mangas.length >= PAGE_SIZE);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.apiUrl}/list/latest?page=${page}&limit=${PAGE_SIZE}`);
    const mangas = toSMangaList(response.parseAs<ListResponse>(), this.useEnglishTitle);
    return new MangasPage(mangas, mangas.length >= PAGE_SIZE);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/search/advanced`).newBuilder();
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", String(PAGE_SIZE));

    if (query.length > 0) url.addQueryParameter("title", query);

    for (const filter of filters) {
      if (filter instanceof TypeFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("types", filter.toUriPart());
      } else if (filter instanceof StatusFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("statuses", filter.toUriPart());
      } else if (filter instanceof SortFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("sort", filter.toUriPart());
      } else if (filter instanceof YearGroup) {
        const min = filter.state[0].state;
        const max = filter.state[1].state;
        if (min.length > 0) url.addQueryParameter("yearMin", min);
        if (max.length > 0) url.addQueryParameter("yearMax", max);
      } else if (filter instanceof AdultFilter) {
        if (filter.state) url.addQueryParameter("adult", "1");
      } else if (filter instanceof GenreGroup) {
        const selected = filter.state.filter((it) => it.state).map((it) => it.name);
        if (selected.length > 0) url.addQueryParameter("genres", selected.join(","));
      } else if (filter instanceof TagGroup) {
        const selected = filter.state.filter((it) => it.state).map((it) => it.name);
        if (selected.length > 0) url.addQueryParameter("tags", selected.join(","));
      }
    }

    const response = await this.client.get(url.build().toString());
    const mangas = toSMangaList(response.parseAs<ListResponse>(), this.useEnglishTitle);
    return new MangasPage(mangas, mangas.length >= PAGE_SIZE);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(`${this.apiUrl}/manga/${manga.url}`);
    const data = response.parseAs<DetailsResponse>();
    return new SMangaUpdate(
      detailsToSManga(data.manga, this.useEnglishTitle),
      data.chapters.map((it) => chapterToSChapter(it, data.manga.slug, this.host)),
    );
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = substringAfterLast(chapter.url, "/");
    const response = await this.client.get(`${this.apiUrl}/chapter/${chapterId}`);
    return response.parseAs<PageListResponse>().pages.map((url, index) => new Page(index, "", url));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/m/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/r/${chapter.url}`;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/search/facets`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new AdultFilter(), new TypeFilter(), new StatusFilter(), new SortFilter(), new YearGroup()];

    if (data != null) {
      const facets = data as FacetsDto;
      const genreList = (facets.genres ?? []).map((it) => new CheckBoxFilter(it.name));
      const tagList = (facets.tags ?? []).map((it) => new CheckBoxFilter(it.name));

      if (genreList.length > 0) filters.push(new GenreGroup(genreList));
      if (tagList.length > 0) filters.push(new TagGroup(tagList));
    }

    return FilterList(...filters);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const titlePref = new ListPreference(screen.context);
    titlePref.key = TITLE_PREF;
    titlePref.title = "Title Language";
    titlePref.entries = ["English Title", "Japanese Title"];
    titlePref.entryValues = ["english", "japanese"];
    titlePref.setDefaultValue("english");
    titlePref.summary = "%s";
    screen.addPreference(titlePref);
  }
}
