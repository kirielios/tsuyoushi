// Port of keiyoushi/extensions-source lib-multisrc/mangareader/MangaReader.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseHtml,
  substringAfterLast,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type HttpUrl,
  type HttpUrlBuilder,
  type Response,
} from "../../sdk/index.ts";

interface AjaxResponse {
  html: string;
}

type Pair = [string, string];

// =============================== Filters ==============================

export class Note extends Filter.Header {
  constructor() {
    super("NOTE: Ignored if using text search!");
  }
}

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as unknown as UriFilter).addToUri === "function";

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: Pair[],
    defaultValue: string | null = null,
  ) {
    const i = vals.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      vals.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    builder.addQueryParameter(this.param, this.vals[this.state][1]);
  }
}

export class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    vals: Pair[],
    private readonly join: string | null = null,
  ) {
    super(
      name,
      vals.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state);
    if (this.join == null) checked.forEach((it) => builder.addQueryParameter(this.param, it.value));
    else
      builder.addQueryParameter(
        this.param,
        checked.map((it) => it.value).join(this.join),
      );
  }
}

export class SortFilter extends UriPartFilter {}

export abstract class MangaReader extends KeiSource {
  addPage(page: number, builder: HttpUrlBuilder) {
    builder.addQueryParameter("page", String(page));
  }

  // ============================== Popular ===============================

