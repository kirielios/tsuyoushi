// Port of keiyoushi/extensions-source src/en/kaliscancom/KaliScanCom.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneOffset,
  ago,
  parseHtml,
  substringAfter,
  substringBefore,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
} from "../../../sdk/index.ts";

const MANGA_ID_REGEX = /\/manga\/(\d+)-/;
const CHAPTER_ID_REGEX = /chapterId\s*=\s*(\d+)/;
const NUMBER_REGEX = /\d+/;

interface GenreData {
  key: string;
  genres: [string, string][];
}

class GenreFilter extends Filter.Group<Genre> {
  constructor(
    readonly key: string,
    genres: Genre[],
  ) {
    super("Genres", genres);
  }
}
class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(displayName, vals.map((it) => it[0]), state);
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", "all"],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}

class OrderFilter extends UriPartFilter {
  constructor(state = 0) {
    super(
      "Order By",
      [
        ["Views", "views"],
        ["Updated", "updated_at"],
        ["Created", "created_at"],
        ["Name A-Z", "name"],
        // ["Number of Chapters", "total_chapters"],
        ["Rating", "rating"],
      ],
      state,
    );
  }
}

const trimChars = (s: string, chars: string) => {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

export default class KaliScanCom extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

  // Intercepts chapter image requests that have a fallback URL encoded in the fragment.
  // If the primary CDN returns a failure, we retry with the fallback URL.
  // The fallback is encoded as a fragment so the parser doesn't need to pre-decide
  // which URL to use — the network layer handles it transparently.
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return (
      builder
        .addChainInterceptor(async (chain) => {
          const request = chain.request();
          const fragment = new URL(request.url).hash.slice(1) || null;

          if (fragment !== null && (fragment.startsWith("https://") || fragment.startsWith("http://"))) {
            const cleanUrl = new URL(request.url);
            cleanUrl.hash = "";
            const response = await chain.proceed({ ...request, url: cleanUrl.href });
            if (!response.isSuccessful) {
              return chain.proceed({ ...request, url: fragment });
            }
            return response;
          }
          return chain.proceed(request);
        })
        .addChainInterceptor(async (chain) => {
          const request = chain.request();
          const url = new URL(request.url);
          const response = await chain.proceed(request);
          if (!response.isSuccessful && url.hash.slice(1) === "image-request") {
            const newUrl = new URL(url.href);
            newUrl.hostname = "sb.mbcdn.xyz";
            newUrl.pathname = url.pathname.replace("/res/", "/");
            newUrl.hash = "";
            return chain.proceed({ ...request, url: newUrl.href });
          }
          return response;
        })
        // chapter list API is heavily rate limited
        .rateLimit(1, 12_000, (url) => url.pathname.startsWith("/service/backend/chaplist/"))
        .rateLimit(1, 1000)
    );
  }

  private parse(html: string, baseUri: string): Document {
    return parseHtml(this.host.load, html, baseUri);
  }

  // ============================== Popular ==============================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new OrderFilter(0)));
  }

  // ============================== Latest ===============================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new OrderFilter(1)));
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("q", query).addQueryParameter("page", String(page));

    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        filter.state.filter((it) => it.state).forEach((genre) => url.addQueryParameter(filter.key, genre.id));
      } else if (filter instanceof StatusFilter) {
        url.addQueryParameter("status", filter.toUriPart());
      } else if (filter instanceof OrderFilter) {
        url.addQueryParameter("sort", filter.toUriPart());
      }
    }

    const document = (await this.client.get(url.build().toString())).asJsoup();
    const mangas = document.select(this.searchMangaSelector()).map((element) => this.searchMangaFromElement(element));
    const hasNextPage = document.selectFirst(this.searchMangaNextPageSelector()) != null;

    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaSelector(): string {
    return ".book-detailed-item";
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
    manga.title = element.selectFirst("a")!.attr("title");
    const summary = element.selectFirst(".summary")?.text();
    if (summary != null) manga.description = summary;
    const genre = element
      .select(".genres > *")
      .map((it) => it.text())
      .join(", ");
    if (genre !== "") manga.genre = genre;
    manga.thumbnail_url = element.selectFirst("img")!.attr("abs:data-src") + "#image-request";
    return manga;
  }

  /*
   * Only some sites use the next/previous buttons, so instead we check for the next link
   * after the active one. We use the :not() selector to exclude the optional next button
   */
  private searchMangaNextPageSelector(): string {
    return ".paginator > a.active + a:not([rel=next])";
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(this.getMangaUrl(manga)).then((r) => this.mangaDetailsParse(r.asJsoup())) : manga,
      fetchChapters ? this.fetchChapterList(manga) : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst(".detail h1")!.text();
    manga.author = document
      .select(".detail .meta > p > strong:contains(Authors) ~ a")
      .map((it) => trimChars(it.text(), ", "))
      .join(", ");
    manga.genre = document
      .select(".detail .meta > p > strong:contains(Genres) ~ a")
      .map((it) => trimChars(it.text(), ", "))
      .join(", ");
    manga.thumbnail_url = document.selectFirst("#cover img")!.attr("abs:data-src") + "#image-request";

    const h2 = document.selectFirst(".detail h2")?.text();
    const altNames = h2 != null ? h2.split(/[,;]/).map((it) => it.trim()).filter((it) => it !== manga.title && it !== "") : [];

    let description = document.select(".summary .content, .summary .content ~ p").text();
    if (altNames.length > 0) {
      description += "\n\nAlt name(s): ";
      description += altNames.join(", ");
    }
    manga.description = description;

    const statusText = document.selectFirst(".detail .meta > p > strong:contains(Status) ~ a")!.text();
    switch (statusText.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "on-hold":
        manga.status = SManga.ON_HIATUS;
        break;
      case "canceled":
        manga.status = SManga.CANCELLED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  // ============================= Chapters ==============================

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    return this.chapterListParse((await this.client.get(this.chapterListUrl(manga))).asJsoup());
  }

  private chapterListUrl(manga: SManga): string {
    const id = MANGA_ID_REGEX.exec(manga.url)?.[1];
    if (id === undefined) return this.baseUrl + manga.url;
    return toHttpUrl(`${this.baseUrl}/service/backend/chaplist/`).newBuilder().addQueryParameter("manga_id", id).addQueryParameter("manga_name", manga.title).build().toString();
  }

  private async chapterListParse(document: Document): Promise<SChapter[]> {
    const requestUrl = document.location();
    const distinctByUrl = (list: SChapter[]) => {
      const seen = new Set<string>();
      return list.filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)));
    };

    if (requestUrl.includes("/service/backend/chaplist/")) {
      return distinctByUrl(document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it)));
    }

    let chaptersList = document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));

    const fetchApi = document.selectFirst("div#show-more-chapters > span")?.attr("onclick") === "getChapters()";

    if (fetchApi) {
      const script = document.selectFirst("script:containsData(bookId)");
      if (script == null) throw new Error("Cannot find script");
      const bookId = substringBefore(substringAfter(script.data(), "bookId = "), ";");

      const apiChapters = (await this.client.get(this.buildChapterUrl(bookId))).asJsoup()
        .select(this.chapterListSelector())
        .map((element) => this.chapterFromElement(element));

      const idx = chaptersList.findIndex((chapter) => apiChapters.some((it) => it.url === chapter.url));
      const cutIndex = idx !== -1 ? idx : chaptersList.length;

      chaptersList = [...chaptersList.slice(0, cutIndex), ...apiChapters];
    }

    // distinctBy acts as a foolproof safeguard against any malformed URLs that fail to merge properly
    return distinctByUrl(chaptersList);
  }

  private chapterListSelector(): string {
    return "#chapter-list > li";
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    // Not using setUrlWithoutDomain() to support external chapters
    const rawUrl = element.selectFirst("a")!.absUrl("href");

    // Strip the baseUrl and heavily normalize double slashes to prevent duplicate mismatching
    chapter.url = rawUrl.startsWith(this.baseUrl) ? substringAfter(rawUrl, this.baseUrl).replace(/\/{2,}/g, "/") : rawUrl;

    chapter.name = element.selectFirst(".chapter-title")!.text();
    chapter.date_upload = this.parseChapterDate(element.selectFirst(".chapter-update")?.text());
    return chapter;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    // External chapter
    const chapterUrl = toHttpUrlOrNull(chapter.url) != null ? chapter.url : this.baseUrl + chapter.url;
    const document = (await this.client.get(chapterUrl)).asJsoup();
    const mangaId = MANGA_ID_REGEX.exec(document.location())?.[1];
    const chapterId = CHAPTER_ID_REGEX.exec(document.html())?.[1];

    const html = mangaId != null && chapterId != null ? (await this.client.get(`${this.baseUrl}/service/backend/chapterServer/?server_id=1&chapter_id=${chapterId}`)).text() : document.html();
    const realDocument = this.parse(html, document.location());

    if (!html.includes('var mainServer = "')) {
      const chapterImagesFromHtml = realDocument.select("#chapter-images img, .chapter-image[data-src]");

      // 17/03/2023: Certain hosts only embed two pages in their "#chapter-images" and leave
      // the rest to be lazily(?) loaded by javascript. Let's extract `chapImages` and compare
      // the count against our select query. If both counts are the same, extract the original
      // images directly from the <img> tags otherwise pick the higher count. (heuristic)
      // First things first, let's verify `chapImages` actually exists.
      if (html.includes("var chapImages = '")) {
        const chapterImagesFromJs = substringBefore(substringAfter(html, "var chapImages = '"), "'").split(",");

        // Make sure chapter images we've got from javascript all have a host, otherwise
        // we've got no choice but to fallback to chapter images from HTML.
        // TODO: This might need to be solved one day ^
        if (chapterImagesFromJs.every((e) => e.startsWith("http://") || e.startsWith("https://"))) {
          // Great, we can use these.
          if (chapterImagesFromHtml.length < chapterImagesFromJs.length) {
            // Seems like we've hit such a host, let's use the images we've obtained
            // from the JavaScript string.
            return chapterImagesFromJs.map((path, index) => new Page(index, "", path));
          }
        }
      }

      // No fancy CDN, all images are available directly in <img> tags (hopefully)
      return chapterImagesFromHtml.map((element, index) => new Page(index, "", this.resolveImageUrl(element)));
    }

    // While the site may support multiple CDN hosts, we have opted to ignore those
    const mainServer = substringBefore(substringAfter(html, 'var mainServer = "'), '"');
    const schemePrefix = mainServer.startsWith("//") ? "https:" : "";

    const chapImages = substringBefore(substringAfter(html, "var chapImages = '"), "'").split(",");

    return chapImages.map((path, index) => new Page(index, "", `${schemePrefix}${mainServer}${path}`));
  }

  override imageRequest(page: Page) {
    return { url: `${page.imageUrl}#image-request`, headers: this.headers };
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching(): boolean {
    return true;
  }

  override async fetchFilterData(): Promise<GenreData> {
    return this.parseGenres((await this.client.get(`${this.baseUrl}/search`)).asJsoup());
  }

  override getFilterList(data: unknown = null): FilterList {
    const genreData = data as GenreData | null;
    // TODO: Filters for sites that support it:
    // excluded genres
    // genre inclusion mode
    // bookmarks
    // author
    return [genreData ? new GenreFilter(genreData.key, genreData.genres.map(([name, id]) => new Genre(name, id))) : null, new StatusFilter(), new OrderFilter()].filter((it) => it !== null);
  }

  // ============================= Utilities =============================

  private buildChapterUrl(mangaId: string): string {
    return toHttpUrl(this.baseUrl).newBuilder().addPathSegment("api").addPathSegment("manga").addPathSegment(mangaId).addPathSegment("chapters").addQueryParameter("source", "detail").build().toString();
  }

  /**
   * Resolves the best available image URL from a chapter image element.
   *
   * For all images, we attempt to extract the site's own onerror fallback URL and
   * encode it as the fragment (mainUrl#fallbackUrl). The interceptor will
   * then transparently retry with the fallback if the primary request fails.
   *
   * For known broken CDN servers (currently s20), the onerror fallback is returned
   * as the primary URL directly — no point trying s20 at all.
   *
   * Note: the fallback URL has a different path structure than data-src
   * (it omits the /toonily/ path segment), so we cannot simply swap the domain —
   * we must extract it from the onerror attribute directly.
   */
  private resolveImageUrl(element: Element): string {
    const dataSrc = element.attr("abs:data-src");
    const raw = substringBefore(substringAfter(element.attr("onerror"), "this.src='", ""), "'");
    let fallback: string;
    if (raw.startsWith("https://") || raw.startsWith("http://")) fallback = raw;
    else if (raw.startsWith("//")) fallback = `https:${raw}`;
    else return dataSrc; // no onerror available, use data-src as-is
    // For known broken servers, use the fallback as the primary URL directly.
    // For everything else, encode fallback as fragment for the interceptor to retry with on failure.
    return dataSrc.includes("://s20.") ? fallback : `${dataSrc}#${fallback}`;
  }

  private parseChapterDate(date: string | null | undefined): number {
    if (date == null) return 0;
    return date.includes(" ago") ? this.parseRelativeDate(date) : this.dateFormat.tryParseDate(date, ZoneOffset.UTC);
  }

  private parseRelativeDate(date: string): number {
    const m = NUMBER_REGEX.exec(date)?.[0];
    const number = m !== undefined ? Number.parseInt(m, 10) : NaN;
    if (Number.isNaN(number)) return 0;

    if (date.includes("year")) return ago(number, "years");
    if (date.includes("month")) return ago(number, "months");
    if (date.includes("day")) return ago(number, "days");
    if (date.includes("hour")) return ago(number, "hours");
    if (date.includes("minute")) return ago(number, "minutes");
    if (date.includes("second")) return ago(number, "seconds");
    return 0;
  }

  // Dynamic genres
  private parseGenres(document: Document): GenreData {
    const wrappers = document.selectFirst(".checkbox-group.genres")!.select(".checkbox-wrapper");
    const name = wrappers[0]?.selectFirst("input")?.attr("name");
    const key = name ? name : "genre[]";
    const genres = wrappers.map((it): [string, string] => [it.selectFirst(".radio__label")!.text(), it.selectFirst("input")!.attr("value")]);
    return { key, genres };
  }
}
