// Port of keiyoushi/extensions-source src/all/hentaicosplay/HentaiCosplay.kt
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, urlWithoutDomain, type Document, type Request, type Response } from "../../../sdk/index.ts";

const tagNumRegex = /(\(\d+\))/;
const hdRegex = /(\/p=\d+x?\d+?\/)/g;
const dateFormat = DateTimeFormatter.ofPattern("yyyy/MM/dd", Locale.ENGLISH);

abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected() {
    return this.options[this.state][1];
  }
}

class TagFilter extends SelectFilter {}

export default class HentaiCosplay extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  private readonly dateCache = new Map<string, string>();

  override fetchPopularManga(page: number): Promise<MangasPage> {
    this.fetchFilters();
    return super.fetchPopularManga(page);
  }

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/ranking/page/${page}/`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    return document.selectFirst("div.image-list-item") == null ? this.parseMobileListing(document) : this.parseDesktopListing(document);
  }

  private parseMobileListing(document: Document): MangasPage {
    const entries = document.select("#entry_list > li > a[href*=/image/]").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.absUrl("href"));
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src").replace("http://", "https://");
      manga.title = element.selectFirst("span:not(.posted)")!.text();
      const posted = element.selectFirst("span.posted")?.text();
      if (posted != null) this.dateCache.set(manga.url, posted);
      return manga;
    });
    const hasNextPage = document.selectFirst("a.paginator_page[rel=next]") != null;

    return new MangasPage(entries, hasNextPage);
  }

  private parseDesktopListing(document: Document): MangasPage {
    const entries = document.select("div.image-list-item:has(a[href*=/image/])").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src").replace("http://", "https://");
      manga.title = element.select(".image-list-item-title").text();
      const date = element.selectFirst(".image-list-item-regist-date")?.text();
      if (date != null) this.dateCache.set(manga.url, date);
      return manga;
    });
    const hasNextPage = document.selectFirst("div.wp-pagenavi > a[rel=next]") != null;

    return new MangasPage(entries, hasNextPage);
  }

  override fetchLatestUpdates(page: number): Promise<MangasPage> {
    this.fetchFilters();
    return super.fetchLatestUpdates(page);
  }

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/search/page/${page}/`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  override fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    this.fetchFilters();
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (query.length > 0) {
      const keyword = query.trim().replaceAll(" ", "+");
      return GET(`${this.baseUrl}/search/keyword/${keyword}/page/${page}/`, this.headers);
    }
    for (const filter of filters) {
      if (filter instanceof TagFilter && filter.selected.length > 0) return GET(`${this.baseUrl}${filter.selected}page/${page}/`, this.headers);
    }

    return GET(`${this.baseUrl}/search/page/${page}/`, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  private tagCache: [string, string][] = [];

  private fetchFilters() {
    if (this.tagCache.length === 0) this.fetchTags();
  }

  // upstream subscribes on Schedulers.io and ignores the result: fire and forget, errors swallowed (runCatching)
  private fetchTags() {
    void (async () => {
      try {
        const document = (await this.client.execute(GET(`${this.baseUrl}/ranking-tag/`, this.headers))).asJsoup();
        const cache: [string, string][] = [["", ""]];
        for (const it of document.select("#tags a")) cache.push([it.text().replace(tagNumRegex, "").trim(), it.attr("href")]);
        this.tagCache = cache;
      } catch {
        // runCatching
      }
    })();
  }

  override getFilterList(_data: unknown = null): FilterList {
    return this.tagCache.length === 0
      ? FilterList(new Filter.Header("Press reset to attempt to load filters"))
      : FilterList(new Filter.Header("Ignored with text search"), new Filter.Separator(), new TagFilter("Ranked Tags", this.tagCache));
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();

    const manga = SManga.create();
    manga.genre = document.select("#detail_tag a[href*=/tag/]").eachText().join(", ");
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    manga.status = SManga.COMPLETED;
    return manga;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const chapter = SChapter.create();
    chapter.name = "Gallery";
    chapter.url = manga.url.replace("/image/", "/story/");
    const cached = this.dateCache.get(manga.url);
    chapter.date_upload = cached != null ? dateFormat.tryParseDate(cached) : 0;
    return [chapter];
  }

  protected chapterListParse(_response: Response): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    return document.select("amp-img[src*=upload]:not(.related-thumbnail)").map((element, index) => new Page(index, "", element.attr("src")));
  }

  protected imageUrlParse(response: Response): string {
    return this.imageUrlParseDocument(response.asJsoup());
  }

  private imageUrlParseDocument(document: Document): string {
    return document.selectFirst("#display_image_detail img, #detail_list img")!.absUrl("src").replace("http://", "https://").replace(hdRegex, "/");
  }
}
