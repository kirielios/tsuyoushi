// Port of keiyoushi/extensions-source src/all/cosplaytele/CosplayTele.kt
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, HttpUrl, Locale, MangasPage, Page, SChapter, SManga, firstInstanceOrNull, substringAfter, substringBefore, urlWithoutDomain, type Document, type Element, type Request, type Response } from "../../../sdk/index.ts";
import type { PopularPostDto } from "./dto.ts";
import { CATEGORIES, UriPartFilter } from "./filters.ts";

const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US);
const TAG_PATTERN = /^.*\/(tag|category)\/.*$/;

enum FilterState {
  Fetching,
  Fetched,
  Unfetched,
}

export default class CosplayTele extends HttpSource {
  override get supportsLatest(): boolean {
    return true;
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.append("Referer", `${this.baseUrl}/`);
    return headers;
  }

  private readonly popularPageLimit = 20;

  private categories = new Map<string, string>(CATEGORIES);

  private filtersState = FilterState.Unfetched;
  private filterAttempts = 0;

  // ========================= Popular =========================

  protected popularMangaRequest(page: number): Request {
    const url = HttpUrl.parse(`${this.baseUrl}/wp-json/wordpress-popular-posts/v1/popular-posts`)
      .newBuilder()
      .addQueryParameter("offset", String(page * this.popularPageLimit))
      .addQueryParameter("limit", String(this.popularPageLimit))
      .addQueryParameter("range", "last7days")
      .addQueryParameter("embed", "true")
      .addQueryParameter("_embed", "wp:featuredmedia")
      .addQueryParameter("_fields", "title,link,_embedded,_links.wp:featuredmedia")
      .build();
    return GET(url.toString(), this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const result = response.parseAs<PopularPostDto[]>();
    const mangas = result.map((item) => {
      const manga = SManga.create();
      manga.title = item.title.rendered;
      manga.url = urlWithoutDomain(item.link);
      manga.thumbnail_url = item._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
      return manga;
    });
    return new MangasPage(mangas, mangas.length >= this.popularPageLimit);
  }

  // ========================= Latest =========================

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/page/${page}/`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ========================= Search =========================

  /** 1.4 has no URL handling in getSearchManga: the deeplink check lives in fetchSearchManga below. */
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("http")) {
      const url = HttpUrl.parseOrNull(query);
      if (url != null && (url.host === "cosplaytele.com" || url.host === "www.cosplaytele.com")) {
        const pathSegments = url.pathSegments.filter((it) => it.length > 0);
        if (pathSegments.length === 0) return super.fetchSearchManga(page, query, filters);

        if (pathSegments[0] === "category" || pathSegments[0] === "tag") {
          const b = url.newBuilder();
          const pageIndex = url.pathSegments.indexOf("page");
          if (pageIndex !== -1) b.setPathSegment(pageIndex + 1, String(page));
          else {
            b.addPathSegment("page");
            b.addPathSegment(String(page));
          }
          const response = await this.executeSuccess(GET(b.build().toString(), this.headers));
          return this.searchMangaParse(response);
        } else {
          const response = await this.executeSuccess(GET(query, this.headers));
          const manga = this.mangaDetailsParse(response);
          manga.url = urlWithoutDomain(query);
          return new MangasPage([manga], false);
        }
      }
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const categoryFilter = firstInstanceOrNull(filters, UriPartFilter);

    if (categoryFilter != null && categoryFilter.state !== 0) {
      const url = HttpUrl.parse(this.baseUrl).newBuilder();
      url.addPathSegments(categoryFilter.toUriPart());
      url.addPathSegment("page");
      url.addPathSegment(String(page));
      if (query.length > 0) url.addQueryParameter("s", query);
      return GET(url.build().toString(), this.headers);
    }
    if (query.length > 0) {
      const url = HttpUrl.parse(`${this.baseUrl}/page/${page}/`).newBuilder().addQueryParameter("s", query).build();
      return GET(url.toString(), this.headers);
    }
    return this.latestUpdatesRequest(page);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("main div.box").map((element) => {
      const manga = SManga.create();
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      const linkEl = element.selectFirst("h5 a");
      if (linkEl == null) throw new Error("Title is mandatory");
      manga.title = linkEl.text();
      manga.url = urlWithoutDomain(linkEl.absUrl("href"));
      return manga;
    });
    const hasNextPage = document.selectFirst(".next.page-number") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ========================= Details =========================

  protected mangaDetailsParse(response: Response | Document): SManga {
    const document = (response as Response).asJsoup();
    const manga = SManga.create();
    const title = document.selectFirst(".entry-title")?.text();
    if (title == null) throw new Error("Title is mandatory");
    manga.title = title;
    manga.description = manga.title;
    manga.genre = this.getTags(document).join(", ");
    manga.status = SManga.COMPLETED;
    return manga;
  }

  private getTags(document: Element): string[] {
    return document
      .select("#main a")
      .filter((a) => TAG_PATTERN.test(a.absUrl("href")))
      .map((a) => {
        const tag = a.text();
        if (tag.length > 0) {
          const link = substringAfter(a.absUrl("href"), this.baseUrl).replace(/^\//, "");
          this.categories.set(tag, link);
        }
        return tag;
      });
  }

  // ========================= Chapters =========================

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const chapter = SChapter.create();
    chapter.name = "Gallery";
    chapter.url = HttpUrl.parse(response.url).encodedPath;
    const datetime = document.selectFirst("time.updated")?.attr("datetime");
    chapter.date_upload = datetime != null ? this.getDate(datetime) : 0;
    return [chapter];
  }

  private getDate(dateStr: string): number {
    return DATE_FORMAT.tryParseDate(substringBefore(dateStr, "T"));
  }

  // ========================= Pages =========================

  protected pageListParse(response: Response | Document): Page[] {
    return (response as Response)
      .asJsoup()
      .select(".gallery-item img")
      .map((element, i) => new Page(i, "", element.absUrl("src")));
  }

  protected imageUrlParse(_response: Response | Document): string {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Filters =========================

  override getFilterList(_data: unknown = null): FilterList {
    void this.fetchFilters();
    const filters: FilterList = [new Filter.Header("NOTE: Only one filter will be applied!"), new Filter.Separator(), new UriPartFilter("Category", [...this.categories.entries()])];

    if (this.filtersState === FilterState.Unfetched) filters.splice(1, 0, new Filter.Header("Use 'reset' to load all filters"));
    return filters;
  }

  private async fetchFilters(): Promise<void> {
    if (this.filtersState === FilterState.Unfetched && this.filterAttempts < 3) {
      this.filtersState = FilterState.Fetching;
      this.filterAttempts++;

      try {
        const document = (await this.client.execute(GET(`${this.baseUrl}/explore-categories/`, this.headers))).asJsoup();
        this.getTags(document);
        this.filtersState = FilterState.Fetched;
      } catch (e) {
        console.error(this.name, e);
        this.filtersState = FilterState.Unfetched;
      }
    }
  }
}
