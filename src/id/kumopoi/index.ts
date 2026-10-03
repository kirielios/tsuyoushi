// Port of keiyoushi/extensions-source src/id/kumopoi/KumoPoi.kt
import { ClientBuilder, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, hmacSha256, isNotBlank, substringAfterLast, substringBeforeLast, toHex, toHttpUrl, trimEnd, tryParseInstant } from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

// Dto.kt
interface ComicListResponse {
  data: ComicListData;
}
interface ComicListData {
  data?: ComicDto[];
  meta: PaginationMeta;
}
interface PaginationMeta {
  page?: number;
  totalPages?: number;
}
interface ComicDetailsResponse {
  data: ComicDto;
}
interface ComicDto {
  slug: string;
  title: string;
  cover?: string | null;
  coverMedium?: string | null;
  coverSmall?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: GenreDto[];
  chapters?: ChapterDto[];
}
interface GenreDto {
  name: string;
  slug: string;
}
interface ChapterDto {
  id: string;
  number: string;
  title?: string | null;
  isLocked?: boolean;
  publishedAt?: string | null;
}
interface PagesResponse {
  data: PagesData;
}
interface PagesData {
  locked?: boolean;
  pages?: PageItemDto[];
}
interface PageItemDto {
  id: string;
  token: string;
}

const items = (r: ComicListResponse) => r.data.data ?? [];
const hasNextPage = (r: ComicListResponse) => (r.data.meta.page ?? 1) < (r.data.meta.totalPages ?? 1);

/** URLEncoder.encode(s, "UTF-8"): spaces become "+", and *-._ stay. */
const urlEncode = (s: string) => encodeURIComponent(s).replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");

function buildCoverUrl(cover: string | null | undefined): string | undefined {
  if (cover == null || !cover.trim()) return undefined;
  if (cover.startsWith("http://") || cover.startsWith("https://")) return cover;
  const path = cover
    .replace(/^\//, "")
    .split("/")
    .map((it) => urlEncode(it).replaceAll("+", "%20"))
    .join("/");
  return `https://kumo.gorae.my.id/${path}`;
}

function comicToSManga(c: ComicDto): SManga {
  const m = SManga.create();
  m.url = `/comic/${c.slug}`;
  m.title = c.title;
  m.thumbnail_url = buildCoverUrl(c.coverMedium ?? c.cover ?? c.coverSmall);
  m.description = c.description ?? undefined;
  m.author = c.author ?? undefined;
  m.artist = c.artist ?? undefined;
  m.genre = (c.genres ?? []).map((it) => it.name).join(", ");
  switch (c.status?.toUpperCase()) {
    case "ONGOING":
      m.status = SManga.ONGOING;
      break;
    case "END":
    case "COMPLETED":
      m.status = SManga.COMPLETED;
      break;
    default:
      m.status = SManga.UNKNOWN;
  }
  return m;
}

function chapterToSChapter(c: ChapterDto, comicSlug: string): SChapter {
  const ch = SChapter.create();
  const cleanNumber = c.number.trim();
  ch.url = `/comic/${comicSlug}/chapter/${cleanNumber}#${c.id}`;
  let name = "";
  if (c.isLocked) name += "🔒 ";
  name += `Chapter ${cleanNumber}`;
  if (isNotBlank(c.title)) name += ` - ${c.title.trim()}`;
  ch.name = name;
  ch.chapter_number = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleanNumber) ? parseFloat(cleanNumber) : -1;
  ch.date_upload = tryParseInstant(c.publishedAt);
  return ch;
}

const API_BASE_HOST = "https://api.kumopoi.com";
const API_BASE = "https://api.kumopoi.com/api/v1";
const SIGNING_KEY = "vtm6RLiSyKmWd1YpZtkt5ue4oPdYdmzW0ZgxDgyBNEM=";
const PAGE_LIMIT = 20;

export default class KumoPoi extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(4, 1000);
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchComics(page, "", "popular");
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchComics(page, "", "latest");
  }

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let sort = "latest";
    let type = "";
    let status = "";
    const genres: string[] = [];

    for (const filter of filters) {
      if (filter instanceof SortFilter) sort = filter.selected;
      else if (filter instanceof TypeFilter) type = filter.selected;
      else if (filter instanceof StatusFilter) status = filter.selected;
      else if (filter instanceof GenreFilter) filter.state.filter((it) => it.state).forEach((it) => genres.push(it.slug));
    }

    return this.fetchComics(page, query.trim(), sort, type, status, genres);
  }

  private async fetchComics(page: number, search = "", sort = "latest", type = "", status = "", genres: string[] = []): Promise<MangasPage> {
    const url = toHttpUrl(`${API_BASE}/comics`).newBuilder();
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", String(PAGE_LIMIT));
    if (isNotBlank(sort)) url.addQueryParameter("sort", sort);
    if (isNotBlank(search)) url.addQueryParameter("search", search);
    if (isNotBlank(type)) url.addQueryParameter("type", type);
    if (isNotBlank(status)) url.addQueryParameter("status", status);
    if (genres.length) url.addQueryParameter("genre", genres.join(","));

    const response = (await this.client.get(String(url.build()))).parseAs<ComicListResponse>();
    return new MangasPage(items(response).map(comicToSManga), hasNextPage(response));
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = this.getComicSlug(manga.url);
    const response = (await this.client.get(`${API_BASE}/comics/${slug}`)).parseAs<ComicDetailsResponse>();
    return new SMangaUpdate(
      comicToSManga(response.data),
      (response.data.chapters ?? []).map((it) => chapterToSChapter(it, response.data.slug)),
    );
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    if (!chapter.url.includes("#")) throw new Error("Please refresh chapter list");
    const chapterId = substringAfterLast(chapter.url, "#");
    const path = `/api/v1/chapters/${chapterId}/pages`;
    const timestamp = String(Math.trunc(Date.now() / 1000));
    const nonce = this.generateNonce(16);
    const signature = await this.generateSignature(path, timestamp, nonce);

    const pageHeaders = this.headersBuilder();
    pageHeaders.append("x-app-timestamp", timestamp);
    pageHeaders.append("x-app-nonce", nonce);
    pageHeaders.append("x-app-signature", signature);

    const response = (await this.client.get(`${API_BASE_HOST}${path}`, pageHeaders)).parseAs<PagesResponse>();
    if (response.data.locked) throw new Error("Chapter terkunci (Premium)");

    return (response.data.pages ?? []).map((pageItem, index) => new Page(index, "", `${API_BASE}/media/chapter/deliver?token=${urlEncode(pageItem.token)}`));
  }

  override getMangaUrl(manga: SManga): string {
    const slug = this.getComicSlug(manga.url);
    return `${this.baseUrl}/comic/${slug}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${substringBeforeLast(chapter.url, "#")}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const segment = segments[0];
    if (segment == null) return null;
    if (segment !== "comic" && segment !== "manga") return null;
    const slug = segments[1];
    if (!isNotBlank(slug)) return null;
    const manga = SManga.create();
    manga.url = `/comic/${slug}`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  private getComicSlug(url: string): string {
    return substringAfterLast(trimEnd(url, "/"), "/");
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new TypeFilter(), new StatusFilter(), new GenreFilter());
  }

  private generateNonce(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  private async generateSignature(path: string, timestamp: string, nonce: string): Promise<string> {
    const message = `GET:${path}:${timestamp}:${nonce}`;
    return toHex(await hmacSha256(SIGNING_KEY, message));
  }
}
