// Port of keiyoushi/extensions-source src/all/xiutaku/Xiutaku.kt
import {
  DateTimeFormatter,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneOffset,
  substringBefore,
  toHttpUrl,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList,
} from "../../../sdk/index.ts";
import { UserAgentType, setRandomUserAgent } from "../../../libs/randomua/index.ts";

const DATE_FORMAT = DateTimeFormatter.ofPattern("HH:mm d-M-yyyy", Locale.US);

const removePrefix = (s: string, p: string) => (s.startsWith(p) ? s.substring(p.length) : s);

export default class Xiutaku extends KeiSource {
  private get baseUrlHost() {
    return toHttpUrl(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(10, 1000, (url) => url.host === this.baseUrlHost);
  }

  protected override configureHeaders(headers: Headers): Headers {
    return setRandomUserAgent(headers, this.preferences, this.client, UserAgentType.MOBILE);
  }

  // ========================= Popular =========================
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangasPage((await this.client.get(`${this.baseUrl}/hot?start=${20 * (page - 1)}`)).asJsoup());
  }

  private parseMangasPage(document: Document): MangasPage {
    const mangas = document.select(".blog > div").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst(".pagination-next:not([disabled])") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ========================= Latest =========================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangasPage((await this.client.get(`${this.baseUrl}/?start=${20 * (page - 1)}`)).asJsoup());
  }

  // ========================= Search =========================
  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("search", query).addQueryParameter("start", String(20 * (page - 1))).build();

    return this.parseMangasPage((await this.client.get(url.toString())).asJsoup());
  }

  protected override async getMangasByUrl(url: URL, _page: number): Promise<MangasPage> {
    if (url.hostname !== "xiutaku.com") return new MangasPage([], false);

    const document = (await this.client.get(url)).asJsoup();

    if (document.selectFirst(".article-header") != null) {
      const manga = this.mangaDetailsParse(document);
      manga.url = new URL(document.location()).pathname;
      return new MangasPage([manga], false);
    }

    return this.parseMangasPage(document);
  }

  // ========================= Details =========================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document), this.chapterListParse(document));
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const title = document.selectFirst(".article-header")?.text();
    if (title == null) throw new Error("Title is mandatory");
    manga.title = title;
    manga.description = document.selectFirst(".article-info:not(:has(small))")?.text();
    manga.genre = document
      .selectFirst(".article-tags")
      ?.select(".tags > .tag")
      ?.map((it) => removePrefix(it.text(), "#"))
      .join(", ");
    manga.status = SManga.COMPLETED;
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }

  // ========================= Chapters =========================
  private chapterListParse(document: Document): SChapter[] {
    const dateUploadStr = document.selectFirst(".article-info > small")?.text();
    const dateUpload = DATE_FORMAT.tryParseDateTime(dateUploadStr == null ? null : removePrefix(dateUploadStr, "🕒"), ZoneOffset.UTC);
    const maxPageText = document.selectFirst(".pagination-list > span:last-child > a")?.text();
    const maxPage = maxPageText != null && /^[+-]?\d+$/.test(maxPageText) ? Number.parseInt(maxPageText, 10) : 1;
    const baseUrlString = substringBefore(document.location(), "?");

    const chapters: SChapter[] = [];
    for (let page = maxPage; page >= 1; page--) {
      const chapter = SChapter.create();
      chapter.url = removePrefix(`${baseUrlString}?page=${page}`, this.baseUrl);
      chapter.name = `Page ${page}`;
      chapter.date_upload = dateUpload;
      chapters.push(chapter);
    }
    return chapters;
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }

  // ========================= Pages =========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    return document.select(".article-fulltext img").map((imgEl, i) => new Page(i, "", imgEl.absUrl("src")));
  }

  // ========================= Utilities =========================
  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const link = element.selectFirst(".item-content .item-link");
    if (link == null) throw new Error("Link is mandatory");
    manga.title = link.text();
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    manga.url = removePrefix(link.absUrl("href"), this.baseUrl);
    return manga;
  }
}
