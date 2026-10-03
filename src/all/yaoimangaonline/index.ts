// Port of keiyoushi/extensions-source src/all/yaoimangaonline/YaoiMangaOnline.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
} from "../../../sdk/index.ts";
import { CategoryFilter, TagFilter } from "./filters.ts";

export default class YaoiMangaOnline extends KeiSource {
  get supportsLatest() {
    return false;
  }

  // =================== Popular ===================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangasPage((await this.client.get(`${this.baseUrl}/page/${page}/`)).asJsoup());
  }

  private parseMangasPage(document: Document): MangasPage {
    const mangas = document.select(".post:not(.sticky):not(.category-gay-movies):not(.category-yaoi-anime) > div > a").map((element) => {
      const manga = SManga.create();
      manga.title = element.attr("title");
      manga.url = urlWithoutDomain(element.absUrl("href"));
      manga.thumbnail_url = element.selectFirst("img")?.attr("src");
      return manga;
    });
    const hasNextPage = document.selectFirst(".herald-pagination > .next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // =================== Latest ===================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =================== Search ===================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    for (const it of filters) {
      if (it instanceof CategoryFilter) {
        if (it.state !== 0) url.addQueryParameter("cat", it.toString());
      } else if (it instanceof TagFilter) {
        if (it.state !== 0) url.addEncodedPathSegments(`tag/${it}`);
      }
    }
    url.addEncodedPathSegments(`page/${page}`);
    url.addQueryParameter("s", query);

    return this.parseMangasPage((await this.client.get(url.toString())).asJsoup());
  }

  // =================== Details ===================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document), this.chapterListParse(document));
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.title = substringBeforeLast(document.select("h1.entry-title").text(), "by").trim();
    manga.thumbnail_url = document.selectFirst(".herald-post-thumbnail img")?.attr("src");
    manga.description = document
      .select(".entry-content > p:not(:has(img)):not(:contains(You need to login))")
      .map((it) => it.wholeText())
      .join("\n\n");
    manga.genre = document
      .select(".meta-tags > a")
      .map((it) => it.text())
      .join(", ");
    manga.author = substringBefore(substringAfter(document.select(".entry-content > p:contains(Mangaka:)").text(), "Mangaka:"), "Language:").trim();
    return manga;
  }

  // =================== Chapters ===================

  private chapterListParse(document: Document): SChapter[] {
    const chapters = document.select(".mpp-toc a").map((element) => {
      const chapter = SChapter.create();
      chapter.name = element.ownText();
      chapter.url = urlWithoutDomain(element.absUrl("href") || element.baseUri);
      return chapter;
    });
    if (chapters.length === 0) {
      const chapter = SChapter.create();
      chapter.name = "Chapter";
      chapter.url = toHttpUrl(document.location()).encodedPath;
      chapters.push(chapter);
    }
    return chapters.reverse();
  }

  // =================== Pages ===================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.baseUrl + chapter.url))
      .asJsoup()
      .select(".entry-content img")
      .map((img, idx) => new Page(idx, "", img.attr("src")));
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new CategoryFilter(), new TagFilter());
  }
}
