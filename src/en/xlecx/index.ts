// Port of keiyoushi/extensions-source src/en/xlecx/XlecX.kt (+ XlecXDto.kt)
import {
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseAs,
  parseHtml,
  tryParseInstant,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type Response,
} from "../../../sdk/index.ts";

// ---- XlecXDto.kt
interface BookDto {
  datePublished: string;
  dateModified?: string | null;
  image: string[];
}
interface JsonLdDto {
  "@graph": BookDto[];
}

const whitespaceRegex = /\s+/g;
const postRegex = /^\/\d+-.*?\.html$/;

export default class XlecX extends KeiSource {
  // TODO: filters
  // TODO: description - text, other `subInfoLinks`s, JSON-LD,

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(async (chain) => {
      const response = await chain.proceed(chain.request());
      if (response.code === 403 && response.header("Content-Type")?.includes("text/html")) {
        const document = parseHtml(this.host.load, response.text(), "");
        const message = document.selectFirst(".message-info__content");
        if (message != null) {
          const host = new URL(chain.request().url).host;
          const messageCleaned = message.text().replace(whitespaceRegex, " ");
          if (messageCleaned.length > 200) throw new Error(`Open WebView to see message from ${host}`);
          throw new Error(`${host}: ${messageCleaned}`);
        }
      }
      return response;
    });
  }

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    const pageStr = page > 1 ? `page/${page}/` : "";
    return this.parseMangasPage(await this.client.get(`${this.baseUrl}/f/sort=news_read/order=desc/${pageStr}`));
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const pageStr = page > 1 ? `page/${page}/` : "";
    return this.parseMangasPage(await this.client.get(`${this.baseUrl}/f/sort=date/order=desc/${pageStr}`));
  }

  // Search
  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = HttpUrl.parse(`${this.baseUrl}/index.php`)
      .newBuilder()
      .addQueryParameter("do", "search")
      .addQueryParameter("subaction", "search")
      .addQueryParameter("search_start", String(page))
      .addQueryParameter("full_search", "0")
      .addQueryParameter("story", query)
      .build();
    return this.parseMangasPage(await this.client.get(url.toString()));
  }

  private parseMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("#dle-content > a.thumb").map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.selectFirst("#pagination > .pagination__pages > a:contains(Next)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.absUrl("href"));
    const img = element.selectFirst("img")!;
    manga.title = img.attr("alt");
    manga.thumbnail_url = img.absUrl("src");
    return manga;
  }

  protected override async getMangaByUrl(u: URL): Promise<SManga | null> {
    const encodedPath = HttpUrl.parse(u.toString()).encodedPath;
    if (!postRegex.test(encodedPath)) return null;

    const manga = SManga.create();
    manga.url = encodedPath;

    const updated = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    updated.initialized = true;
    updated.url = encodedPath;
    return updated;
  }

  // Updates
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const details = SManga.create();
    details.url = manga.url;
    details.title = document.selectFirst("h1")!.text();
    details.artist = this.subInfoLinks(document, "Artist:");
    details.author = this.subInfoLinks(document, "Group:");
    details.genre = this.subInfoLinks(document, "Tags:");
    // TODO: document.subInfoLinks("Parody:")
    details.thumbnail_url = document.selectFirst("meta[property=og:image]")?.absUrl("content");

    const script = document.selectFirst("script[type=application/ld+json]")?.data();
    if (script === undefined) throw new Error("JSON-LD data not found");
    const dto = parseAs<JsonLdDto>(script);
    const book = dto["@graph"][0];
    if (!book) return new SMangaUpdate(details, []);

    const chapter = SChapter.create();
    chapter.url = details.url;
    chapter.name = "Chapter";
    chapter.date_upload = tryParseInstant(book.dateModified ?? book.datePublished);
    chapter.chapter_number = 1;
    return new SMangaUpdate(details, [chapter]);
  }

  private subInfoLinks(element: Element, label: string): string {
    return element
      .select(`.page__subinfo-item > div:not([class]):contains(${label}) ~ a`)
      .map((it) => it.text())
      .join(", ");
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();

    // 'Full size' tab
    const full = this.tabPages(document, "#content-2 > .imagegall23 > img");
    if (full.length > 0) return full;

    // Plain
    const plain = document.select(".page__text a:has(img)").map((element, index) => new Page(index, "", element.absUrl("href")));
    if (plain.length > 0) return plain;

    // 'Thumb' tab
    const thumb = this.tabPages(document, "#content-1 > .imagegall23 > img");
    if (thumb.length > 0) return thumb;

    // JSON-LD, may contain junk pages
    const script = document.selectFirst("script[type=application/ld+json]")?.data();
    if (script === undefined) throw new Error("JSON-LD data not found");
    const dto = parseAs<JsonLdDto>(script);
    const book = dto["@graph"][0];
    if (!book) return [];

    return book.image.map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  private tabPages(document: Document, selector: string): Page[] {
    return document.select(selector).map((element, index) => new Page(index, "", element.absUrl("data-src") || element.absUrl("src")));
  }
}
