// Port of keiyoushi/extensions-source src/en/comicland/ComicLand.kt (+ Dto.kt, Filters.kt)
import {
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  isBlank,
  substringAfter,
  substringBefore,
} from "../../../sdk/index.ts";

// ---- Dto.kt
interface ApiResponse<T> {
  data?: T | null;
}
interface PageData {
  list?: ComicDto[] | null;
  items?: ComicDto[] | null;
  has_more?: boolean | null;
}
const comicsOf = (d: PageData): ComicDto[] => d.list ?? d.items ?? [];
const hasNextPageOf = (d: PageData): boolean => d.has_more ?? comicsOf(d).length === 20;

interface NameDto {
  name: string;
}
interface ComicDto {
  slug: string;
  title: string;
  cover_url: string;
}
interface ChapterDto {
  chapter_index: number;
  title: string;
}
interface ComicDetailDto extends ComicDto {
  description?: string | null;
  authors?: NameDto[] | null;
  artists?: NameDto[] | null;
  genres?: NameDto[] | null;
  chapters?: ChapterDto[] | null;
}
interface PagesData {
  pages?: string[];
}

function comicToSManga(c: ComicDto | ComicDetailDto): SManga {
  const manga = SManga.create();
  manga.title = c.title;
  manga.thumbnail_url = c.cover_url;
  manga.url = c.slug;
  if ("description" in c || "authors" in c || "genres" in c || "chapters" in c) {
    const d = c as ComicDetailDto;
    manga.description = d.description ?? undefined;
    manga.author = d.authors?.map((it) => it.name).join(", ");
    manga.artist = d.artists?.map((it) => it.name).join(", ");
    manga.genre = d.genres?.map((it) => it.name).join(", ");
    manga.initialized = true;
  }
  return manga;
}

function chapterToSChapter(c: ChapterDto, slug: string): SChapter {
  const chapter = SChapter.create();
  chapter.name = c.title;
  chapter.chapter_number = c.chapter_index;
  chapter.url = `/comic/${slug}/chapter/${String(c.chapter_index).replace(/\.0$/, "")}`;
  return chapter;
}

// ---- Filters.kt
class Filters extends Filter.Select<string> {
  constructor() {
    super("Category", ["Recommended", "Official", "Ongoing", "Popular"], 3);
  }
  get selectedEndpoint(): string {
    return this.state === 1 ? "/comics/official" : this.state === 3 ? "/comics/popular" : "/comics";
  }
  get selectedStatus(): string | null {
    return this.state === 2 ? "ongoing" : null;
  }
}

export default class ComicLand extends KeiSource {
  private readonly apiUrl = "https://api.comicland.org/api";

  // ============================== Popular ==============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const offset = (page - 1) * 20;
    return this.mangaListParse(HttpUrl.parse(`${this.apiUrl}/comics/popular?offset=${offset}&limit=20`));
  }

  private async mangaListParse(url: HttpUrl): Promise<MangasPage> {
    const res = (await this.client.get(url.toString())).parseAs<ApiResponse<PageData>>();
    const data = res.data;
    if (!data) return new MangasPage([], false);
    return new MangasPage(comicsOf(data).map(comicToSManga), hasNextPageOf(data));
  }

  // ============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const offset = (page - 1) * 20;
    return this.mangaListParse(HttpUrl.parse(`${this.apiUrl}/comics?offset=${offset}&limit=20&status=ongoing`));
  }

  // ============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const offset = (page - 1) * 20;

    if (!isBlank(query)) {
      const url = HttpUrl.parse(`${this.apiUrl}/comic/search`).newBuilder().addQueryParameter("q", query).addQueryParameter("offset", String(offset)).addQueryParameter("limit", "20").build();
      return this.mangaListParse(url);
    }

    const categoryFilter = firstInstanceOrNull(filters, Filters);
    const endpoint = categoryFilter?.selectedEndpoint ?? "/comics";
    const status = categoryFilter?.selectedStatus;

    const url = HttpUrl.parse(`${this.apiUrl}${endpoint}`).newBuilder().addQueryParameter("offset", String(offset)).addQueryParameter("limit", "20");
    if (status != null) url.addQueryParameter("status", status);
    return this.mangaListParse(url.build());
  }

  // ============================== Details ==============================
  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comic/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const res = (await this.client.get(`${this.apiUrl}/comic/detail?slug=${manga.url}`)).parseAs<ApiResponse<ComicDetailDto>>();
    const data = res.data;
    if (!data) throw new Error("Failed to parse manga details");
    return new SMangaUpdate(comicToSManga(data), (data.chapters?.map((it) => chapterToSChapter(it, data.slug)) ?? []).reverse());
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = substringBefore(substringAfter(chapter.url, "/comic/"), "/chapter/");
    const index = substringAfter(chapter.url, "/chapter/");

    const res = (await this.client.get(`${this.apiUrl}/chapter/pages_by_index?slug=${slug}&index=${index}`)).parseAs<ApiResponse<PagesData>>();
    return (res.data?.pages ?? []).map((url, i) => new Page(i, "", url));
  }

  // ============================== Filters ==============================
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Text search ignores Category filter"), new Filters());
  }
}
