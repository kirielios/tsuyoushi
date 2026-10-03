// Port of keiyoushi/extensions-source src/en/mangafox/MangaFox.kt
import {
  DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, urlWithoutDomain,
  type ClientBuilder, type Element, type Request,
} from "../../../sdk/index.ts";
import { FilterWithMethodAndText, GenreFilter, NameFilter, EntryTypeFilter, CompletedFilter, AuthorFilter, ArtistFilter, RatingFilter, YearFilter, TextSearchFilter, UriPartFilter, getGenreList } from "./filters.ts";

export default class MangaFox extends KeiSource {
  private get mobileUrl() {
    return this.baseUrl.replace("://", "://m.");
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .rateLimit(1, 1000)
      .addInterceptor((request) => this.addCookie(request, () => toHttpUrl(this.mobileUrl).host, [["readway", "2"]])) // Get all page URLs at once
      .addInterceptor((request) => this.addCookie(request, () => toHttpUrl(this.baseUrl).host, [["isAdult", "1"]])); // NOTE: subdomain must be ordered before the main domain
  }

  /** keiyoushi's addCookie(domain, cookies): (re)set in the jar for `domain` on every matching request, which then sends them. */
  private addCookie(request: Request, domain: () => string, cookies: [string, string][]): Request {
    const d = domain();
    const host = new URL(request.url).hostname;
    if (host === d || host.endsWith(`.${d}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${d}/`, `${key}=${value}; Domain=${d}; Path=/`);
    }
    return request;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM d,yyyy", Locale.ENGLISH);

  async getPopularManga(page: number): Promise<MangasPage> {
    const pageStr = page !== 1 ? `${page}.html` : "";
    const document = (await this.client.get(`${this.baseUrl}/directory/${pageStr}`)).asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private popularMangaSelector() {
    return "ul.manga-list-1-list li";
  }

  private popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst("a")!;
    manga.url = urlWithoutDomain(it.absUrl("href"));
    manga.title = it.attr("title");
    manga.thumbnail_url = it.selectFirst("img")?.attr("abs:src");
    return manga;
  }

  private popularMangaNextPageSelector() {
    return ".pager-list-left a.active + a + a";
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const pageStr = page !== 1 ? `${page}.html` : "";
    const document = (await this.client.get(`${this.baseUrl}/directory/${pageStr}?latest`)).asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genres: number[] = [];
    const genresEx: number[] = [];
    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addPathSegment("search");
    builder.addQueryParameter("title", query);
    for (const filter of filters) {
      if (filter instanceof UriPartFilter) builder.addQueryParameter(filter.query, filter.toUriPart());
      else if (filter instanceof GenreFilter) {
        for (const it of filter.state) {
          if (it.state === Filter.TriState.STATE_INCLUDE) genres.push(it.id);
          else if (it.state === Filter.TriState.STATE_EXCLUDE) genresEx.push(it.id);
        }
      } else if (filter instanceof FilterWithMethodAndText) {
        const method = filter.state[0] as UriPartFilter;
        const text = filter.state[1] as TextSearchFilter;
        builder.addQueryParameter(method.query, method.toUriPart());
        builder.addQueryParameter(text.query, text.state);
      } else if (filter instanceof RatingFilter) {
        for (const it of filter.state) builder.addQueryParameter(it.query, it.toUriPart());
      } else if (filter instanceof TextSearchFilter) builder.addQueryParameter(filter.query, filter.state);
    }
    builder.addQueryParameter("genres", genres.join(","));
    builder.addQueryParameter("nogenres", genresEx.join(","));
    builder.addQueryParameter("sort", "");
    builder.addQueryParameter("stype", "1");
    const document = (await this.client.get(builder.build().toString())).asJsoup();
    const mangas = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaSelector() {
    return "ul.manga-list-4-list li";
  }

  private searchMangaFromElement(element: Element): SManga {
    return this.popularMangaFromElement(element);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsFromDocument(document), this.chapterListFromDocument(document));
  }

  private mangaDetailsFromDocument(document: Element): SManga {
    const manga = SManga.create();
    const it = document.selectFirst(".detail-info-right")!;
    manga.author = it
      .select(".detail-info-right-say a")
      .map((a) => a.text())
      .join(", ");
    manga.genre = it
      .select(".detail-info-right-tag-list a")
      .map((a) => a.text())
      .join(", ");
    manga.description = it.selectFirst("p.fullcontent")?.text();
    manga.status = this.parseStatus(it.selectFirst(".detail-info-right-title-tip")?.text());
    manga.thumbnail_url = document.selectFirst(".detail-info-cover-img")?.attr("abs:src");
    return manga;
  }

  private chapterListFromDocument(document: Element): SChapter[] {
    return document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));
  }

  private chapterListSelector() {
    return "ul.detail-main-list li a";
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.absUrl("href"));
    chapter.name = element.selectFirst(".detail-main-list-main p")!.text();
    const last = element.select(".detail-main-list-main p").last()?.text();
    chapter.date_upload = last != null ? this.parseChapterDate(last) : 0;
    return chapter;
  }

  private parseChapterDate(date: string): number {
    if (date.includes("Today") || date.includes(" ago")) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (date.includes("Yesterday")) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    return this.dateFormat.tryParseDate(date);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const mobilePath = chapter.url.replace("/manga/", "/roll_manga/");

    const headers = this.headersBuilder();
    headers.set("Referer", `${this.mobileUrl}/`);

    const document = (await this.client.get(`${this.mobileUrl}${mobilePath}`, headers)).asJsoup();
    return document.select("#viewer img").map((it, idx) => new Page(idx, "", it.attr("abs:data-original")));
  }

  private parseStatus(status: string | null | undefined): number {
    if (status == null) return SManga.UNKNOWN;
    if (status.includes("Ongoing")) return SManga.ONGOING;
    if (status.includes("Completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new NameFilter(), new EntryTypeFilter(), new CompletedFilter(), new AuthorFilter(), new ArtistFilter(), new RatingFilter(), new YearFilter(), new GenreFilter(getGenreList()));
  }
}
