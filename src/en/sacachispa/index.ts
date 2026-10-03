// Port of keiyoushi/extensions-source src/en/sacachispa/Sacachispa.kt (+ Dto.kt), libVersion 1.4
import {
  GET,
  HttpSource,
  HttpUrl,
  MangasPage,
  Page,
  SChapter,
  SManga,
  extractNextJs,
  hasKeys,
  isBlank,
  substringAfter,
  tryParseInstant,
  type FilterList,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// ---- Dto.kt
interface SeriesDto {
  title: string;
  slug: string;
  description?: string | null;
  cover_image_url?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string[];
}
interface SeriesResponseDto {
  items: SeriesDto[];
  page: number;
  totalPages: number;
}
interface ChapterDto {
  chapter_number: number;
  title?: string | null;
  created_at?: string | null;
  pages?: string[];
}
interface RscChaptersDto {
  chapters: ChapterDto[];
}
interface RscPageDto {
  chapter: ChapterDto;
}

function seriesToSManga(s: SeriesDto): SManga {
  const manga = SManga.create();
  manga.title = s.title;
  manga.url = s.slug;
  manga.description = s.description ?? undefined;
  manga.thumbnail_url = s.cover_image_url ?? undefined;
  manga.author = s.author ?? undefined;
  manga.artist = s.artist ?? undefined;
  manga.genre = (s.genres ?? []).join(", ");
  const status = s.status?.toLowerCase();
  manga.status = status === "ongoing" ? SManga.ONGOING : status === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;
  return manga;
}

function chapterToSChapter(c: ChapterDto, slug: string): SChapter {
  const chapter = SChapter.create();
  const numberStr = String(c.chapter_number).replace(/\.0$/, "");
  chapter.url = `/series/${slug}/chapter/${numberStr}`;
  chapter.name = !isBlank(c.title) ? `Chapter ${numberStr} - ${c.title}` : `Chapter ${numberStr}`;
  chapter.chapter_number = c.chapter_number;
  chapter.date_upload = tryParseInstant(c.created_at);
  return chapter;
}

export default class Sacachispa extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    return h;
  }

  // ============================== Popular ==============================
  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/api/series?page=${page}&pageSize=24`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const dto = response.parseAs<SeriesResponseDto>();
    const mangas = dto.items.map(seriesToSManga);
    const hasNext = dto.page < dto.totalPages;
    return new MangasPage(mangas, hasNext);
  }

  // ============================== Latest ===============================
  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================
  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    const url = HttpUrl.parse(`${this.baseUrl}/api/series`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("pageSize", "24").addQueryParameter("search", query).build();
    return GET(url.toString(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Details ==============================
  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}/series/${manga.url}`, this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.font-heading")!.text();
    manga.description = document.selectFirst("p.max-w-2xl")?.text();
    manga.author = substringOrUndefined(document.selectFirst("span:contains(Author:)")?.text(), "Author: ");
    manga.artist = substringOrUndefined(document.selectFirst("span:contains(Artist:)")?.text(), "Artist: ");

    const badges = document.select("span[data-slot=badge]");
    const statusText = badges.map((it) => it.text().toLowerCase()).find((it) => it === "ongoing" || it === "completed");
    manga.status = this.parseStatus(statusText);

    manga.genre = document
      .select("a[href^=/browse?genre=] span")
      .map((it) => it.text())
      .join(", ");
    manga.thumbnail_url = document.selectFirst("div.aspect-\\[2\\/3\\] img")?.absUrl("src");
    return manga;
  }

  private parseStatus(status: string | null | undefined): number {
    switch (status?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ============================= Chapters ==============================
  protected override chapterListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const dto = extractNextJs<RscChaptersDto>(response, hasKeys("chapters"));
    if (!dto) return [];

    const slug = new URL(response.url).pathname.split("/").filter((it) => it.length > 0).at(-1)!;
    return dto.chapters.map((it) => chapterToSChapter(it, slug)).sort((a, b) => b.chapter_number - a.chapter_number);
  }

  // =============================== Pages ===============================
  protected pageListParse(response: Response): Page[] {
    const dto = extractNextJs<RscPageDto>(response, (element) => {
      if (element === null || typeof element !== "object" || Array.isArray(element)) return false;
      const chapter = (element as Record<string, unknown>)["chapter"];
      return chapter !== null && typeof chapter === "object" && !Array.isArray(chapter) && "pages" in chapter;
    });
    if (!dto) return [];

    return (dto.chapter.pages ?? []).map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}

const substringOrUndefined = (text: string | undefined, delimiter: string): string | undefined => (text === undefined ? undefined : substringAfter(text, delimiter));
