// Port of keiyoushi/extensions-source src/id/cosmicscansid/CosmicScansID.kt
import { ClientBuilder, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, isBlank, isNotBlank, parseHtml, substringAfterLast, toHttpUrl, trimEnd, tryParseInstant, urlWithoutDomain, type HttpUrlBuilder, type Response } from "../../../sdk/index.ts";
import { GenreFilter, OrderFilter, ProjectFilter, StatusFilter, TypeFilter, getCosmicScansIDFilterList } from "./filters.ts";

// Dto.kt
interface MangaListResponse {
  data?: MangaDto[];
  cursor?: CursorDto | null;
}
interface CursorDto {
  hasNext?: boolean;
  nextCursor?: string | null;
}
interface MangaDetailResponse {
  data?: MangaDetailDto;
}
interface ReadingPageResponse {
  data?: ReadingPageDto;
}
interface MangaDto {
  title?: string | null;
  slug?: string | null;
  cover?: string | null;
  status?: string | null;
  type?: string | null;
  genres?: string[] | null;
}
interface MangaDetailDto {
  title?: string | null;
  slug?: string | null;
  cover?: string | null;
  sinopsis?: string | null;
  type?: string | null;
  author?: string | null;
  genre?: string[] | null;
  genres?: string[] | null;
  status?: string | null;
  chapters?: ChapterDto[] | null;
}
interface ChapterDto {
  slug?: string | null;
  chapterNum?: string | null;
  time?: string | null;
  redirect_link?: string | null;
}
interface ReadingPageDto {
  chapters?: string[] | null;
  redirect_link?: string | null;
}

