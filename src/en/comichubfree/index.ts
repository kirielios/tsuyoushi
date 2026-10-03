// Port of keiyoushi/extensions-source src/en/comichubfree/ComicHubFree.kt
import { DateTimeFormatter, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, distinctBy, toHttpUrl, urlWithoutDomain, type Element, type FilterList, type Request, type Response } from "../../../sdk/index.ts";

export default class ComicHubFree extends HttpSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("d-MMM-yyyy", Locale.getDefault());

  override get supportsLatest() {
    return true;
  }

  protected popularMangaRequest(page: number): Request {
    const url = toHttpUrl(`${this.baseUrl}/popular-comic`).newBuilder().addQueryParameter("page", String(page)).build();

    return GET(url, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select(".movie-list-index > .cartoon-box:has(.detail)").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      manga.title = element.selectFirst("h3")!.text();
      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? this.imageAttr(img) : undefined;
      return manga;
    });

    const hasNextPage = document.selectFirst("ul.pagination a[rel=next]:not(hidden)") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  protected latestUpdatesRequest(page: number): Request {
    const url = toHttpUrl(`${this.baseUrl}/new-comic`).newBuilder().addQueryParameter("page", String(page)).build();

    return GET(url, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    const url = toHttpUrl(`${this.baseUrl}/search-comic`).newBuilder().addQueryParameter("key", query).addQueryParameter("page", String(page)).build();

    return GET(url, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    let document = response.asJsoup();

    for (;;) {
      for (const element of document.select("div.episode-list > div > table > tbody > tr")) {
        const urlElement = element.selectFirst("a")!;
        const dateElement = element.select("td:last-of-type");

        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(urlElement.absUrl("href"));
        chapter.name = urlElement.text();
        chapter.date_upload = this.dateFormat.tryParseDate(dateElement.text());
        chapters.push(chapter);
      }

      const nextUrl = document.selectFirst("ul.pagination a[rel=next]:not(hidden)")?.absUrl("href");
      if (nextUrl == null || nextUrl.length === 0) {
        break;
      }
      document = (await this.client.execute(GET(nextUrl, this.headers))).asJsoup();
    }

    return chapters;
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const infoElement = document.selectFirst("div.movie-info");
    if (infoElement == null) return SManga.create();
    const seriesInfoElement = infoElement.selectFirst("div.series-info");
    const seriesDescriptionElement = infoElement.selectFirst("div#film-content");

    const authorElement = seriesInfoElement?.select("dt:contains(Authors:) + dd");
    const statusElement = seriesInfoElement?.select("dt:contains(Status:) + dd");

    const image = seriesInfoElement?.selectFirst("img");

    const manga = SManga.create();
    manga.description = seriesDescriptionElement?.text();
    manga.thumbnail_url = image ? this.imageAttr(image) : undefined;
    manga.author = authorElement?.text();
    manga.status = this.parseStatus(statusElement?.text() ?? "");
    return manga;
  }

  protected override pageListRequest(chapter: SChapter): Request {
    const url = toHttpUrl(this.baseUrl + chapter.url + "/all");

    return GET(url, this.headers);
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const pages = document.select("img.chapter_img").map((element, index) => new Page(index, "", this.imageAttr(element)));
    return distinctBy(pages, (it) => it.imageUrl);
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException: Not used.");
  }

  private parseStatus(status: string): number {
    switch (status) {
      case "Ongoing":
        return SManga.ONGOING;
      case "Completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private imageAttr(element: Element): string {
    return element.hasAttr("data-src") ? element.absUrl("data-src") : element.absUrl("src");
  }
}
