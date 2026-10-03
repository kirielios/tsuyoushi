// Port of keiyoushi/extensions-source src/en/ohjoysextoy/OhJoySexToy.kt
import {
  DateTimeFormatter,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type FilterList,
} from "../../../sdk/index.ts";

const MULTI_SPACE_REGEX = /\s{6,}/;

const dateFormat = DateTimeFormatter.ofPattern("M/d/yyyy", Locale.ENGLISH);

export default class OhJoySexToy extends KeiSource {
  // Browse

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/category/comic/page/${page}/`)).asJsoup();
    const mangas = document.select(".comicthumbwrap").map((element) => {
      const manga = SManga.create();
      const link = element.selectFirst(".comicarchiveframe > a")!;
      manga.url = urlWithoutDomain(link.absUrl("href"));
      manga.title = substringBefore(element.selectFirst(".comicthumbdate")!.text(), " by");
      manga.thumbnail_url = link.selectFirst("img")?.absUrl("src");
      return manga;
    });
    const hasNextPage = document.selectFirst(".pagenav-left a") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  // Latest

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const mangas = document.select("#MattsRecentComicsBar > ul > div").map((element) => {
      const manga = SManga.create();
      const link = element.selectFirst(".comicarchiveframe > a")!;
      manga.url = urlWithoutDomain(link.absUrl("href"));
      manga.title = substringBefore(element.selectFirst(".comicthumbdate")!.text(), " by");
      manga.thumbnail_url = link.selectFirst("img")?.absUrl("src");
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  // Search

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("s", query).build();
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select("h2.post-title").map((element) => {
      const manga = SManga.create();
      const link = element.selectFirst("a")!;
      manga.url = urlWithoutDomain(link.absUrl("href"));
      manga.title = substringBefore(link.text(), " by");
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    const ogTitle = document.selectFirst('meta[property="og:title"]')!.attr("content");

    details.title = substringBefore(ogTitle, " by");
    const author = substringAfter(ogTitle, "by ", "");
    details.author = author.length > 0 ? author : undefined;
    details.description = this.parseDescription(document);
    details.genre = document
      .select('meta[property="article:section"]:not(:first-of-type)')
      .eachAttr("content")
      .join(", ");
    details.status = SManga.COMPLETED;
    details.thumbnail_url = document.selectFirst('meta[property="og:image"]')?.absUrl("content");
    // ponytail: upstream sets update_strategy = ONLY_FETCH_ONCE; the SDK's SManga has no such field.
    details.url = urlWithoutDomain(document.selectFirst('meta[property="og:url"]')!.absUrl("content"));

    const chapter = SChapter.create();
    chapter.name = document.selectFirst("title")?.text() ?? "";
    chapter.scanlator = document.selectFirst(".post-author a")?.text();
    chapter.date_upload = dateFormat.tryParseDate(document.selectFirst(".post-date")?.text());
    chapter.url = urlWithoutDomain(document.location());

    return new SMangaUpdate(details, [chapter]);
  }

  private parseDescription(document: Document): string {
    let out = "";
    const desc = document.selectFirst('meta[property="og:description"]')?.attr("content")?.split(MULTI_SPACE_REGEX)[0];

    if (desc != null && desc.length > 0) {
      out += desc;
      out += "...\n\n";
    }

    const authorLinks = document.select(".entry div.ui-tabs div a");
    if (authorLinks.length > 0) {
      out += authorLinks.map((link) => `${link.text()}: ${link.absUrl("href")}`).join("\n");
      out += "\n\n";
    }

    out += "(Full description and credits in WebView)";
    return out;
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.comicpane img").map((img, index) => new Page(index, "", img.absUrl("src")));
  }
}
