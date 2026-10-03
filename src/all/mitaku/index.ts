// Port of keiyoushi/extensions-source src/all/mitaku/Mitaku.kt (+ Filters.kt)
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstance, ifBlank, isBlank, toHttpUrl, toHttpUrlOrNull, tryParseInstant, urlWithoutDomain, type Document, type Element, type Response } from "../../../sdk/index.ts";

// --- Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly valuePairs: [string, string][],
  ) {
    super(
      displayName,
      valuePairs.map((it) => it[0]),
    );
  }
  get selected(): string | null {
    const v = this.valuePairs[this.state][1];
    return v.length > 0 ? v : null;
  }
}

class CategoryFilter extends UriPartFilter {
  constructor() {
    super("Category", [
      ["Any", ""],
      ["Ero Cosplay", "ero-cosplay"],
      ["Nude", "nude"],
      ["Sexy Set", "sexy-set"],
      ["Online Video", "online-video"],
    ]);
  }
}

class TagFilter extends Filter.Text {
  constructor() {
    super("Tag");
  }
  toUriPart(): string {
    return this.state
      .trim()
      .toLowerCase()
      .split(" ")
      .filter((it) => it.length > 0)
      .join("-");
  }
}

const POST_SELECTOR = "div.article-container article";
const NEXT_PAGE_SELECTOR = "div.wp-pagenavi a.page.larger";
const PAGE_SELECTOR = "a.msacwl-img-link";
const NON_POST_PATH_PREFIXES = new Set(["category", "tag", "search", "page"]);

export default class Mitaku extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // ========================= Popular =========================
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/category/ero-cosplay/page/${page}`);
    return this.parseMangasPage((await this.client.get(url.toString())).asJsoup());
  }

  // ========================= Latest =========================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Search =========================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    if (!this.isMangaOrChapterPath(url.pathname.slice(1).split("/"))) return null;
    return this.mangaDetailsParse((await this.client.get(url.toString())).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categoryFilter = firstInstance(filters, CategoryFilter);
    const tagFilter = firstInstance(filters, TagFilter);

    let url: string;
    if (!isBlank(query)) url = toHttpUrl(`${this.baseUrl}/page/${page}`).newBuilder().addQueryParameter("s", query.trim()).build().toString();
    else if (categoryFilter.selected != null) url = toHttpUrl(`${this.baseUrl}/category/${categoryFilter.selected}/page/${page}`).toString();
    else if (tagFilter.toUriPart().length > 0) url = toHttpUrl(`${this.baseUrl}/tag/${tagFilter.toUriPart()}/page/${page}`).toString();
    else return this.getPopularManga(page);

    return this.parseSearch(await this.client.get(url));
  }

  private parseSearch(response: Response): MangasPage {
    const document = response.asJsoup();
    const requestPathSegments = toHttpUrl(response.url).pathSegments;

    if (this.isMangaOrChapterPath(requestPathSegments)) {
      const manga = this.mangaDetailsParse(document);
      return new MangasPage([manga], false);
    }

    return this.parseMangasPage(document);
  }

  // ========================= Filters =========================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Only one tag search"), new Filter.Separator(), new CategoryFilter(), new TagFilter());
  }

  // ======================= MangaUpdate =======================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(doc), this.parseChapters(doc));
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const article = document.selectFirst("article");
    if (!article) throw new Error("Post details not found");

    const title = article.selectFirst("h1")?.text();
    if (title == null || isBlank(title)) throw new Error("Title is mandatory");
    manga.title = title;
    manga.url = urlWithoutDomain(document.location());
    const categoryGenres = article
      .select("span.cat-links a")
      .map((it) => it.text())
      .join(", ");
    const tagGenres = article
      .select("span.tag-links a")
      .map((it) => it.text())
      .join(", ");
    manga.genre = [categoryGenres, tagGenres].filter((it) => it.length > 0).join(", ");

    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    manga.initialized = true;
    return manga;
  }

  // ========================= Chapters =========================
  private parseChapters(document: Document): SChapter[] {
    const title = document.selectFirst("article h1")?.text() ?? "";

    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(document.location());
    chapter.chapter_number = 1;
    chapter.name = title.endsWith("(Video)") ? "This post is video-only, watch it in WebView" : "Gallery";
    const date = document.selectFirst(".entry-date")?.attr("datetime");
    chapter.date_upload = tryParseInstant(date);
    return [chapter];
  }

  // ========================= Pages =========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.getChapterUrl(chapter));
    const pages: Page[] = [];
    response
      .asJsoup()
      .select(PAGE_SELECTOR)
      .forEach((element, index) => {
        const imageUrl = ifBlank(element.absUrl("data-mfp-src"), element.absUrl("href"));
        if (!isBlank(imageUrl)) pages.push(new Page(index, "", imageUrl));
      });

    if (pages.length === 0) throw new Error("Page list not found");

    return pages;
  }

  private parseMangasPage(document: Document): MangasPage {
    const mangas = document.select(POST_SELECTOR).map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst(NEXT_PAGE_SELECTOR) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const link = element.selectFirst("a")?.absUrl("href");
    if (link == null) throw new Error("Post URL not found");

    const parsedUrl = toHttpUrlOrNull(link);
    if (parsedUrl == null) throw new Error(`Invalid post URL: ${link}`);
    manga.url = parsedUrl.encodedPath;

    const aTitle = element.selectFirst("a")?.attr("title");
    const hTitle = element.selectFirst("h1, h2, h3")?.text();
    const title = aTitle != null && !isBlank(aTitle) ? aTitle : hTitle != null && !isBlank(hTitle) ? hTitle : null;
    if (title == null) throw new Error("Title is mandatory");
    manga.title = title;

    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    return manga;
  }

  private isMangaOrChapterPath(pathSegments: string[]): boolean {
    const segments = pathSegments.filter((it) => !isBlank(it));
    if (segments.length === 0) return false;
    if (NON_POST_PATH_PREFIXES.has(segments[0])) return false;

    return segments.length >= 2;
  }
}
