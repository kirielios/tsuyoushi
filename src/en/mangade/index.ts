// Port of keiyoushi/extensions-source src/en/mangade/MangaDE.kt
import { DateTimeFormatter, Filter, FilterList, HttpUrl, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, substringAfterLast } from "../../../sdk/index.ts";
import { toMangasPage, toPageList, toSChapterList, toSManga, type ChapterDto, type GenreListPageDto, type MangaDto, type MangaListPageDto, type PayloadDto } from "./dto.ts";
import { ChapterCountFilter, Genre, GenreFilter, SortFilter, StatusFilter, TypeFilter, YearFilter } from "./filters.ts";

export default class MangaDE extends KeiSource {
  private get apiUrl() {
    return `https://api.${HttpUrl.parse(this.baseUrl).host}/api`;
  }
  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT);

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", [new SortFilter(SortFilter.POPULAR)]);
  }
  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", [new SortFilter(SortFilter.LATEST)]);
  }
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = HttpUrl.parse(`${this.apiUrl}/comics`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("size", "20");

    if (query.length > 0) url.addQueryParameter("name", query);

    const sort = firstInstanceOrNull(filters, SortFilter);
    if (sort) url.addQueryParameter("sort", sort.toUriPart());
    const status = firstInstanceOrNull(filters, StatusFilter);
    if (status && status.state !== 0) url.addQueryParameter("comic_status", status.toUriPart());
    const type = firstInstanceOrNull(filters, TypeFilter);
    if (type && type.state !== 0) url.addQueryParameter("category", type.toUriPart());
    const year = firstInstanceOrNull(filters, YearFilter);
    if (year && year.state !== 0) url.addQueryParameter("year", year.toUriPart());
    const chapterCount = firstInstanceOrNull(filters, ChapterCountFilter);
    if (chapterCount) url.addQueryParameter("min_chapter_count", chapterCount.toUriPart());
    firstInstanceOrNull(filters, GenreFilter)
      ?.state.filter((it) => it.state)
      .forEach((it) => url.addQueryParameter("genres[]", it.id));

    const response = await this.client.get(url.build().toString());
    return toMangasPage(response.parseAs<PayloadDto<MangaListPageDto>>().data);
  }

  override getMangaUrl(manga: SManga): string {
    const url = HttpUrl.parse(super.getMangaUrl(manga));
    const slug = url.pathSegments[0];
    const mid = url.queryParameter("mid");

    return `${this.baseUrl}/comic/${slug}-pid${mid}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const url = HttpUrl.parse(super.getChapterUrl(chapter));
    const mid = url.queryParameter("mid");
    const mangaSlug = url.pathSegments[0];
    const chapterSlug = url.pathSegments[1];

    return `${this.baseUrl}/comic/${mangaSlug}-${mid}/${chapterSlug}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const u = HttpUrl.parse(url.href);
    if (u.host !== HttpUrl.parse(this.baseUrl).host) return null;

    if (u.pathSegments[0] !== "comic") return null;
    const seg = u.pathSegments[1];
    const mangaId = seg == null ? "" : substringAfterLast(seg, "-", "").replace(/^pid/, "");
    if (mangaId.length === 0) return null;

    const data = (await this.client.get(`${this.apiUrl}/comics/${mangaId}/view`)).parseAs<PayloadDto<MangaDto>>().data;
    const manga = toSManga(data);
    manga.initialized = true;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const id = HttpUrl.parse(super.getMangaUrl(manga)).queryParameter("mid")!;
    const data = (await this.client.get(`${this.apiUrl}/comics/${id}/view`)).parseAs<PayloadDto<MangaDto>>().data;
    return new SMangaUpdate(toSManga(data), toSChapterList(data, this.dateFormat));
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const id = HttpUrl.parse(super.getChapterUrl(chapter)).queryParameter("cid")!;
    return toPageList((await this.client.get(`${this.apiUrl}/chapters/${id}/view`)).parseAs<PayloadDto<ChapterDto>>().data);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/genres?size=500`)).parseAs();
  }

  override getFilterList(data: unknown = null): FilterList {
    const list: FilterList = [new SortFilter(), new StatusFilter(), new TypeFilter(), new YearFilter(), new ChapterCountFilter()];

    const genres = (data as PayloadDto<GenreListPageDto> | null)?.data?.genres ?? [];
    if (genres.length === 0) return list;

    list.push(new Filter.Separator());
    list.push(new GenreFilter(genres.map((it) => new Genre(it.name, it.id))));
    return list;
  }
}