function parseStatus(s: string | null | undefined): number {
  switch (s?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
    case "complete":
      return SManga.COMPLETED;
    case "hiatus":
    case "on hiatus":
    case "on-hold":
    case "on hold":
      return SManga.ON_HIATUS;
    case "dropped":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

function mangaDtoToSManga(d: MangaDto): SManga {
  const m = SManga.create();
  m.title = d.title ?? "";
  m.url = `/series/${d.slug ?? ""}`;
  m.thumbnail_url = d.cover ?? undefined;
  m.genre = d.genres?.join(", ");
  m.status = parseStatus(d.status);
  m.description = d.type != null ? `Type: ${d.type}` : undefined;
  m.initialized = false;
  return m;
}

function detailToSManga(d: MangaDetailDto, defaultSlug = ""): SManga {
  const m = SManga.create();
  const s = isNotBlank(d.slug) ? d.slug : defaultSlug;
  m.title = d.title ?? "";
  m.url = `/series/${s}`;
  m.thumbnail_url = d.cover ?? undefined;
  m.description = [d.sinopsis, d.type != null ? `Type: ${d.type}` : null, d.author != null ? `Author: ${d.author}` : null].filter((it) => it != null).join("\n\n");
  m.genre = (d.genre ?? d.genres)?.join(", ");
  m.author = d.author ?? undefined;
  m.status = parseStatus(d.status);
  m.initialized = true;
  return m;
}

function chapterDtoToSChapter(d: ChapterDto): SChapter {
  const c = SChapter.create();
  c.name = `Chapter ${d.chapterNum ?? ""}`.trim();
  c.url = `/chapter/${d.slug ?? ""}`;
  const n = d.chapterNum?.trim();
  c.chapter_number = n != null && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(n) ? parseFloat(n) : -1;
  c.date_upload = tryParseInstant(d.time);
  return c;
}

const PAGE_SIZE = 24;

export default class CosmicScansID extends KeiSource {
  private readonly apiUrl = "https://cdncid.csmcscns.id/v1/manga";

  private readonly cursorCache = new Map<string, string>();

  private readonly lastPage = new Map<string, number>();

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3, 1000);
  }

  // URL compat: handle old "/manga/slug" and new "/series/slug"
  private slug(manga: SManga): string {
    let url = manga.url;
    if (url.startsWith("/manga/")) url = url.slice("/manga/".length);
    if (url.startsWith("/series/")) url = url.slice("/series/".length);
    return trimEnd(url, "/");
  }

  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const key = "popular";
    if (page > 1 && isBlank(this.cursorCache.get(`${key}:${page}`))) return new MangasPage([], false);
    this.lastPage.set(key, page);
    const url = toHttpUrl(`${this.apiUrl}/filter`).newBuilder().addQueryParameter("limit", String(PAGE_SIZE)).addQueryParameter("order_by", "popular");
    this.addCursor(url, key, page);
    const response = await this.client.get(String(url.build()));
    return this.parseMangaPage(response, key);
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const key = "update";
    if (page > 1 && isBlank(this.cursorCache.get(`${key}:${page}`))) return new MangasPage([], false);
    this.lastPage.set(key, page);
    const url = toHttpUrl(`${this.apiUrl}/filter`).newBuilder().addQueryParameter("limit", String(PAGE_SIZE)).addQueryParameter("order_by", "update");
    this.addCursor(url, key, page);
    const response = await this.client.get(String(url.build()));
    return this.parseMangaPage(response, key);
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (isNotBlank(query)) {
      if (page > 1) return new MangasPage([], false);
      const url = toHttpUrl(`${this.apiUrl}/search`).newBuilder().addQueryParameter("limit", "48").addQueryParameter("q", query).build();
      const result = (await this.client.get(String(url))).parseAs<MangaListResponse>();
      return new MangasPage((result.data ?? []).map(mangaDtoToSManga), false);
    }

    const key = this.searchKey(query, filters, "filter");
    if (page > 1 && isBlank(this.cursorCache.get(`${key}:${page}`))) return new MangasPage([], false);
    this.lastPage.set(key, page);
    const url = toHttpUrl(`${this.apiUrl}/filter`).newBuilder().addQueryParameter("limit", String(PAGE_SIZE));
    this.addFilters(url, filters);
    this.addCursor(url, key, page);

    const response = await this.client.get(String(url.build()));
    return this.parseMangaPage(response, key);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const firstSegment = segments[0];
    if (firstSegment !== "series" && firstSegment !== "manga") return null;
    const slug = segments[1];
    if (!slug) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(`/series/${slug}`);
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  // ======================= Details and Chapters ==========================
  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/chapter/${substringAfterLast(chapter.url, "/")}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = this.slug(manga);
    const data = (await this.client.get(`${this.apiUrl}/mangaDetail/${slug}`)).parseAs<MangaDetailResponse>().data ?? {};
    const parsedChapters = (data.chapters ?? []).filter((it) => isNotBlank(it.slug) && isBlank(it.redirect_link)).map(chapterDtoToSChapter);
    return new SMangaUpdate(detailToSManga(data, slug), parsedChapters);
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = substringAfterLast(chapter.url, "/");
    const data = (await this.client.get(`${this.apiUrl}/readingPage/${slug}`)).parseAs<ReadingPageResponse>().data ?? {};
    if (isNotBlank(data.redirect_link)) return [];
    const chapterUrl = this.getChapterUrl(chapter);
    return (data.chapters ?? [])
      .map((html) => parseHtml(this.host.load, html, "").selectFirst("img")?.attr("src"))
      .filter((it): it is string => isNotBlank(it))
      .map((imageUrl, index) => new Page(index, chapterUrl, imageUrl));
  }

  // ============================== Filters ===============================
  override getFilterList(_data: unknown = null): FilterList {
    return getCosmicScansIDFilterList();
  }

  // ============================= Utilities ==============================
  private parseMangaPage(response: Response, key: string): MangasPage {
    const result = response.parseAs<MangaListResponse>();
    const page = this.lastPage.get(key) ?? 1;
    const next = result.cursor?.nextCursor;
    if (isNotBlank(next)) this.cursorCache.set(`${key}:${page + 1}`, next);
    return new MangasPage((result.data ?? []).map(mangaDtoToSManga), result.cursor?.hasNext === true);
  }

  private addCursor(builder: HttpUrlBuilder, key: string, page: number) {
    if (page > 1) {
      const c = this.cursorCache.get(`${key}:${page}`);
      if (isNotBlank(c)) builder.addQueryParameter("after", c);
    }
  }

  private addFilters(builder: HttpUrlBuilder, filters: FilterList) {
    const order = firstInstanceOrNull(filters, OrderFilter)?.value;
    if (isNotBlank(order)) builder.addQueryParameter("order_by", order);

    const status = firstInstanceOrNull(filters, StatusFilter)?.value;
    if (isNotBlank(status)) builder.addQueryParameter("release_status", status);

    const type = firstInstanceOrNull(filters, TypeFilter)?.value;
    if (isNotBlank(type)) builder.addQueryParameter("type_manga", type);

    const project = firstInstanceOrNull(filters, ProjectFilter)?.value;
    if (isNotBlank(project)) builder.addQueryParameter("is_project", project);

    (firstInstanceOrNull(filters, GenreFilter)?.state ?? []).filter((it) => it.state).forEach((it) => builder.addQueryParameter("genres_slug", it.slug));
  }

  private searchKey(query: string, filters: FilterList, endpoint: string): string {
    return [
      endpoint,
      query,
      firstInstanceOrNull(filters, OrderFilter)?.value ?? "",
      firstInstanceOrNull(filters, StatusFilter)?.value ?? "",
      firstInstanceOrNull(filters, TypeFilter)?.value ?? "",
      firstInstanceOrNull(filters, ProjectFilter)?.value ?? "",
      (firstInstanceOrNull(filters, GenreFilter)?.state ?? [])
        .filter((it) => it.state)
        .map((it) => it.slug)
        .join(","),
    ].join(":");
  }
}
