// Port of keiyoushi/extensions-source src/en/readallcomicscom/ReadAllComics.kt
import { DateTimeFormatter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, substringAfterLast, substringBefore, toHttpUrl, urlWithoutDomain, type Element, type Request, type Response } from "../../../sdk/index.ts";

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US);

export default class ReadAllComics extends HttpSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // Popular

  protected popularMangaRequest(page: number): Request {
    const url = page === 1 ? this.baseUrl : `${this.baseUrl}/?paged=${page}`;
    return GET(url, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("ul.list-story.categories li").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst(".pagination .page-numbers.current + .page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Search

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    b.addQueryParameter("story", query);
    b.addQueryParameter("s", "");
    b.addQueryParameter("type", "comic");
    if (page > 1) b.addQueryParameter("paged", page.toString());

    return GET(b.build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("ul.list-story.categories li").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("a.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const titleAnchor = element.selectFirst("a.cat-title")!;
    manga.url = urlWithoutDomain(titleAnchor.attr("abs:href"));
    manga.title = titleAnchor.text();
    manga.thumbnail_url = element.selectFirst("img.book-cover")?.attr("abs:src");
    return manga;
  }

  // Manga details

  protected mangaDetailsParse(response: Response): SManga {
    const manga = SManga.create();
    const archive = response.asJsoup().selectFirst(".description-archive")!;
    manga.title = archive.selectFirst("h1")!.text();
    manga.thumbnail_url = archive.selectFirst("p img")?.attr("abs:src");
    const infoStrongs = archive.select(".b > p strong");
    manga.genre = infoStrongs.first()?.text();
    manga.author = infoStrongs.last()?.text();
    manga.description = archive.selectFirst("#hidden-description")?.wholeText().trim();
    return manga;
  }

  // Chapters

  protected chapterListParse(response: Response): SChapter[] {
    return response
      .asJsoup()
      .select(".list-story a")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(element.attr("abs:href"));
        chapter.name = element.text();
        const year = substringBefore(substringAfterLast(chapter.name, "("), ")");
        chapter.date_upload = dateFormat.tryParseDate(`${year}-1-1`, "UTC");
        return chapter;
      });
  }

  // Pages

  protected pageListParse(response: Response): Page[] {
    return response
      .asJsoup()
      .select("body img:not(div[id=logo] img)")
      .map((element, idx) => new Page(idx, "", element.attr("abs:src")));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // Latest (unsupported)

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
}
