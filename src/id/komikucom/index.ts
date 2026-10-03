// Port of keiyoushi/extensions-source src/id/komikucom/KomikuCom.kt
import { FilterList, KeiSource, MangasPage, SMangaUpdate, toHttpUrl, type Page, type Response, type SChapter, type SManga } from "../../../sdk/index.ts";
import { chapterToSChapter, comicToSManga, sortToPair, toPageList, type ChapterDetailDto, type ChapterDto, type ComicDto, type ComicListResponse, type FilterResponse } from "./dto.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter, isUriQueryFilter } from "./filters.ts";

export default class KomikuCom extends KeiSource {
  private readonly apiUrl = "https://01.komiku.asia/api/v2";

  protected override configureHeaders(headers: Headers) {
    headers.append("Accept", "application/json, text/plain, */*");
    headers.append("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8");
    headers.append("Sec-Fetch-Dest", "empty");
    headers.append("Sec-Fetch-Mode", "cors");
    headers.append("Sec-Fetch-Site", "same-origin");
    return headers;
  }

  // ------------------------- Browse (Popular) -------------------------

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/comics`).newBuilder().addQueryParameter("sort", "popular").addQueryParameter("page", String(page)).build();
    return this.parseComicListResponse(await this.client.get(url.toString()));
  }

  // ------------------------- Latest -------------------------

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/comics`).newBuilder().addQueryParameter("sort", "update").addQueryParameter("page", String(page)).build();
    return this.parseComicListResponse(await this.client.get(url.toString()));
  }

  private parseComicListResponse(response: Response): MangasPage {
    const result = response.parseAs<ComicListResponse>();
    const mangas = result.items?.map(comicToSManga) ?? [];
    const hasNextPage = (result.page ?? 0) < (result.totalPages ?? 0);
    return new MangasPage(mangas, hasNextPage);
  }

  // ------------------------- Search -------------------------

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    // /comics/search requires `q`; when browsing without a query, use /comics with filters instead
    const endpoint = !query ? `${this.apiUrl}/comics` : `${this.apiUrl}/comics/search`;
    const builder = toHttpUrl(endpoint).newBuilder();
    if (query) builder.addQueryParameter("q", query);
    filters.filter(isUriQueryFilter).forEach((it) => it.addToQuery(builder));
    builder.addQueryParameter("page", String(page));
    const response = await this.client.get(builder.build().toString());
    if (!query) return this.parseComicListResponse(response);
    const mangas = response.parseAs<ComicDto[]>().map(comicToSManga);
    return new MangasPage(mangas, mangas.length > 0);
  }

  // ------------------------- Filters -------------------------

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/comics/filters`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const dto = data as FilterResponse | null;
    if (dto == null) return FilterList();
    const opt = (it: string): [string, string] => (it === "Semua" ? ["Semua", ""] : [it, it]);
    return FilterList(
      new SortFilter(dto.sorts?.map(sortToPair) ?? []),
      new StatusFilter(dto.statuses?.filter((it) => it !== "ngoing").map(opt) ?? []),
      new TypeFilter(dto.types?.map(opt) ?? []),
      new GenreFilter(dto.genres?.map((it): [string, string] => [it, it]) ?? []),
    );
  }

  // ------------------------- Detail + Chapters -------------------------

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const id = manga.memo["id"];
    if (id == null) throw new Error("NullPointerException"); // manga.memo["id"]!!
    const comicId = String(id);
    const slug = manga.url.includes("/manga/") ? manga.url.slice(manga.url.indexOf("/manga/") + "/manga/".length) : manga.url;
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(`${this.apiUrl}/comics/${slug}`) : null,
      fetchChapters ? this.client.get(`${this.apiUrl}/comics/${comicId}/chapters`) : null,
    ]);

    const comicDto = details?.parseAs<ComicDto>();
    const chapterDtos = chapterList?.parseAs<ChapterDto[]>();
    return new SMangaUpdate(comicDto ? comicToSManga(comicDto) : manga, chapterDtos?.map((it) => chapterToSChapter(it, Number.parseInt(comicId, 10))) ?? chapters);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const slug = url.pathname.slice(1).split("/")[1];
    if (slug == null) return null;
    try {
      return comicToSManga((await this.client.get(`${this.apiUrl}/comics/${slug}`)).parseAs<ComicDto>());
    } catch {
      return null;
    }
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const segments = chapter.url.split("/").filter((it) => it);
    const comicId = segments[0] ?? null;
    const chapterId = segments[1] ?? null;
    return toPageList((await this.client.get(`${this.apiUrl}/comics/${comicId}/chapters/id/${chapterId}`)).parseAs<ChapterDetailDto>());
  }
}
