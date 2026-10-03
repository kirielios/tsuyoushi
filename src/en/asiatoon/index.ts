// Port of keiyoushi/extensions-source src/en/asiatoon/AsiaToon.kt
import { DateTimeFormatter, GET, HttpSource, HttpUrl, Locale, MangasPage, Page, SChapter, SManga, distinctBy, substringBefore, urlWithoutDomain, type ClientBuilder, type Document, type Element, type FilterList, type Request, type Response } from "../../../sdk/index.ts";
import { BrowseFilter, browseFilters } from "./filters.ts";

const MONTH_DATE_REGEX = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2},\s+\d{4}/;
const WHITESPACE_REGEX = /\s+/g;

export default class AsiaToon extends HttpSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.ENGLISH);
  private readonly blockedHeadings = new Set(["Log in", "Sign up", "Description", "Details", "Genres", "Tags", "Episodes Details"]);
  private readonly genreNames = new Set([
    "All",
    "Vanilla",
    "Monster Girls",
    "School Life",
    "Horror Thriller",
    "Slice of Life",
    "Supernatural",
    "New",
    "Office",
    "Sexy",
    "MILF",
    "In-Law",
    "Harem",
    "Cheating",
    "College",
    "Isekai",
    "UNCENSORED",
    "GL",
    "sexy comics",
    "Sci-fi",
    "Sports",
    "School life",
    "Historical",
    "Action",
    "Thriller",
    "Horror",
    "Fantasy",
    "Comedy",
    "Drama",
    "BL",
    "Romance",
  ]);

  /** network.client.newBuilder().addCookie("hc_vfs" to "Y"): keiyoushi's addCookie, (re)set in the jar for the source's host. */
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((request) => {
      const domain = HttpUrl.parse(this.baseUrl).host;
      const host = new URL(request.url).hostname;
      if (host === domain || host.endsWith(`.${domain}`)) this.client.cookieJar.set(`https://${domain}/`, `hc_vfs=Y; Domain=${domain}; Path=/`);
      return request;
    });
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/en/genres?page=${page}`, this.headers);
  }

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/en/genres/New?page=${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const url = HttpUrl.parse(this.baseUrl).newBuilder();
    if (query.length > 0) {
      url.addEncodedPathSegments("en/search");
      url.addQueryParameter("keyword", query.trim());
    } else {
      const filter = filters.find((it) => it instanceof BrowseFilter) as BrowseFilter;
      url.addEncodedPathSegments(filter.selected);
      url.addQueryParameter("page", String(page));
    }

    return GET(url.build().toString(), this.headers);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return browseFilters();
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const requestUrl = HttpUrl.parse(response.url);
    const isTextSearch = (requestUrl.queryParameter("keyword") ?? "").trim() !== "";
    const pageParam = requestUrl.queryParameter("page");
    const currentPage = pageParam != null && /^[+-]?\d+$/.test(pageParam) ? Number.parseInt(pageParam, 10) : 1;
    const nextPage = currentPage + 1;

    const selector = isTextSearch ? "li.search-item-wrap" : "article.component-item";

    const mangas = distinctBy(
      document
        .select(selector)
        .map((it) => this.mangaFromElement(it))
        .filter((it): it is SManga => it != null),
      (it) => it.url,
    );

    const hasNextPage = !isTextSearch && !document.select(`a[href*='page=${nextPage}']`).isEmpty();

    return new MangasPage(mangas, hasNextPage);
  }

  protected mangaDetailsParse(response: Response | Document): SManga {
    const document = (response as Response).asJsoup();
    const manga = SManga.create();

    manga.title = document.selectFirst(".info__right h1, .info__right h2, h1, h2")?.text() ?? "";

    const thumb = document.selectFirst(".info__left .thumb-wrapper img, .thumb-wrapper a.thumb.js-thumbnail img, a.thumb.js-thumbnail img");
    const thumbUrl = thumb != null ? this.imgAttr(thumb) : undefined;
    manga.thumbnail_url = thumbUrl != null && thumbUrl.toLowerCase().startsWith("data:") ? undefined : thumbUrl;

    const genre = [
      ...new Set(
        document
          .select(".info__right a[href*='/en/genres/'], a[href*='/en/genres/']")
          .map((it) => it.text())
          .filter((it) => this.genreNames.has(it)),
      ),
    ].join(", ");
    manga.genre = genre.trim() === "" ? undefined : genre;

    manga.description = this.extractSectionText(document, "Description") ?? this.extractSectionText(document, "Details") ?? undefined;
    return manga;
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();

    const chapters = document
      .select("a[href*='/episode-']")
      .map((element) => {
        const url = element.absUrl("href");
        if (url.trim() === "") return null;

        const text = element.text().replace(WHITESPACE_REGEX, " ");
        const dateText = MONTH_DATE_REGEX.exec(text)?.[0];
        const beforeDate = substringBefore(text, dateText ?? "").trim();
        const name = beforeDate.trim() === "" ? text : beforeDate;

        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(url);
        chapter.name = name;
        chapter.date_upload = dateText != null ? this.dateFormat.tryParseDate(dateText) : 0;
        return chapter;
      })
      .filter((it): it is SChapter => it != null);
    return distinctBy(chapters, (it) => it.url);
  }

  protected pageListParse(response: Response | Document): Page[] {
    const document = (response as Response).asJsoup();
    const dataIndex = (it: Element) => {
      const v = it.attr("data-index");
      return /^[+-]?\d+$/.test(v) ? Number.parseInt(v, 10) : Number.MAX_SAFE_INTEGER;
    };
    return [
      ...document.select(
        "article.viewer__body img.content__img[data-index], " + "article.js-episode-article img.content__img[data-index], " + ".viewer__body img.content__img[data-index]",
      ),
    ]
      .sort((a, b) => dataIndex(a) - dataIndex(b))
      .map((img, index) => new Page(index, "", this.imgAttr(img)));
  }

  protected imageUrlParse(_response: Response | Document): string {
    throw new Error("UnsupportedOperationException");
  }

  private mangaFromElement(element: Element): SManga | null {
    const anchor = element.selectFirst("a.thumb.js-thumbnail, a.thumb, a[href$='.html']");
    if (anchor == null) return null;
    const candidates = [
      anchor.attr("title"),
      element.selectFirst("[title]")?.attr("title"),
      element.selectFirst("p.line-clamp-3, p.webtoon-title")?.text(),
      element.selectFirst(".title")?.text(),
      element.selectFirst("img[alt]:not([alt=icon]):not([alt=img-thumb]):not([alt=wuf])")?.attr("alt"),
    ];
    const title = candidates
      .filter((it): it is string => it != null)
      .map((it) => it.trim())
      .find((it) => it.trim() !== "") ?? "";

    if (title.trim() === "") return null;

    const manga = SManga.create();
    manga.url = urlWithoutDomain(anchor.absUrl("href"));
    manga.title = title;
    const img = anchor.selectFirst("img");
    manga.thumbnail_url = (img != null ? this.imgAttr(img) : undefined) ?? (element.selectFirst("img") != null ? this.imgAttr(element.selectFirst("img")!) : undefined);
    return manga;
  }

  private extractSectionText(document: Document, heading: string): string | null {
    const headingElement = [...document.select("*")].find((it) => it.ownText().trim().toLowerCase() === heading.toLowerCase());
    if (headingElement == null) return null;

    let sibling = headingElement.nextElementSibling();
    while (sibling != null) {
      const text = sibling.text();
      if (text.trim() !== "" && !this.blockedHeadings.has(text)) return text;
      sibling = sibling.nextElementSibling();
    }

    return null;
  }

  private imgAttr(element: Element): string {
    if (element.hasAttr("data-src")) return element.absUrl("data-src");
    if (element.hasAttr("data-original")) return element.absUrl("data-original");
    return element.absUrl("src");
  }
}
