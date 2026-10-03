// Port of keiyoushi/extensions-source src/all/kiutaku/Kiutaku.kt
import { ClientBuilder, FilterList, GET, HttpSource, MangasPage, Page, SChapter, SManga, toHttpUrl, urlWithoutDomain, type Element, type Request, type Response } from "../../../sdk/index.ts";

const PREFIX_SEARCH = "id:";

export default class Kiutaku extends HttpSource {
  private get baseUrlHost(): string {
    return toHttpUrl(this.baseUrl).host;
  }

  override get supportsLatest(): boolean {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2, 1000, (url) => url.hostname === this.baseUrlHost);
  }

  // ============================== Popular ===============================
  private getPage(page: number): number {
    return (page - 1) * 20;
  }

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/hot?start=${this.getPage(page)}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("div.blog > div.items-row").map((e) => this.mangaFromElement(e));
    const hasNextPage = document.selectFirst("nav > a.pagination-next:not([disabled])") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("a.item-link")!.absUrl("href"));
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    manga.title = element.selectFirst("h2")?.text() ?? "Cosplay";
    return manga;
  }

  // =============================== Latest ===============================
  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/?start=${this.getPage(page)}`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // =============================== Search ===============================
  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = toHttpUrl(query);
      if (url.host !== this.baseUrlHost) {
        throw new Error("Unsupported url");
      }
      const id = url.pathSegments[0];
      return this.fetchSearchManga(page, `${PREFIX_SEARCH}${id}`, filters);
    }
    if (query.startsWith(PREFIX_SEARCH)) {
      const id = query.slice(PREFIX_SEARCH.length);
      const response = await this.executeSuccess(GET(`${this.baseUrl}/${id}`, this.headers));
      return this.searchMangaByIdParse(response);
    }
    return super.fetchSearchManga(page, query, filters);
  }

  private searchMangaByIdParse(response: Response): MangasPage {
    const details = this.mangaDetailsParse(response);
    return new MangasPage([details], false);
  }

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("search", query).addQueryParameter("start", this.getPage(page).toString()).build();

    return GET(url, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // =========================== Manga Details ============================
  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    manga.title = document.selectFirst("div.article-header")?.text() ?? "Cosplay";
    manga.genre = document
      .selectFirst("div.article-tags")
      ?.select("a.tag > span")
      .eachText()
      .map((it) => it.replace(/^#+/, ""))
      .join(", ");
    return manga;
  }

  // ============================== Chapters ==============================
  protected chapterListParse(response: Response): SChapter[] {
    return response
      .asJsoup()
      .select("nav.pagination:first-of-type a")
      .map((e) => this.chapterFromElement(e))
      .reverse();
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.absUrl("href"));
    const text = element.text();
    chapter.name = `Page ${text}`;
    const n = Number(text);
    chapter.chapter_number = text.trim() === "" || Number.isNaN(n) ? 1 : n;
    return chapter;
  }

  // =============================== Pages ================================
  protected pageListParse(response: Response): Page[] {
    return response.asJsoup().select("div.article-fulltext img[src]").map((item, index) => new Page(index, "", item.absUrl("src")));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
