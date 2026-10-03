// Port of keiyoushi/extensions-source src/id/voratoon/VoraToon.kt
import { FilterList, GET, KeiSource, MangasPage, SManga, SMangaUpdate, toHttpUrl, type ClientBuilder, type Page, type Request, type Response, type SChapter } from "../../../sdk/index.ts";
import {
  chapterToPageList,
  chapterToSChapter,
  genreToPair,
  getSlug,
  getSlugAndIndex,
  seriesToSManga,
  type ChapterDetailResponse,
  type ChapterListResponse,
  type GenreResponse,
  type SeriesDetailResponse,
  type SeriesListResponse,
} from "./dto.ts";
import { FormatFilter, GenreFilter, SortFilter, SortOrderFilter, StatusFilter, TypeFilter, isUriFilter, isUriQueryFilter } from "./filters.ts";

export default class VoraToon extends KeiSource {
  private readonly apiUrl = "https://api.voratoon.com";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(3, 1000, (it) => it.host === "api.voratoon.com");
  }

  protected override configureHeaders(headers: Headers) {
    headers.append("Accept", "application/json");
    headers.append("Accept-language", "en-US,en;q=0.9,id;q=0.8");
    return headers;
  }

  private seriesUrl(page: number) {
    return toHttpUrl(`${this.apiUrl}/series`).newBuilder().addQueryParameter("includeMeta", "true").addQueryParameter("take", "30").addQueryParameter("page", String(page));
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.seriesUrl(page).addQueryParameter("sort", "popularity").addQueryParameter("sortOrder", "desc").build();
    return this.parseSeriesListResponse(await this.client.get(url.toString()));
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.seriesUrl(page).addQueryParameter("sort", "latest").addQueryParameter("sortOrder", "desc").build();
    return this.parseSeriesListResponse(await this.client.get(url.toString()));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = this.seriesUrl(page);
    if (query) builder.addQueryParameter("title", query);
    const filterBuilder: string[] = [];
    filters.filter(isUriFilter).forEach((it) => it.addToFilter(filterBuilder));
    if (filterBuilder.length) builder.addQueryParameter("filter", filterBuilder.join(""));
    filters.filter(isUriQueryFilter).forEach((it) => it.addToQuery(builder));
    return this.parseSeriesListResponse(await this.client.get(builder.build().toString()));
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = getSlug(manga, this.baseUrl);
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(`${this.apiUrl}/series/${slug}`) : null,
      fetchChapters ? this.client.get(`${this.apiUrl}/series/${slug}/chapters`) : null,
    ]);

    const detailsData = details?.parseAs<SeriesDetailResponse>()?.data;
    return new SMangaUpdate(detailsData ? seriesToSManga(detailsData) : manga, chapterList?.parseAs<ChapterListResponse>()?.data?.map((it) => chapterToSChapter(it, slug)) ?? chapters);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments[0] !== "series") return null;
    const slug = pathSegments[1];
    if (slug == null) return null;
    const manga = SManga.create();
    manga.url = `/series/${slug}`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const [slug, chapterIndex] = getSlugAndIndex(chapter, this.baseUrl);
    return chapterToPageList((await this.client.get(`${this.apiUrl}/series/${slug}/chapters/${chapterIndex}`)).parseAs<ChapterDetailResponse>().data);
  }

  private parseSeriesListResponse(response: Response): MangasPage {
    const result = response.parseAs<SeriesListResponse>();
    const mangas = result.data.map(seriesToSManga);
    const hasNextPage = result.meta ? (result.meta.page ?? 0) < (result.meta.lastPage ?? 0) : false;
    return new MangasPage(mangas, hasNextPage);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/genres`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as GenreResponse | null)?.data?.map(genreToPair);
    const list: FilterList = [new SortFilter(), new SortOrderFilter(), new StatusFilter(), new FormatFilter(), new TypeFilter()];
    if (genres?.length) list.push(new GenreFilter(genres));
    return list;
  }

  override imageRequest(page: Page): Request {
    const newHeaders = this.headersBuilder();
    newHeaders.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    newHeaders.set("Referer", `${this.baseUrl}/`);
    return GET(page.imageUrl!, newHeaders);
  }
}
