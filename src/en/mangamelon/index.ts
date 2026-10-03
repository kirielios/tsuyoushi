// Port of keiyoushi/extensions-source src/en/mangamelon/Mangamelon.kt
import { Base64, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, toHttpUrl, utf8, type Response } from "../../../sdk/index.ts";
import {
  MANGA_ID_MEMO, chapterGetRequest, chapterListRequest, chapterToSChapter, mangaGetRequest, mangaListRequest, mangaToSManga,
  type ChapterDto, type ChapterGetResponse, type ChapterListResponse, type MangaGetResponse, type MangaListResponse,
} from "./dto.ts";
import { GenreFilter, SortFilter } from "./filters.ts";

const API_BASE = "https://api.mangamelon.com";
const PAGE_SIZE = 36;
const CHAPTER_LIMIT = 1000;

export default class Mangamelon extends KeiSource {
  // ================================ Browse ================================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchMangaPage({ sort: "popular", page });
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchMangaPage({ sort: "latest", page });
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sort = firstInstanceOrNull(filters, SortFilter)?.value ?? "latest";
    const genre = firstInstanceOrNull(filters, GenreFilter)?.value ?? "";
    return this.fetchMangaPage({ search: query, genre, sort, page });
  }

  private async fetchMangaPage(o: { search?: string; genre?: string; sort: string; page: number }): Promise<MangasPage> {
    const skip = (o.page - 1) * PAGE_SIZE;
    const response = (await this.api("api/manga/list", mangaListRequest({ search: o.search ?? "", genre: o.genre ?? "", sort: o.sort, limit: PAGE_SIZE, skip }))).parseAs<MangaListResponse>();
    const mangas = response.list.map(mangaToSManga);
    // `total` is -1 for plain browse but a real count for searches; fall back to
    // the "full page means more" heuristic when it is not usable.
    const total = response.total ?? -1;
    const hasNextPage = total > 0 ? skip + mangas.length < total : mangas.length >= PAGE_SIZE;
    return new MangasPage(mangas, hasNextPage);
  }

  // ================================ Details ================================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga.url) : manga, fetchChapters ? this.fetchChapters(manga.url) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(mangaId: string): Promise<SManga> {
    const response = (await this.api("api/manga/get", mangaGetRequest(mangaId))).parseAs<MangaGetResponse>();
    return mangaToSManga(response.manga);
  }

  private async fetchChapters(mangaId: string): Promise<SChapter[]> {
    const chapters: ChapterDto[] = [];
    let skip = 0;
    let size: number;
    do {
      const response = (await this.api("api/chapter/list", chapterListRequest({ target: mangaId, limit: CHAPTER_LIMIT, skip }))).parseAs<ChapterListResponse>();
      const list = response.chapters ?? [];
      chapters.push(...list);
      skip += list.length;
      size = list.length;
    } while (size === CHAPTER_LIMIT);
    return [...chapters].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0)).map((it) => chapterToSChapter(it, mangaId));
  }

  // ================================ Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = (await this.api("api/chapter/get", chapterGetRequest(chapter.url))).parseAs<ChapterGetResponse>();
    return [...(response.chapter.pages ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((page, index) => new Page(index, "", page.url));
  }

  // ================================ URLs ================================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host) return null;
    const segments = url.pathname.split("/").filter((s) => s !== "");
    let mangaId: string;
    if (segments.length >= 2 && segments[0] === "manga") mangaId = segments[1];
    else if (segments.length >= 3 && segments[0] === "chapter") mangaId = segments[1];
    else return null;
    return this.fetchMangaDetails(mangaId);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/chapter/${(chapter.memo[MANGA_ID_MEMO] as string | undefined) ?? null}/${chapter.url}`;
  }

  // ================================ Filters ================================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new GenreFilter());
  }

  // ================================ API ================================

  // Request bodies include default-valued fields (e.g. includeNsfw), or the server falls back to its own defaults and hides NSFW content.
  private api(path: string, body: unknown): Promise<Response> {
    const data = Base64.encode(utf8(JSON.stringify(body)));
    const formBody = new URLSearchParams();
    formBody.append("data", data);
    formBody.append("sessionid", "");
    return this.client.post(`${API_BASE}/${path}`, undefined, formBody);
  }
}
