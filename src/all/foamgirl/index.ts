// Port of keiyoushi/extensions-source src/all/foamgirl/FoamGirl.kt
import { ClientBuilder, DateTimeFormatter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, toHttpUrl, urlWithoutDomain, type Request, type Response } from "../../../sdk/index.ts";

const HAS_NEXT_PAGE_REGEX = /(\d+_\d+)/;
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy.M.d", Locale.ENGLISH);

export default class FoamGirl extends HttpSource {
  override get supportsLatest(): boolean {
    return false;
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  // ============================== Popular ======================================

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/page/${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".update_area .i_list").map((element) => {
      const manga = SManga.create();
      manga.thumbnail_url = element.select("img").attr("data-original");
      manga.title = element.select("a.meta-title").text();
      manga.url = urlWithoutDomain(element.select("a").attr("href"));
      manga.initialized = true;
      return manga;
    });
    const hasNextPage = document.selectFirst("a.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ======================================

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ======================================

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("page").addPathSegment(`${page}`).addQueryParameter("post_type", "post").addQueryParameter("s", query).build();
    return GET(url, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Details ======================================

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    return manga;
  }

  protected mangaDetailsParse(_response: Response): SManga {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Chapters ======================================

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(document.select("link[rel=canonical]").attr("abs:href"));
    chapter.chapter_number = 0;
    chapter.name = "GALLERY";
    chapter.date_upload = this.getDate(document.select("span.image-info-time").text().substring(1));
    return [chapter];
  }

  // ============================== Pages ======================================

  // it follows the pagination with blocking calls
  protected async pageListParse(response: Response): Promise<Page[]> {
    const allPages: Page[] = [];
    let document = response.asJsoup();
    let pageIndex = 0;

    while (true) {
      for (const element of document.select(".imageclick-imgbox")) {
        allPages.push(new Page(pageIndex++, "", element.absUrl("href")));
      }

      const next = document.selectFirst(".page-numbers[title=Next page]")?.absUrl("href");
      const nextPageUrl = next && HAS_NEXT_PAGE_REGEX.test(next) ? next : null;
      if (!nextPageUrl) break;

      document = (await this.client.execute(GET(nextPageUrl, this.headers))).asJsoup();
    }

    return allPages;
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Helpers ======================================

  private getDate(str: string): number {
    return DATE_FORMAT.tryParseDate(str);
  }
}
