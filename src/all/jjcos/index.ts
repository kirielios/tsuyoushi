// Port of keiyoushi/extensions-source src/all/jjcos/JJCOS.kt
import { DateTimeFormatter, HttpUrl, HttpSource, GET, Locale, MangasPage, Page, SChapter, SManga, substringBefore, type Document, type FilterList, type Request, type Response } from "../../../sdk/index.ts";
import { toSManga, type IndexDto, type PostDto } from "./dto.ts";

const PAGE_SIZE = 20;

// SimpleDateFormat parses a prefix of the text and ignores the rest, so the formatters see just that prefix.
const DATE_FORMATS: [RegExp, DateTimeFormatter][] = [
  [/^\s*\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{1,2}:\d{1,2}/, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT)],
  [/^\s*\d{4}-\d{1,2}-\d{1,2}/, DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT)],
];

const coerceAtLeast1 = (v: string | null): number => {
  const n = v != null && /^[+-]?\d+$/.test(v) ? Number.parseInt(v, 10) : 1;
  return Math.max(n, 1);
};

export default class JJCOS extends HttpSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // ============================== Popular ==============================

  protected popularMangaRequest(page: number): Request {
    return GET(this.indexUrlBuilder(page).build(), this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const posts = response.parseAs<IndexDto>().posts;
    const page = coerceAtLeast1(HttpUrl.parse(response.url).queryParameter("page"));

    return this.toMangasPage(posts, page);
  }

  // ============================== Latest ===============================

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================

  /** 1.4 has no URL handling in getSearchManga: the deeplink check lives in fetchSearchManga below. */
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const mangaPath = this.parseDeeplinkToMangaPath(query);
    if (mangaPath == null) return super.fetchSearchManga(page, query, filters);

    const manga = SManga.create();
    manga.url = mangaPath;

    return new MangasPage([await this.fetchMangaDetails(manga)], false);
  }

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    return GET(this.indexUrlBuilder(page, query).build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const posts = response.parseAs<IndexDto>().posts;
    const requestUrl = HttpUrl.parse(response.url);
    const page = coerceAtLeast1(requestUrl.queryParameter("page"));
    const query = requestUrl.queryParameter("query")?.trim() ?? "";

    let filteredPosts: PostDto[];
    if (query.length === 0) filteredPosts = posts;
    else {
      const normalizedQuery = query.toLowerCase();
      filteredPosts = posts.filter((post) => post.title.toLowerCase().includes(normalizedQuery) || post.content?.toLowerCase().includes(normalizedQuery) === true);
    }

    return this.toMangasPage(filteredPosts, page);
  }

  // ============================== Details ==============================

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();

    const manga = SManga.create();
    const raw = document.selectFirst("h1.fh5co-article-title")?.text();
    const title = raw?.replace(/ - JJCOS$/, "").trim();
    if (!title) throw new Error("NullPointerException");
    manga.title = title;

    manga.thumbnail_url = document.selectFirst("#post-content img, article img")?.absUrl("src");

    const genre = [
      ...new Set(
        document
          .select(".tag-container a.tag")
          .map((it) => it.text().replace(/^#/, "").trim())
          .filter((it) => it.length > 0),
      ),
    ].join(", ");
    manga.genre = genre.length > 0 ? genre : undefined;

    manga.status = SManga.COMPLETED;

    manga.url = HttpUrl.parse(response.url).encodedPath;
    return manga;
  }

  // ============================= Chapters ==============================

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const postPath = HttpUrl.parse(response.url).encodedPath;
    const dateUpload = this.parseDate(document.selectFirst("meta[property=article:published_time]")?.attr("content") ?? document.selectFirst(".breadcrumb-item.date-overlay")?.text());

    const chapter = SChapter.create();
    chapter.url = this.normalizePath(postPath);
    chapter.name = "Gallery";
    chapter.date_upload = dateUpload;
    return [chapter];
  }

  // =============================== Pages ===============================

  protected pageListParse(response: Response | Document): Page[] {
    const document = (response as Response).asJsoup ? (response as Response).asJsoup() : (response as Document);
    const imageUrls = this.extractImageUrls(document);

    return imageUrls.map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  protected imageUrlParse(_response: Response | Document): string {
    throw new Error("UnsupportedOperationException");
  }

  // ============================= Utilities =============================

  private extractImageUrls(document: Document): string[] {
    const imageUrls = new Set<string>();

    document.select("#post-content img, article #post-content img, article p img").forEach((imageElement) => {
      let url = imageElement.absUrl("src");
      if (url.trim() === "") url = imageElement.absUrl("data-src");
      url = url.trim();

      if (url.length > 0) imageUrls.add(url);
    });

    return [...imageUrls];
  }

  private toMangasPage(posts: PostDto[], page: number): MangasPage {
    const startIndex = (page - 1) * PAGE_SIZE;
    if (startIndex >= posts.length) return new MangasPage([], false);

    const endIndexExclusive = Math.min(posts.length, startIndex + PAGE_SIZE);
    const mangas = posts.slice(startIndex, endIndexExclusive).map((post) => toSManga(post, this.linkToEncodedPath(post.link)));

    return new MangasPage(mangas, endIndexExclusive < posts.length);
  }

  private parseDeeplinkToMangaPath(query: string): string | null {
    const queryUrl = this.parseQueryAsHttpUrl(query);
    if (queryUrl == null) return null;
    const sourceHost = HttpUrl.parse(this.baseUrl).host;
    const pathSegments = queryUrl.pathSegments.filter((it) => it.length > 0);
    const encodedPath = queryUrl.encodedPath;

    if (queryUrl.host !== sourceHost && queryUrl.host !== `www.${sourceHost}`) return null;

    if (pathSegments.length === 0) return null;

    return pathSegments[0] === "post" ? this.normalizePath(encodedPath) : null;
  }

  private parseQueryAsHttpUrl(query: string): HttpUrl | null {
    const trimmedQuery = query.trim();

    return (
      HttpUrl.parseOrNull(trimmedQuery) ??
      HttpUrl.parseOrNull(trimmedQuery.replaceAll(" ", "%20")) ??
      (trimmedQuery.startsWith("/post/") ? HttpUrl.parseOrNull(`${this.baseUrl}${trimmedQuery.replaceAll(" ", "%20")}`) : null)
    );
  }

  private linkToEncodedPath(link: string): string {
    const sanitizedLink = substringBefore(substringBefore(link.trim(), "?"), "#");
    let absoluteLink: string;
    if (sanitizedLink.startsWith("http://") || sanitizedLink.startsWith("https://")) absoluteLink = sanitizedLink;
    else if (sanitizedLink.startsWith("/")) absoluteLink = `${this.baseUrl}${sanitizedLink}`;
    else absoluteLink = `${this.baseUrl}/${sanitizedLink}`;
    absoluteLink = absoluteLink.replaceAll(" ", "%20");

    const parsed = HttpUrl.parseOrNull(absoluteLink);
    if (parsed == null) throw new Error(`Invalid post link: ${link}`);

    return this.normalizePath(parsed.encodedPath);
  }

  private normalizePath(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    const parsed = HttpUrl.parseOrNull(`${this.baseUrl}${normalizedPath}`);
    if (parsed == null) throw new Error(`Invalid path: ${path}`);

    return parsed.encodedPath;
  }

  private indexUrlBuilder(page: number, query: string | null = null) {
    const b = HttpUrl.parse(`${this.baseUrl}/api/index.html`).newBuilder();
    b.addQueryParameter("page", String(page));
    if (query != null && query.trim() !== "") b.addQueryParameter("query", query);
    return b;
  }

  private parseDate(rawDate: string | null | undefined): number {
    if (rawDate == null) return 0;
    for (const [prefix, format] of DATE_FORMATS) {
      const m = prefix.exec(rawDate);
      const t = m ? format.tryParseDateTime(m[0]) : 0;
      if (t !== 0) return t;
    }
    return 0;
  }
}
