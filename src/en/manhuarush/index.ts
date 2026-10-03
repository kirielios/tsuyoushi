// Port of keiyoushi/extensions-source src/en/manhuarush/ManhuaRush.kt (+ Dto.kt)
import { DateTimeFormatter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, extractNextJsRsc, hasKeys, substringAfter, substringBefore, type Request, type Response } from "../../../sdk/index.ts";

interface ChaptersDto {
  chapters: ChapterDto[];
  mangadexId: string;
}

interface ChapterDto {
  chapter: string;
  title: string;
  createdAt?: string | null;
}

interface ReaderDto {
  imageUrls: string[];
}

// Shared date formatter - kept here since it's used by DTOs
const manhuaRushDateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);

function toSChapter(dto: ChapterDto, mangadexId: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/reader/${mangadexId}/${dto.chapter}`;
  chapter.name = `Chapter ${dto.chapter}` + (dto.title.length > 0 ? ` - ${dto.title}` : "");
  chapter.date_upload = manhuaRushDateFormat.tryParseDateTime(dto.createdAt, "UTC");
  return chapter;
}

export default class ManhuaRush extends HttpSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private _rscHeaders?: Headers;
  private get rscHeaders(): Headers {
    if (!this._rscHeaders) {
      this._rscHeaders = this.headersBuilder();
      this._rscHeaders.append("RSC", "1");
    }
    return this._rscHeaders;
  }

  protected popularMangaRequest(_page: number): Request {
    return GET(this.baseUrl, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select("li a.nav-link[href=/ttp-providence]").map((element) => {
      const manga = SManga.create();
      manga.url = element.attr("href");
      manga.title = document.select("footer .footer-tagline strong").text();
      const style = substringBefore(substringAfter(document.select("div[style*=background-image]").attr("style"), "url('"), "'");
      manga.thumbnail_url = `${this.baseUrl}${style}`;
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(this.baseUrl + manga.url, this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();

    const manga = SManga.create();
    manga.title = document.select("h1.manga-title").text();
    manga.description = document.select(".manga-desc p").text();
    manga.thumbnail_url = document.select(".cover img").attr("abs:src");
    manga.genre = document
      .select(".tag-pill")
      .map((it) => it.text())
      .join(", ");
    return manga;
  }

  protected override chapterListRequest(manga: SManga): Request {
    return GET(this.baseUrl + manga.url, this.rscHeaders);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const dto = extractNextJsRsc<ChaptersDto>(response.text(), hasKeys("chapters", "mangadexId"));
    if (!dto) throw new Error("Failed to extract chapters");

    return dto.chapters.map((it) => toSChapter(it, dto.mangadexId));
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(this.baseUrl + chapter.url, this.rscHeaders);
  }

  protected pageListParse(response: Response): Page[] {
    const dto = extractNextJsRsc<ReaderDto>(response.text(), hasKeys("imageUrls"));
    if (!dto) return [];

    return dto.imageUrls.map((url, index) => new Page(index, "", url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  protected searchMangaRequest(_page: number, _query: string, _filters: FilterList): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected searchMangaParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
}
