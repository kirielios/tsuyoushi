// Port of keiyoushi/extensions-source src/en/akaicomic/AkaiComic.kt (+ AkaiComicDto.kt)
import {
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  substringBefore,
  type ClientBuilder,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// --- AkaiComicDto.kt
interface MangaDto {
  id: string;
  seriesName: string;
  coverUrl: string | null;
  slug: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  genres: string | null;
  status: string | null;
  type: string | null;
  alternativeName: string | null;
  updatedAt: string | null;
}
interface MangaListResponse {
  manga: MangaDto[];
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
}
interface ChapterDto {
  chapter_number: number;
  created_at?: string | null;
  id: number;
  locked_by_coins?: number;
  manga_id: string;
}
interface ChapterListResponse {
  chapters: ChapterDto[];
}
interface PageListResponse {
  pages: string[];
}

type Json = Record<string, unknown>;

/** kotlinx @JsonNames: the property's own name first, then its alternates. */
const pick = (o: Json, ...names: string[]): unknown => {
  for (const n of names) if (o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
};
const asString = (v: unknown): string | null => (v == null ? null : String(v)); // lenient primitives, as keiyoushi's Json

function toMangaDto(o: Json): MangaDto {
  return {
    id: asString(pick(o, "id", "lid", "series_id")) ?? "",
    seriesName: asString(pick(o, "seriesName", "series_name", "name", "title")) ?? "",
    coverUrl: asString(pick(o, "coverUrl", "cover_url", "cover", "thumbnail", "image")),
    slug: asString(pick(o, "slug", "series_slug")),
    author: asString(o.author),
    artist: asString(o.artist),
    description: asString(o.description),
    genres: asString(o.genres),
    status: asString(o.status),
    type: asString(o.type),
    alternativeName: asString(pick(o, "alternativeName", "alternative_name", "alt_name")),
    updatedAt: asString(o.updated_at),
  };
}

function toMangaListResponse(o: Json): MangaListResponse {
  const manga = ((pick(o, "manga", "data", "series") as Json[] | undefined) ?? []).map(toMangaDto);
  return {
    manga,
    ok: (o.ok as boolean | undefined) ?? false,
    page: (o.page as number | undefined) ?? 1,
    pageSize: (pick(o, "pageSize", "page_size") as number | undefined) ?? manga.length,
    total: (o.total as number | undefined) ?? manga.length,
  };
}

/** SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US) in UTC; tryParse -> 0. */
function tryParseDate(s: string | null | undefined): number {
  const m = s != null ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z/.exec(s) : null;
  if (!m) return 0;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

const PAGE_SIZE = 20;
const FETCH_ALL_SIZE = 100;

const byUpdatedAtDesc = (a: MangaDto, b: MangaDto) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt == null ? 1 : b.updatedAt == null ? -1 : a.updatedAt < b.updatedAt ? 1 : -1);

export default class AkaiComic extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  // ============================== Popular ===============================

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.apiUrl}/manga/list?limit=${PAGE_SIZE}&page=${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const data = toMangaListResponse(response.parseAs<Json>());
    const manga = data.manga.map((it) => this.mangaToSManga(it));
    const hasNextPage = data.page * data.pageSize < data.total;
    return new MangasPage(manga, hasNextPage);
  }

  // ============================== Latest ================================

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.apiUrl}/manga/list?limit=${PAGE_SIZE}&page=${page}`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    const data = toMangaListResponse(response.parseAs<Json>());
    const manga = [...data.manga].sort(byUpdatedAtDesc).map((it) => this.mangaToSManga(it));
    const hasNextPage = data.page * data.pageSize < data.total;
    return new MangasPage(manga, hasNextPage);
  }

  // ============================== Search ================================

  // upstream handles everything in fetchSearchManga, so bypass KeiSource's URL handling
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const allManga = await this.fetchAllManga();
    const filtered = query.trim() !== "" ? allManga.filter((it) => it.title.toLowerCase().includes(query.toLowerCase())) : allManga;
    return new MangasPage(filtered, false);
  }

  private async fetchAllManga(): Promise<SManga[]> {
    const allManga: MangaDto[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await this.client.execute(GET(`${this.apiUrl}/manga/list?limit=${FETCH_ALL_SIZE}&page=${page}`, this.headers));
      const data = toMangaListResponse(response.parseAs<Json>());
      allManga.push(...data.manga);
      hasMore = page * data.pageSize < data.total;
      page++;
    }
    return allManga.map((it) => this.mangaToSManga(it));
  }

  protected searchMangaRequest(): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected searchMangaParse(): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Details ================================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/serie/${manga.url}`;
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${this.apiUrl}/manga/${manga.url}`, this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const root = response.parseAs<unknown>();
    const mangaElement = this.extractMangaElement(root);
    return this.mangaToSManga(toMangaDto(mangaElement as Json));
  }

  // ============================== Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    const [mangaId, chapterNum] = chapter.url.split("/");
    return `${this.baseUrl}/reader/${mangaId}/${chapterNum}`;
  }

  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.apiUrl}/manga/${manga.url}/chapters`, this.headers);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const data = response.parseAs<ChapterListResponse>();
    return data.chapters
      .filter((it) => (it.locked_by_coins ?? 0) === 0)
      .map((chapter) => {
        const c = SChapter.create();
        c.url = `${chapter.manga_id}/${chapter.chapter_number}`;
        c.name = `Chapter ${chapter.chapter_number}`;
        c.chapter_number = chapter.chapter_number;
        c.date_upload = tryParseDate(chapter.created_at);
        return c;
      })
      .sort((a, b) => b.chapter_number - a.chapter_number);
  }

  // ============================== Pages ==================================

  protected override pageListRequest(chapter: SChapter): Request {
    const [mangaId, chapterNum] = chapter.url.split("/");
    return GET(`${this.apiUrl}/manga/${mangaId}/chapter/${chapterNum}/pages`, this.headers);
  }

  protected pageListParse(response: Response): Page[] {
    const data = response.parseAs<PageListResponse>();
    return data.pages.map((path, index) => new Page(index, "", `${this.baseUrl}${path}`));
  }

  protected imageUrlParse(): string {
    throw new Error("UnsupportedOperationException");
  }

  override imageRequest(page: Page): Request {
    const headers = this.headersBuilder();
    headers.set("Referer", `${this.baseUrl}/`);
    headers.set("Accept", "image/avif,image/webp,image/png,image/jpeg,*/*");
    return GET(page.imageUrl!, headers);
  }

  // ============================== Helpers ================================

  private mangaToSManga(d: MangaDto): SManga {
    const m = SManga.create();
    m.url = d.id.trim() !== "" ? d.id : (d.slug ?? "");
    const alt = d.alternativeName != null ? substringBefore(d.alternativeName, ",").trim() : "";
    m.title = d.seriesName.trim() !== "" ? d.seriesName : alt !== "" ? alt : "Unknown title";
    m.thumbnail_url = d.coverUrl ?? undefined;
    m.author = d.author ?? undefined;
    m.artist = d.artist ?? undefined;
    let description = "";
    if (d.description != null) description += d.description;
    if (d.alternativeName != null) {
      if (description.length > 0) description += "\n\n";
      description += `Alternative name: ${d.alternativeName}`;
    }
    m.description = description.length > 0 ? description : undefined;
    const genre: string[] = [];
    if (d.type != null) genre.push(d.type);
    if (d.genres != null)
      genre.push(
        ...d.genres
          .split(",")
          .map((it) => it.trim())
          .filter((it) => it.length > 0),
      );
    m.genre = genre.length > 0 ? genre.join(", ") : undefined;
    switch (d.status?.toUpperCase()) {
      case "ONGOING":
      case "RELEASING":
        m.status = SManga.ONGOING;
        break;
      case "COMPLETED":
        m.status = SManga.COMPLETED;
        break;
      case "HIATUS":
        m.status = SManga.ON_HIATUS;
        break;
      case "CANCELLED":
      case "DROPPED":
        m.status = SManga.CANCELLED;
        break;
      default:
        m.status = SManga.UNKNOWN;
    }
    m.initialized = true;
    return m;
  }

  private extractMangaElement(e: unknown): unknown {
    if (Array.isArray(e)) return e[0] ?? e;
    if (e !== null && typeof e === "object") {
      const o = e as Json;
      const nested = o.manga ?? o.series ?? o.data ?? o.result; // JSON null counts as present upstream, but decodes to the same fallback
      if (Array.isArray(nested)) return nested[0] ?? e;
      if (nested === undefined || nested === null) return e;
      return nested;
    }
    return e;
  }
}
