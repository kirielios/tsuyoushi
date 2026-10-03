// Port of keiyoushi/extensions-source src/id/mangalay/Mangalay.kt
import { GET, HttpSource, MangasPage, Page, SChapter, SManga, parseHtml, urlWithoutDomain, type Document, type FilterList, type Request, type Response } from "../../../sdk/index.ts";

export default class Mangalay extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  /** Jsoup.parse(response.body.string(), baseUrl) */
  private parse(response: Response): Document {
    return parseHtml(this.host.load, response.text(), this.baseUrl);
  }

  protected popularMangaRequest(_page: number): Request {
    return GET(`${this.baseUrl}/2013/04/daftar-baca-komik_20.html`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = this.parse(response);
    const mangas = document.select(".post-body table").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.select("a").first()!.absUrl("href"));
      manga.title = element.select(".tr-caption").text();
      manga.thumbnail_url = element.select("img").attr("abs:src");
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  protected mangaDetailsParse(_response: Response): SManga {
    return SManga.create();
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = this.parse(response);
    return document.select(".post-body span > a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = element.select("b").text();
      return chapter;
    });
  }

  protected pageListParse(response: Response): Page[] {
    const document = this.parse(response);
    return document
      .select(".separator img")
      .slice(0, -1) // :last-child not working somehow
      .map((element, index) => new Page(index, "", element.attr("abs:src")));
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
