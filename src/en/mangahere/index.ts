// Port of keiyoushi/extensions-source src/en/mangahere/Mangahere.kt
import {
  DateTimeFormatter,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  toHttpUrl,
  urlWithoutDomain,
  substringAfter,
  substringAfterLast,
  substringBefore,
  substringBeforeLast,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList,
  type Request,
} from "../../../sdk/index.ts";
import { ArtistFilter, AuthorFilter, CompletionList, GenreList, RatingList, TypeList, YearFilter, completions, genres, ratings, types } from "./filters.ts";

/**
 * Upstream evaluates the site's packed (p,a,c,k,e,d) scripts with QuickJS. Executing code served by a website is not
 * allowed here, so every such step stops with this error.
 */
function quickJsEvaluate(_script: string): string {
  throw new Error("QuickJS script execution is not supported (Mangahere page URLs come from a packed site script)");
}

export default class Mangahere extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return (
      builder
        // addCookie("isAdult" to "1")
        .addInterceptor((request) => this.addCookie(request, [["isAdult", "1"]]))
        .rateLimit(1, 2000, (it) => it.hostname === new URL(this.baseUrl).hostname && !it.pathname.endsWith("/chapterfun.ashx"))
    );
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the source host on every matching request, which then sends them. */
  private addCookie(request: Request, cookies: [string, string][]): Request {
    const domain = new URL(this.baseUrl).hostname;
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    }
    return request;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM dd,yyyy", Locale.ENGLISH);

  // Popular Manga

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/directory/${page}.htm`)).asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private popularMangaSelector = () => ".manga-list-1-list li";

  private popularMangaNextPageSelector = () => "div.pager-list-left a:last-child";

  private popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const titleElement = element.selectFirst("a")!;
    manga.title = titleElement.attr("title");
    manga.url = urlWithoutDomain(titleElement.absUrl("href"));
    manga.thumbnail_url = element.selectFirst("img.manga-list-1-cover")?.absUrl("src");
    return manga;
  }

  // Latest Updates

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/directory/${page}.htm?latest`)).asJsoup();
    const mangas = document.select(this.latestUpdatesSelector()).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.latestUpdatesNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private latestUpdatesSelector = () => ".manga-list-1-list li";

  private latestUpdatesNextPageSelector = () => "div.pager-list-left a:last-child";

  // Search

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder();

    for (const filter of filters) {
      if (filter instanceof TypeList) {
        url.addEncodedQueryParameter("type", String(types.get(filter.values[filter.state])));
      } else if (filter instanceof CompletionList) {
        url.addEncodedQueryParameter("st", String(filter.state));
      } else if (filter instanceof RatingList) {
        url.addEncodedQueryParameter("rating_method", "gt");
        url.addEncodedQueryParameter("rating", String(filter.state));
      } else if (filter instanceof GenreList) {
        const includeGenres = new Set<number>();
        const excludeGenres = new Set<number>();
        for (const genre of filter.state) {
          if (genre.isIncluded()) includeGenres.add(genre.id);
          if (genre.isExcluded()) excludeGenres.add(genre.id);
        }
        url.addEncodedQueryParameter("genres", [...includeGenres].join(","));
        url.addEncodedQueryParameter("nogenres", [...excludeGenres].join(","));
      } else if (filter instanceof ArtistFilter) {
        url.addEncodedQueryParameter("artist_method", "cw");
        url.addEncodedQueryParameter("artist", filter.state);
      } else if (filter instanceof AuthorFilter) {
        url.addEncodedQueryParameter("author_method", "cw");
        url.addEncodedQueryParameter("author", filter.state);
      } else if (filter instanceof YearFilter) {
        url.addEncodedQueryParameter("released_method", "eq");
        url.addEncodedQueryParameter("released", filter.state);
      }
    }

    url.addEncodedQueryParameter("page", String(page));
    url.addEncodedQueryParameter("title", query);
    url.addEncodedQueryParameter("sort", null);
    url.addEncodedQueryParameter("stype", String(1));
    url.addEncodedQueryParameter("name", null);

    const document = (await this.client.get(url.build().toString())).asJsoup();
    const mangas = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.searchMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaSelector = () => ".manga-list-4-list > li";

  private searchMangaNextPageSelector = () => "div.pager-list-left a:last-child";

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const titleEl = element.selectFirst(".manga-list-4-item-title > a");
    manga.url = urlWithoutDomain(titleEl?.absUrl("href") ?? "");
    manga.title = titleEl?.attr("title") ?? "";
    manga.thumbnail_url = element.selectFirst("img.manga-list-4-cover")?.absUrl("src");
    return manga;
  }

  // Manga Details

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const updatedManga = this.mangaDetailsFromDocument(document);
    const updatedChapters = this.chapterListFromDocument(document);

    // Explicitly ignoring `fetchChapters` as we would otherwise provide incomplete data
    // Get a chapter, check if the manga is licensed.
    if (updatedChapters.length === 0) throw new Error("NoSuchElementException: List is empty.");
    const aChapterUrl = this.getChapterUrl(updatedChapters[0]);
    const aChapterDocument = (await this.client.get(aChapterUrl)).asJsoup();
    if (aChapterDocument.select("p.detail-block-content").some((it) => it.text() !== "")) updatedManga.status = SManga.LICENSED;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private mangaDetailsFromDocument(document: Document): SManga {
    const manga = SManga.create();
    manga.author = document.selectFirst(".detail-info-right-say > a")?.text();
    manga.genre = document
      .select(".detail-info-right-tag-list > a")
      .map((it) => it.text())
      .join(", ");
    manga.description = document.selectFirst(".fullcontent")?.text();
    manga.thumbnail_url = document.selectFirst("img.detail-info-cover-img")?.absUrl("src");

    const statusText = document.selectFirst("span.detail-info-right-title-tip")?.text();
    if (statusText != null) {
      const s = statusText.toLowerCase();
      if (s.includes("ongoing")) manga.status = SManga.ONGOING;
      else if (s.includes("completed")) manga.status = SManga.COMPLETED;
      else manga.status = SManga.UNKNOWN;
    }

    return manga;
  }

  // Chapters

  private chapterListSelector = () => "ul.detail-main-list > li";

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
    chapter.name = element.selectFirst("a p.title3")!.text();
    const dateText = element.selectFirst("a p.title2")?.text();
    chapter.date_upload = dateText != null ? this.parseChapterDate(dateText) : 0;
    return chapter;
  }

  private chapterListFromDocument(document: Document): SChapter[] {
    return document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));
  }

  private parseChapterDate(date: string): number {
    if (date.includes("Today") || date.includes(" ago")) {
      const c = new Date();
      c.setHours(0, 0, 0, 0);
      return c.getTime();
    } else if (date.includes("Yesterday")) {
      const c = new Date();
      c.setDate(c.getDate() - 1);
      c.setHours(0, 0, 0, 0);
      return c.getTime();
    }
    return this.dateFormat.tryParseDate(date);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const bar = document.select("script[src*=chapter_bar]");

    let pages: Page[];
    // if-branch is for webtoon reader, else is for page-by-page
    if (bar.length > 0) {
      const script = document.select("script:containsData(function(p,a,c,k,e,d))").html().replace(/^eval/, "");
      const deobfuscatedScript = quickJsEvaluate(script);
      const urls = substringBefore(substringAfter(deobfuscatedScript, "newImgs=['"), "'];").split("','");

      pages = urls.map((s, index) => new Page(index, "", `https:${s}`));
    } else {
      const html = document.html();
      const link = document.location();

      const secretKey = this.extractSecretKey(html);

      const chapterIdStartLoc = html.indexOf("chapterid");
      const chapterId = html.substring(chapterIdStartLoc + 11, html.indexOf(";", chapterIdStartLoc)).trim();

      const chapterPagesElement = document.selectFirst(".pager-list-left > span")!;
      const pagesLinksElements = chapterPagesElement.select("a");
      const pagesNumber = Number.parseInt(pagesLinksElements[pagesLinksElements.length - 2].attr("data-page"), 10);

      const pageBase = link.substring(0, link.lastIndexOf("/"));
      pages = Array.from({ length: Math.max(pagesNumber, 0) }, (_, i) => i + 1).map((page) => {
        const pageUrl = toHttpUrl(`${pageBase}/chapterfun.ashx`).newBuilder().addQueryParameter("cid", chapterId).addQueryParameter("page", String(page)).addQueryParameter("key", secretKey).fragment(link).build();

        return new Page(page - 1, pageUrl.toString());
      });
    }
    return this.dropLastIfBroken(pages);
  }

  /*
      function to drop last imageUrl if it's broken/unneccesary, working imageUrls are incremental (e.g. t001, t002, etc); if the difference between
      the last two isn't 1 or doesn't have an Int at the end of the last imageUrl's filename, drop last Page
   */
  private async dropLastIfBroken(pages: Page[]): Promise<Page[]> {
    if (pages.length < 2) return pages;

    const lastIndex = pages.length - 1;
    const resolvedPages: Page[] = [];
    for (const [index, page] of pages.entries()) {
      if (index < lastIndex - 1 || page.imageUrl != null) resolvedPages.push(page);
      else resolvedPages.push(new Page(page.index, page.url, await this.getImageUrl(page)));
    }
    const pageNumbers: number[] = [];
    for (const page of resolvedPages.slice(-2)) {
      const imageUrl = page.imageUrl;
      const n = imageUrl == null ? null : this.toIntOrNull(substringAfterLast(substringBeforeLast(imageUrl, "."), "/").slice(-2));
      if (n == null) return resolvedPages.slice(0, -1);
      pageNumbers.push(n);
    }

    return pageNumbers[1] - pageNumbers[0] === 1 || (pageNumbers[0] === 0 && pageNumbers[1] === 99) ? resolvedPages : resolvedPages.slice(0, -1);
  }

  private toIntOrNull(s: string): number | null {
    return /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null;
  }

  override async getImageUrl(page: Page): Promise<string> {
    const pageUrl = toHttpUrl(page.url);
    const referer = pageUrl.fragment;
    if (referer == null) throw new Error("Missing chapter referer");
    const requestUrl = pageUrl.newBuilder().fragment(null).build();
    const pageHeaders = this.headers;
    pageHeaders.set("Referer", referer);
    pageHeaders.set("Accept", "*/*");
    pageHeaders.set("Accept-Language", "en-US,en;q=0.9");
    pageHeaders.set("X-Requested-With", "XMLHttpRequest");

    for (let attempt = 0; attempt <= 2; attempt++) {
      const url = attempt === 0 ? requestUrl : requestUrl.newBuilder().setQueryParameter("key", "").build();
      const responseText = (await this.client.get(url.toString(), pageHeaders)).text();
      if (responseText.length > 0) {
        return this.parseImageUrl(responseText);
      }
    }

    throw new Error("Empty image response");
  }

  private parseImageUrl(responseText: string): string {
    const deobfuscatedScript = quickJsEvaluate(responseText.replace(/^eval/, ""));

    const pixIdx = deobfuscatedScript.indexOf("pix=");
    if (pixIdx < 0) throw new Error("Missing image host");
    const baseLinkStart = pixIdx + 5;
    const semi = deobfuscatedScript.indexOf(";", baseLinkStart);
    if (!(semi > baseLinkStart)) throw new Error("Invalid image host");
    const baseLinkEnd = semi - 1;
    const baseLink = deobfuscatedScript.substring(baseLinkStart, baseLinkEnd);

    const pvIdx = deobfuscatedScript.indexOf("pvalue=");
    if (pvIdx < 0) throw new Error("Missing image path");
    const imageLinkStart = pvIdx + 9;
    const imageLinkEnd = deobfuscatedScript.indexOf('"', imageLinkStart);
    if (!(imageLinkEnd > imageLinkStart)) throw new Error("Invalid image path");
    const imageLink = deobfuscatedScript.substring(imageLinkStart, imageLinkEnd);

    return `https:${baseLink}${imageLink}`;
  }

  private extractSecretKey(html: string): string {
    const secretKeyScriptLocation = html.indexOf("eval(function(p,a,c,k,e,d)");
    const secretKeyScriptEndLocation = html.indexOf("</script>", secretKeyScriptLocation);
    const secretKeyScript = html.substring(secretKeyScriptLocation, secretKeyScriptEndLocation).replace(/^eval/, "");

    const secretKeyDeobfuscatedScript = quickJsEvaluate(secretKeyScript);

    const secretKeyStartLoc = secretKeyDeobfuscatedScript.indexOf("'");
    const secretKeyEndLoc = secretKeyDeobfuscatedScript.indexOf(";");

    const secretKeyResultScript = secretKeyDeobfuscatedScript.substring(secretKeyStartLoc, secretKeyEndLoc);

    return quickJsEvaluate(secretKeyResultScript);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [
      new TypeList([...types.keys()].sort()),
      new ArtistFilter("Artist"),
      new AuthorFilter("Author"),
      new GenreList(genres()),
      new RatingList(ratings),
      new YearFilter("Year released"),
      new CompletionList(completions),
    ];
  }
}