  protected sortPopularValue = "most-viewed";

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter(this.sortFilterName, this.sortFilterParam, this.sortFilterValues(), this.sortPopularValue)));
  }

  // =============================== Latest ===============================

  protected sortLatestValue = "latest-updated";

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter(this.sortFilterName, this.sortFilterParam, this.sortFilterValues(), this.sortLatestValue)));
  }

  // =============================== Search ===============================

  protected searchPathSegment = "search";
  protected searchKeyword = "keyword";

  searchMangaUrl(page: number, query: string, filters: FilterList): HttpUrl {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    if (query.trim()) {
      if (this.searchPathSegment) b.addPathSegment(this.searchPathSegment);
      b.addQueryParameter(this.searchKeyword, query);
    } else {
      b.addPathSegment("filter");
      b.addPathSegment("");
      filters.filter(isUriFilter).forEach((it) => it.addToUri(b));
    }

    this.addPage(page, b);
    return b.build();
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const response = await this.client.get(this.searchMangaUrl(page, query, filters).toString());
    return this.searchMangaParse(response);
  }

  searchMangaSelector(): string {
    return ".manga_list-sbs .manga-poster";
  }

  searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.attr("href"));
    const it = element.selectFirst("img")!;
    manga.title = it.attr("alt");
    manga.thumbnail_url = this.imgAttr(it);
    return manga;
  }

  searchMangaNextPageSelector(): string {
    return "ul.pagination > li.active + li";
  }

  searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const entries = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));

    const hasNextPage = document.selectFirst(this.searchMangaNextPageSelector()) != null;
    return new MangasPage(entries, hasNextPage);
  }

  // =========================== Manga Details & Chapters ============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    const manga = SManga.create();
    manga.url = url.pathname;
    const m = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    return m.title ? m : null;
  }

  private get authorText(): string {
    return this.lang === "ja" ? "著者" : "Authors";
  }

  private get statusText(): string {
    return this.lang === "ja" ? "地位" : "Status";
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    this.parseMangaDetails(document, manga);
    return new SMangaUpdate(manga, this.parseChapterList(document));
  }

  parseMangaDetails(document: Document, manga: SManga) {
    const root = document.selectFirst("#ani_detail");
    if (!root) return;
    const name = root.selectFirst(".manga-name");
    if (name) manga.title = name.ownText();
    manga.thumbnail_url = root.selectFirst("img") ? this.imgAttr(root.selectFirst("img")!) : undefined;
    manga.genre = root
      .select(".genres > a")
      .map((it) => it.ownText())
      .join(", ");

    let description = "";
    const desc = root.selectFirst(".description")?.ownText();
    if (desc != null) description += desc;
    description += "\n\n";
    const alt = root.selectFirst(".manga-name-or")?.ownText();
    if (alt && alt !== manga.title) description += `Alternative Title: ${alt}`;
    manga.description = description.trim();

    root.select(".anisc-info > .item").forEach((info) => {
      switch (info.selectFirst(".item-head")?.ownText()) {
        case `${this.authorText}:`:
          this.parseAuthorsTo(info, manga);
          break;
        case `${this.statusText}:`:
          this.parseStatus(info, manga);
          break;
      }
    });
  }

  private parseAuthorsTo(element: Element, manga: SManga): SManga {
    const authors = element.select("a");
    const text = authors.map((it) => it.ownText().replaceAll(",", ""));

    const count = authors.length;
    if (count === 0) return manga;
    if (count === 1) {
      manga.author = text[0];
      return manga;
    }

    const authorList: string[] = [];
    const artistList: string[] = [];
    authors.forEach((author, index) => {
      // author.nextSibling() as? TextNode
      const next = (author.node as { next?: { type: string; data?: string } | null }).next;
      const list = next?.type === "text" && next.data?.includes("(Art)") ? artistList : authorList;
      list.push(text[index]);
    });

    if (authorList.length) manga.author = authorList.join(", ");
    if (artistList.length) manga.artist = artistList.join(", ");
    return manga;
  }

  private parseStatus(element: Element, manga: SManga): SManga {
    manga.status = this.getStatus(element.selectFirst(".name")?.text());
    return manga;
  }

  getStatus(s: string | null | undefined): number {
    switch (s?.toLowerCase()) {
      case "ongoing":
      case "publishing":
      case "releasing":
        return SManga.ONGOING;
      case "completed":
      case "finished":
        return SManga.COMPLETED;
      case "on-hold":
      case "on_hiatus":
        return SManga.ON_HIATUS;
      case "canceled":
      case "discontinued":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ============================== Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + substringBeforeLast(chapter.url, "#");
  }

  chapterIdSelect = "en-chapters";

  chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const a = element.selectFirst("a")!;
    chapter.url = urlWithoutDomain(a.attr("href") + `#${element.attr("data-id")}`);
    chapter.name = a.selectFirst(".name")?.text() ?? a.text();
    return chapter;
  }

  parseChapterList(document: Document): SChapter[] {
    return document.select(`#${this.chapterIdSelect} > li.chapter-item`).map((it) => this.chapterFromElement(it));
  }

  // =============================== Pages ================================

  async getChapterId(chapter: SChapter): Promise<string> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    const id = document.selectFirst("div[data-reading-id]")?.attr("data-reading-id") ?? "";
    if (!id) throw new Error("Unable to retrieve chapter id");
    return id;
  }

  getAjaxUrl(id: string): string {
    return `${this.baseUrl}/ajax/image/list/${id}?mode=vertical`;
  }

  pageListParseSelector(): string {
    return ".container-reader-chapter > div > img";
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = substringAfterLast(chapter.url, "#") || (await this.getChapterId(chapter));

    const ajaxHeaders = this.headersBuilder();
    ajaxHeaders.append("Accept", "application/json, text/javascript, */*; q=0.01");
    ajaxHeaders.set("Referer", encodeURIComponent(this.baseUrl + substringBeforeLast(chapter.url, "#")));
    ajaxHeaders.append("X-Requested-With", "XMLHttpRequest");

    const response = await this.client.get(this.getAjaxUrl(chapterId), ajaxHeaders);
    const document = this.parseHtmlProperty(response);

    return document.select(this.pageListParseSelector()).map((element, index) => {
      const imgUrl = this.imgAttr(element) || this.imgAttr(element.selectFirst("img")!);
      return new Page(index, "", imgUrl);
    });
  }

  override imageRequest(page: Page) {
    const headers = this.headers;
    headers.delete("Origin");
    headers.set("Referer", page.imageUrl!);
    return { url: page.imageUrl!, headers };
  }

  // ============================= Utilities ==============================

  imgAttr(element: Element): string {
    let v: string;
    if (element.hasAttr("data-lazy-src")) v = element.attr("abs:data-lazy-src");
    else if (element.hasAttr("data-src")) v = element.attr("abs:data-src");
    else if (element.hasAttr("data-url")) v = element.attr("abs:data-url");
    else v = element.attr("abs:src");
    return v.trim();
  }

  /** Jsoup.parseBodyFragment has no base URI; the site's URL is used so relative image paths still resolve. */
  parseHtmlProperty(response: Response): Document {
    const html = response.parseAs<AjaxResponse>().html;
    return parseHtml(this.host.load, html, this.baseUrl);
  }

  // =============================== Filters ==============================

  private get sortFilterName(): string {
    return this.lang === "ja" ? "選別" : "Sort";
  }

  protected sortFilterParam = "sort";

  protected sortFilterValues(): Pair[] {
    return [
      ["Default", "default"],
      ["Latest Updated", this.sortLatestValue],
      ["Score", "score"],
      ["Name A-Z", "name-az"],
      ["Release Date", "release-date"],
      ["Most Viewed", this.sortPopularValue],
    ];
  }

  getSortFilter() {
    return new SortFilter(this.sortFilterName, this.sortFilterParam, this.sortFilterValues());
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(this.getSortFilter());
  }
}
