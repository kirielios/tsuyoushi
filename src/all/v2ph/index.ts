// Port of keiyoushi/extensions-source src/all/v2ph/V2ph.kt (+ Filters.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  ZoneOffset,
  firstInstanceOrNull,
  isBlank,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// --- Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

class CategoryFilter extends UriPartFilter {
  constructor() {
    super("Category", [
      ["None", ""],
      ["Sexy", "sexy-girls"],
      ["Goddess", "nvshen"],
      ["Short hair", "short-hair"],
      ["Pure", "pure"],
      ["Lingerie", "underwear-beauty"],
      ["Magazine", "magazine"],
      ["Sexy Models", "glamour-models"],
      ["Legs", "beautiful-legs"],
      ["Japanese", "japanese-girls"],
      ["Quality", "best-quality"],
      ["Outside", "outside"],
      ["Bikini", "bikini-girls"],
    ]);
  }
}

class CountryFilter extends UriPartFilter {
  constructor() {
    super("Country", [
      ["None", ""],
      ["China", "china"],
      ["Japan", "japan"],
      ["Korea", "south-korea"],
      ["Taiwan", "taiwan"],
      ["Thailand", "thailand"],
      ["Europe and America", "europe"],
    ]);
  }
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT).withZone(ZoneOffset.UTC);

export default class V2ph extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2);
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
    headers.append("Accept-Language", "en-US,en;q=0.9");
    headers.append("Referer", `${this.baseUrl}/`);
    return headers;
  }

  // ============================== Popular ==============================
  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/category/best-quality?page=${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document
      .select(".albums-list .card")
      .map((e) => this.mangaFromElement(e))
      .filter((it) => it != null);
    const hasNextPage = document.selectFirst("ul.pagination li.page-item a:contains(Next)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================
  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/?page=${page}`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document
      .select("#latest-albums-title ~ .albums-list .card")
      .map((e) => this.mangaFromElement(e))
      .filter((it) => it != null);
    const hasNextPage = document.selectFirst("ul.pagination li.page-item a:contains(Next)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Search ===============================
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (!isBlank(query)) {
      const url = toHttpUrl(`${this.baseUrl}/search/`).newBuilder().addQueryParameter("q", query).addQueryParameter("page", String(page)).build();
      return GET(url.toString(), this.headers);
    }

    const category = firstInstanceOrNull(filters, CategoryFilter)?.toUriPart() ?? "";
    const country = firstInstanceOrNull(filters, CountryFilter)?.toUriPart() ?? "";

    let url: string;
    if (category.length > 0) url = `${this.baseUrl}/category/${category}?page=${page}`;
    else if (country.length > 0) url = `${this.baseUrl}/country/${country}?page=${page}`;
    else url = `${this.baseUrl}/category/best-quality?page=${page}`;

    return GET(url, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Details ==============================
  protected mangaDetailsParse(response: Response): SManga {
    this.checkPaywall(response);
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst("h1")!.text();
    manga.author = document.selectFirst("dl dt:contains(Vendor) + dd a")?.text();
    manga.artist = document.selectFirst("dl dt:contains(Model) + dd a")?.text();
    manga.genre = document
      .select("dl dt:contains(Tags) + dd a")
      .map((it) => it.text())
      .join(", ");

    const photosCount = document.selectFirst("dl dt:contains(Photos) + dd")?.text();
    const intro = document.selectFirst(".album-intro")?.text();

    let description = "";
    if (photosCount != null) description += `Photos: ${photosCount}\n\n`;
    if (intro != null) description += intro;
    manga.description = description.trim();

    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    return manga;
  }

  // ============================= Chapters ==============================
  protected chapterListParse(response: Response): SChapter[] {
    this.checkPaywall(response);
    const document = response.asJsoup();
    const dateStr = document.selectFirst("dl dt:contains(Date) + dd")?.text();

    const chapter = SChapter.create();
    chapter.name = "Gallery";
    chapter.url = new URL(response.url).pathname;
    chapter.date_upload = dateFormat.tryParseDate(dateStr);
    return [chapter];
  }

  // =============================== Pages ===============================
  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.executeSuccess(await this.pageListRequest(chapter));
    this.checkPaywall(response);
    const document = response.asJsoup();

    const photosCount = Number.parseInt(document.selectFirst("dl dt:contains(Photos) + dd")?.text() ?? "", 10) || 0;
    const isGuest = document.selectFirst("a[href*='/login'], a[href*='/register']") != null;

    if (isGuest && photosCount > 20) throw new Error("V2PH Session expired. Please log in via WebView to view more than 20 images.");

    const maxPage = Math.floor((photosCount + 9) / 10);

    const pages = document.select(".photos-list img").map((img, index) => new Page(index, "", img.attr("abs:src")));

    for (let i = 2; i <= maxPage; i++) {
      const pageUrl = `${this.baseUrl}${chapter.url}${chapter.url.includes("?") ? "&" : "?"}page=${i}`;
      const pageResponse = await this.client.execute(GET(pageUrl, this.headers));
      if (!pageResponse.isSuccessful) continue;
      const offset = pages.length;
      pageResponse
        .asJsoup()
        .select(".photos-list img")
        .forEach((img, index) => pages.push(new Page(offset + index, "", img.attr("abs:src"))));
    }

    return pages;
  }

  protected pageListParse(_response: Response): Page[] {
    throw new Error("UnsupportedOperationException");
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Filters ==============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Note: Text Search ignores the filters below."),
      new Filter.Header("If both Category and Country are set, Category takes precedence."),
      new Filter.Separator(),
      new CategoryFilter(),
      new CountryFilter(),
    );
  }

  // ============================= Utilities =============================
  private checkPaywall(response: Response) {
    if (new URL(response.url).pathname.startsWith("/user/")) throw new Error("This album requires a V2PH premium account. Open in WebView to upgrade.");
  }

  private mangaFromElement(element: Element): SManga | null {
    const link = element.selectFirst("a.media-cover");
    if (!link) return null;
    const titleEl = element.selectFirst(".card-body h6 a");
    if (!titleEl) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(link.absUrl("href"));
    manga.title = titleEl.text();
    manga.thumbnail_url = element.selectFirst(".card-cover img")?.attr("abs:src");
    return manga;
  }
}
