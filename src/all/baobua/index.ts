// Port of keiyoushi/extensions-source src/all/baobua/BaoBua.kt (+ Filters.kt)
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, firstInstance, isBlank, toHttpUrl, toHttpUrlOrNull, type ClientBuilder, type Document, type Request, type Response } from "../../../sdk/index.ts";

// --- Filters.kt
class SourceCategory {
  constructor(
    readonly name: string,
    readonly cat: string,
  ) {}
  toString() {
    return this.name;
  }

  buildUrl(baseUrl: string, page: number): string {
    return toHttpUrl(baseUrl).newBuilder().addPathSegment("category").addPathSegment(this.cat).addQueryParameter("page", String(page)).build().toString();
  }
}

class SourceCategorySelector extends Filter.Select<SourceCategory> {
  constructor(name: string, categories: SourceCategory[]) {
    super(name, categories);
  }

  get selectedCategory(): SourceCategory | null {
    return this.state > 0 ? this.values[this.state] : null;
  }

  static create(): SourceCategorySelector {
    const options = [
      new SourceCategory("", ""),
      new SourceCategory("Ao-yem", "Ao-yem"),
      new SourceCategory("Asia", "Asia"),
      new SourceCategory("Beauty", "beauty"),
      new SourceCategory("Bikini", "Bikini"),
      new SourceCategory("China", "China"),
      new SourceCategory("Cosplay", "Cosplay"),
      new SourceCategory("Japan", "Japan"),
      new SourceCategory("Nude", "Nude"),
      new SourceCategory("Sexy", "Sexy"),
      new SourceCategory("Top", "Top"),
      new SourceCategory("Tattoo", "tattoo"),
      new SourceCategory("Vietnam", "Vietnam"),
    ];

    return new SourceCategorySelector("Category", options);
  }
}

const WP_COM_REGEX = /^https:\/\/i\d+\.wp\.com\//;
const WP_COM_REPLACE_REGEX = /https:\/\/i\d+\.wp\.com\//g;
const POST_DATE_FORMAT = DateTimeFormatter.ofPattern("EEE MMM dd yyyy", Locale.US);

export default class BaoBua extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  // 1.4 has no getMangaByUrl: a pasted URL is handled by searchMangaRequest itself, not by KeiSource's deep-link routing.
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.getSearchMangaList(page, query, filters);
  }

  // ========================= Popular =========================
  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/?page=${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    return this.parseMangasPage(document);
  }

  // ========================= Latest  =========================
  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Search  =========================
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (!isBlank(query)) {
      const url = toHttpUrlOrNull(query);
      if (url != null && url.host === toHttpUrlOrNull(this.baseUrl)?.host) return GET(query, this.headers);
      throw new Error("Full-text search is not supported");
    }

    const filter = firstInstance(filters, SourceCategorySelector);
    const category = filter.selectedCategory;
    return category != null ? GET(category.buildUrl(this.baseUrl, page), this.headers) : this.popularMangaRequest(page);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    if (document.selectFirst(".product-item") == null && document.selectFirst(".article-body") != null) {
      const manga = this.mangaDetailsParseDocument(document);
      manga.url = new URL(response.url).pathname;
      const title = (document.selectFirst(".product-title") ?? document.selectFirst("h1") ?? document.selectFirst(".article-title") ?? document.selectFirst(".post-title"))?.text().trim();
      if (title == null) throw new Error("Title is mandatory");
      manga.title = title;
      const img = document.selectFirst("img.product-imgreal") ?? document.selectFirst(".article-body img");
      manga.thumbnail_url = img ? this.normalizeImageUrl(img.absUrl("src")) : undefined;
      // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
      return new MangasPage([manga], false);
    }

    return this.parseMangasPage(document);
  }

  // ========================= Details =========================
  protected mangaDetailsParse(response: Response): SManga {
    return this.mangaDetailsParseDocument(response.asJsoup());
  }

  private mangaDetailsParseDocument(document: Document): SManga {
    const manga = SManga.create();
    manga.genre = document
      .select(".article-tags a")
      .map((it) => it.text())
      .join(", ");
    manga.status = SManga.COMPLETED;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  // ========================= Chapters=========================
  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const chapter = SChapter.create();
    chapter.chapter_number = 0;
    const absUrl = document.selectFirst("link[rel=canonical]")?.absUrl("href") ?? response.url;
    chapter.url = toHttpUrlOrNull(absUrl)?.encodedPath ?? absUrl;
    chapter.date_upload = POST_DATE_FORMAT.tryParseDate(document.selectFirst(".article-date-comment .date")?.text());
    chapter.name = "Gallery";
    return [chapter];
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  // ========================= Pages   =========================
  protected async pageListParse(response: Response): Promise<Page[]> {
    return this.recursivePageListParse(response.asJsoup());
  }

  private async recursivePageListParse(document: Document): Promise<Page[]> {
    const pages = document.select(".article-body img").map((element, index) => new Page(index, "", this.normalizeImageUrl(element.absUrl("src"))));

    const nextPageUrl = document.selectFirst("a.page-numbers:contains(Next)")?.absUrl("href");
    if (nextPageUrl == null) return pages;

    const nextDoc = (await this.client.execute(GET(nextPageUrl, this.headers))).asJsoup();

    const nextPages = await this.recursivePageListParse(nextDoc);
    const offset = pages.length;
    const redirectedNextPages = nextPages.map((it) => new Page(it.index + offset, it.url, it.imageUrl));
    return [...pages, ...redirectedNextPages];
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Filters =========================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(SourceCategorySelector.create());
  }

  // ========================= Helpers =========================
  private parseMangasPage(document: Document): MangasPage {
    const mangas: SManga[] = [];
    for (const element of document.select(".product-item")) {
      const manga = SManga.create();
      const absUrl = element.selectFirst("a")?.absUrl("href");
      if (absUrl == null) continue;
      manga.url = toHttpUrlOrNull(absUrl)?.encodedPath ?? absUrl;
      const title = element.selectFirst(".product-title")?.text();
      if (title == null) continue;
      manga.title = title;
      const img = element.selectFirst("img.product-imgreal")?.absUrl("src");
      manga.thumbnail_url = img != null ? this.normalizeImageUrl(img) : undefined;
      // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
      mangas.push(manga);
    }

    const hasNextPage = document.selectFirst(".pagination-custom .nextPage") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  private normalizeImageUrl(url: string): string {
    return WP_COM_REGEX.test(url) ? url.replace(WP_COM_REPLACE_REGEX, "https://").replace("?w=640", "") : url;
  }
}
