// Port of keiyoushi/extensions-source src/id/shinigami/Shinigami.kt
import { ClientBuilder, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, isNotBlank, toHttpUrl, tryParseInstant, type Response } from "../../../sdk/index.ts";
import { FormatFilter, GenreFilter, SortFilter, SortOrderFilter, StatusFilter, TypeFilter, isUriFilter } from "./filters.ts";

// Dto.kt
interface ShinigamiBrowseDto {
  data: ShinigamiBrowseDataDto[];
  meta: MetaDto;
}
interface ShinigamiBrowseDataDto {
  cover_image_url?: string | null;
  manga_id?: string | null;
  title?: string | null;
}
interface MetaDto {
  page: number;
  total_page?: number | null;
}
interface ShinigamiMangaDetailDto {
  data: ShinigamiMangaDetailDataDto;
}
interface ShinigamiMangaDetailDataDto {
  title?: string | null;
  cover_portrait_url?: string | null;
  cover_image_url?: string | null;
  alternative_title?: string | null;
  description?: string;
  status?: number;
  taxonomy?: Record<string, TaxonomyItemDto[]>;
}
interface TaxonomyItemDto {
  name: string;
}
interface ShinigamiChapterListDto {
  data: ShinigamiChapterListDataDto[];
}
interface ShinigamiChapterListDataDto {
  release_date?: string;
  chapter_title?: string;
  chapter_number?: number;
  chapter_id?: string;
}
interface ShinigamiPageListDto {
  data: ShinigamiPagesDataDto;
}
interface ShinigamiPagesDataDto {
  base_url: string;
  chapter: ShinigamiPagesData2Dto;
}
interface ShinigamiPagesData2Dto {
  path: string;
  data?: string[];
}

export default class Shinigami extends KeiSource {
  private readonly apiUrl = "https://api.shngm.io";

  private get apiHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("Accept", "application/json");
    h.append("DNT", "1");
    h.append("Sec-GPC", "1");
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  // ====================== Popular ======================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/v1/manga/list`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("page_size", "30").addQueryParameter("sort", "popularity").build();

    const response = await this.client.get(String(url), this.apiHeaders);
    return this.parseMangaList(response);
  }

  // ====================== Latest ======================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/v1/manga/list`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("page_size", "30").addQueryParameter("sort", "latest").build();

    const response = await this.client.get(String(url), this.apiHeaders);
    return this.parseMangaList(response);
  }

  // ====================== Search ======================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/v1/manga/list`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("page_size", "30");

    if (query.length > 0) url.addQueryParameter("q", query);

    filters.filter(isUriFilter).forEach((it) => it.addToUri(url));

    const response = await this.client.get(String(url.build()), this.apiHeaders);
    return this.parseMangaList(response);
  }

  private parseMangaList(response: Response): MangasPage {
    const rootObject = response.parseAs<ShinigamiBrowseDto>();
    const projectList = rootObject.data.map((it) => this.popularMangaFromObject(it));
    const totalPage = rootObject.meta.total_page;
    const hasNextPage = totalPage != null ? rootObject.meta.page < totalPage : false;
    return new MangasPage(projectList, hasNextPage);
  }

  private popularMangaFromObject(obj: ShinigamiBrowseDataDto): SManga {
    const m = SManga.create();
    m.title = obj.title ?? "";
    m.thumbnail_url = obj.cover_image_url ?? (obj.cover_image_url === undefined ? "" : undefined);
    m.url = obj.manga_id ?? "";
    return m;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new SortOrderFilter(), new StatusFilter(), new FormatFilter(), new TypeFilter(), new GenreFilter());
  }

  // ====================== Manga Details & Chapters ======================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== "shinigami.asia" && !url.hostname.endsWith(".shinigami.asia")) return null;
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (segments[0] !== "series") return null;
    const id = segments[1];
    if (!isNotBlank(id)) return null;

    const manga = SManga.create();
    manga.url = id;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (manga.url.startsWith("/series/")) throw new Error(`Migrate dari ${this.name} ke ${this.name} (ekstensi yang sama)`);

    const [updatedManga, updatedChapters] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const response = await this.client.get(`${this.apiUrl}/v1/manga/detail/${manga.url}`, this.apiHeaders);
    const mangaDetails = response.parseAs<ShinigamiMangaDetailDto>().data;
    const taxonomy = mangaDetails.taxonomy ?? {};
    const names = (key: string) => (taxonomy[key] ?? []).map((it) => it.name).join(", ");

    if (isNotBlank(mangaDetails.title)) manga.title = mangaDetails.title;
    const cover = mangaDetails.cover_portrait_url ?? mangaDetails.cover_image_url;
    if (isNotBlank(cover)) manga.thumbnail_url = cover;
    manga.author = names("Author");
    manga.artist = names("Artist");
    manga.status = this.toStatus(mangaDetails.status ?? 0);
    let description = mangaDetails.description ?? "";
    if (isNotBlank(mangaDetails.alternative_title)) {
      if (description.length > 0) description += "\n\n";
      description += `Alternative Title: ${mangaDetails.alternative_title}`;
    }
    manga.description = description;

    const genres = names("Genre");
    const type = names("Format");
    manga.genre = [genres, type].filter((it) => isNotBlank(it)).join(", ");
    return manga;
  }

  private toStatus(s: number): number {
    switch (s) {
      case 1:
        return SManga.ONGOING;
      case 2:
        return SManga.COMPLETED;
      case 3:
        return SManga.ON_HIATUS;
      default:
        return SManga.UNKNOWN;
    }
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const response = await this.client.get(`${this.apiUrl}/v1/chapter/${manga.url}/list?page_size=3000`, this.apiHeaders);
    const result = response.parseAs<ShinigamiChapterListDto>();
    return result.data.map((it) => this.chapterFromObject(it));
  }

  private chapterFromObject(obj: ShinigamiChapterListDataDto): SChapter {
    const c = SChapter.create();
    const num = obj.chapter_number ?? 0;
    c.date_upload = tryParseInstant(obj.release_date ?? "");
    // Double.toString().removeSuffix(".0")
    c.name = `Chapter ${String(num)} ${obj.chapter_title ?? ""}`.trim();
    c.chapter_number = num;
    c.url = obj.chapter_id ?? "";
    return c;
  }

  // ====================== Page List ======================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.url.startsWith("/series/")) throw new Error(`Migrate dari ${this.name} ke ${this.name} (ekstensi yang sama)`);

    const response = await this.client.get(`${this.apiUrl}/v1/chapter/detail/${chapter.url}`, this.apiHeaders);
    const result = response.parseAs<ShinigamiPageListDto>();

    return (result.data.chapter.data ?? []).map((imageName, index) => new Page(index, "", `${result.data.base_url}${result.data.chapter.path}${imageName}`));
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const imageHeaders = this.headersBuilder();
    imageHeaders.append("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    imageHeaders.append("DNT", "1");
    imageHeaders.append("sec-fetch-dest", "empty");
    imageHeaders.append("Sec-GPC", "1");
    return { url: page.imageUrl!, headers: imageHeaders };
  }
}
