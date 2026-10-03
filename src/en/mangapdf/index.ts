// Port of keiyoushi/extensions-source src/en/mangapdf/MangaPdf.kt (+ Dto.kt)
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, isBlank, toHttpUrl, tryParseInstant } from "../../../sdk/index.ts";

// --- Dto.kt
interface MangaListResponse {
  items: MangaSummaryDto[];
  has_next: boolean;
}
const toMangasPage = (r: MangaListResponse) =>
  new MangasPage(
    r.items.map((it) => summaryToSManga(it)),
    r.has_next,
  );

interface MangaSummaryDto {
  id: string;
  title: string;
  thumbnail_url?: string | null;
}
function summaryToSManga(dto: MangaSummaryDto): SManga {
  const manga = SManga.create();
  manga.url = dto.id;
  manga.title = dto.title;
  manga.thumbnail_url = dto.thumbnail_url ?? undefined;
  return manga;
}

interface MangaUpdateResponse {
  manga: MangaDto;
  chapters: ChapterDto[];
}
const toSMangaUpdate = (r: MangaUpdateResponse) =>
  new SMangaUpdate(
    mangaToSManga(r.manga),
    r.chapters.map((it) => chapterToSChapter(it)),
  );

interface MangaDto {
  id: string;
  title: string;
  thumbnail_url?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  genres?: string[];
  status?: string;
}
function mangaToSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.url = dto.id;
  manga.title = dto.title;
  manga.thumbnail_url = dto.thumbnail_url ?? undefined;
  manga.author = dto.author ?? undefined;
  manga.artist = dto.artist ?? undefined;
  manga.description = dto.description ?? undefined;
  manga.genre = dto.genres && dto.genres.length > 0 ? dto.genres.join(", ") : undefined;
  manga.status = toMihonStatus(dto.status ?? "unknown");
  return manga;
}

interface ChapterDto {
  id: string;
  name: string;
  number?: number | null;
  scanlator?: string | null;
  uploaded_at?: string | null;
}
function chapterToSChapter(dto: ChapterDto): SChapter {
  const chapter = SChapter.create();
  chapter.url = dto.id;
  chapter.name = dto.name;
  chapter.chapter_number = dto.number ?? -1;
  chapter.scanlator = dto.scanlator ?? undefined;
  chapter.date_upload = tryParseInstant(dto.uploaded_at);
  return chapter;
}

interface PageListResponse {
  pages: { image_url: string }[];
}

function toMihonStatus(s: string): number {
  switch (s.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "licensed":
      return SManga.LICENSED;
    case "publishing_finished":
      return SManga.PUBLISHING_FINISHED;
    case "cancelled":
      return SManga.CANCELLED;
    case "on_hiatus":
      return SManga.ON_HIATUS;
    default:
      return SManga.UNKNOWN;
  }
}

export default class MangaPdf extends KeiSource {
  private get apiUrl() {
    return toHttpUrl("https://api.coffeemanga.shop");
  }

  private apiBuilder() {
    return this.apiUrl.newBuilder().addPathSegment("api").addPathSegment("v1").addPathSegment("mihon");
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.append("X-Client", "mihon-extension");
    return headers;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.apiBuilder().addPathSegment("popular").addQueryParameter("page", String(page)).build();

    return toMangasPage((await this.client.get(url.toString())).parseAs<MangaListResponse>());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.apiBuilder().addPathSegment("latest").addQueryParameter("page", String(page)).build();

    return toMangasPage((await this.client.get(url.toString())).parseAs<MangaListResponse>());
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = this.apiBuilder().addPathSegment("search").addQueryParameter("q", query).addQueryParameter("page", String(page)).build();

    return toMangasPage((await this.client.get(url.toString())).parseAs<MangaListResponse>());
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const url = this.apiBuilder().addPathSegment("manga").addPathSegment(manga.url).build();

    return toSMangaUpdate((await this.client.get(url.toString())).parseAs<MangaUpdateResponse>());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = this.apiBuilder().addPathSegment("chapter").addPathSegment(chapter.url).addPathSegment("pages").build();

    return (await this.client.get(url.toString())).parseAs<PageListResponse>().pages.map((page, index) => new Page(index, "", page.image_url));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/chapter/${chapter.url}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== this.apiUrl.host) return null;

    const id = url.pathname
      .slice(1)
      .split("/")
      .filter((it) => !isBlank(it))
      .at(-1);
    if (id == null) return null;

    const apiUrl = this.apiBuilder().addPathSegment("manga").addPathSegment(id).build();

    return toSMangaUpdate((await this.client.get(apiUrl.toString())).parseAs<MangaUpdateResponse>()).manga;
  }
}
