// Port of keiyoushi/extensions-source src/all/doujiva/Doujiva.kt (+ Dto.kt)
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, tryParseInstant, type ClientBuilder, type FilterList } from "../../../sdk/index.ts";

// --- Dto.kt
interface MangaListResponse {
  data?: MangaDto[];
  meta?: Meta | null;
  ok?: boolean;
}
type SearchResponse = MangaListResponse;
interface MangaDetailResponse {
  data?: MangaDto | null;
  ok?: boolean;
}
interface Meta {
  totalPages?: number;
}
interface MangaDto {
  slug: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  language?: string | null;
  mediaType?: string | null;
  pageCount?: number;
  status?: string | null;
  tags?: TagDto[];
  chapters?: ChapterDto[];
  sourceName?: string | null;
}
interface TagDto {
  name: string;
  category: string;
}
interface ChapterDto {
  id: string;
  number: number;
  title?: string | null;
  createdAt?: string | null;
}
interface ChapterPagesResponse {
  data?: { imageUrl: string }[];
  ok?: boolean;
}

const PAGE_LIMIT = 24;
const distinct = (a: string[]) => [...new Set(a)];
const blank = (s: string | null | undefined) => !s || !s.trim();

export default class Doujiva extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api/v1`;
  }

  // Stay well under the observed 100 req/min API budget.
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2, 1000, (url) => url.host !== "cdn.doujiva.com");
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.mangaList(page, "popular-today");
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.mangaList(page, "newest");
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return new MangasPage([], false);

    const url = toHttpUrl(`${this.apiUrl}/search`)!
      .newBuilder()
      .addQueryParameter("q", trimmed)
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", String(PAGE_LIMIT))
      .build();

    const response = (await this.client.get(url.toString())).parseAs<SearchResponse>();
    if (!response.ok || !response.data?.length) return new MangasPage([], false);

    const hasNextPage = page < (response.meta?.totalPages ?? 1);
    return new MangasPage(this.toSMangaList(response.data), hasNextPage);
  }

  // ============================== Details ==============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const slug = this.slugFromUrl(url);
    if (slug == null) return null;
    const dto = await this.fetchMangaDto(slug);
    const manga = dto ? this.toSMangaOrNull(dto) : null;
    if (manga) manga.initialized = true;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = manga.url;

    const dto = await this.fetchMangaDto(slug);
    if (dto == null) throw new Error(`Doujiva manga not found: ${slug}`);

    const parsed = this.toSMangaOrNull(dto);
    if (parsed) parsed.url = manga.url;
    const details = parsed ?? manga;

    const chapterList = this.toSChapterList(dto);

    return new SMangaUpdate(details, chapterList);
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = chapter.url;
    const slug = chapter.memo["slug"] as string | undefined;
    if (slug == null) throw new Error(`Missing Doujiva manga slug for chapter: ${chapter.url}`);

    const response = (await this.client.get(`${this.apiUrl}/manga/${slug}/chapters/${chapterId}`)).parseAs<ChapterPagesResponse>();

    return (response.data ?? []).map((page, index) => new Page(index, "", page.imageUrl));
  }

  // ============================== Helpers ==============================

  private async mangaList(page: number, sort: string): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/manga`)!
      .newBuilder()
      .addQueryParameter("sort", sort)
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", String(PAGE_LIMIT))
      .build();

    const response = (await this.client.get(url.toString())).parseAs<MangaListResponse>();
    if (!response.ok || !response.data?.length) return new MangasPage([], false);

    const hasNextPage = page < (response.meta?.totalPages ?? 1);
    return new MangasPage(this.toSMangaList(response.data), hasNextPage);
  }

  private toSMangaList(data: MangaDto[]): SManga[] {
    return data.map((it) => this.toSMangaOrNull(it)).filter((it): it is SManga => it != null);
  }

  private async fetchMangaDto(slug: string): Promise<MangaDto | null> {
    const response = (await this.client.get(`${this.apiUrl}/manga/${slug}`)).parseAs<MangaDetailResponse>();
    if (!response.ok) return null;
    return response.data ?? null;
  }

  private toSMangaOrNull(dto: MangaDto): SManga | null {
    if (blank(dto.slug) || blank(dto.title)) return null;
    const tags = dto.tags ?? [];
    const manga = SManga.create();
    manga.url = dto.slug;
    manga.memo = { slug: dto.slug };
    manga.title = dto.title;
    manga.thumbnail_url = dto.coverUrl && dto.coverUrl.trim() ? dto.coverUrl : undefined;
    manga.description = this.buildDescription(dto) ?? undefined;
    manga.genre =
      distinct(
        tags
          .filter((it) => it.category === "TAG" || it.category === "PARODY")
          .map((it) => it.name.trim())
          .filter((it) => it.length > 0),
      ).join(", ") || undefined;
    // ARTIST and GROUP are the verified author-like fields on this API.
    manga.author =
      distinct(
        tags
          .filter((it) => it.category === "ARTIST" || it.category === "GROUP")
          .map((it) => it.name.trim())
          .filter((it) => it.length > 0),
      ).join(", ") || undefined;
    switch (dto.status?.toUpperCase()) {
      case "COMPLETED":
        manga.status = SManga.COMPLETED;
        break;
      case "ONGOING":
        manga.status = SManga.ONGOING;
        break;
      case "HIATUS":
      case "ON_HIATUS":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  private buildDescription(dto: MangaDto): string | null {
    const parts: string[] = [];
    if (!blank(dto.description)) parts.push(dto.description!);
    if ((dto.pageCount ?? 0) > 0) parts.push(`Pages: ${dto.pageCount}`);
    if (!blank(dto.language)) parts.push(`Language: ${dto.language}`);
    if (!blank(dto.mediaType)) parts.push(`Type: ${dto.mediaType}`);
    if (!blank(dto.sourceName)) parts.push(`Source: ${dto.sourceName}`);
    const s = parts.join("\n");
    return blank(s) ? null : s;
  }

  private toSChapterList(dto: MangaDto): SChapter[] {
    return (dto.chapters ?? []).map((chapter) => {
      const c = SChapter.create();
      c.url = chapter.id;
      c.memo = { slug: dto.slug, number: chapter.number };
      c.name = `Chapter ${String(chapter.number)}`;
      if (!blank(chapter.title)) c.name += ` - ${chapter.title}`;
      c.chapter_number = chapter.number;
      c.date_upload = chapter.createdAt ? tryParseInstant(chapter.createdAt) : 0;
      return c;
    });
  }

  private slugFromUrl(url: URL): string | null {
    const segments = url.pathname.split("/").filter((it) => it.trim());
    if (segments.length >= 2 && segments[0] === "manga") return segments[1];
    return null;
  }
}
