// Port of keiyoushi/extensions-source src/en/todaymanga/TodayManga.kt (+ Filters.kt)
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
  firstInstance,
  isBlank,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
} from "../../../sdk/index.ts";

// Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

class CategoryFilter extends UriPartFilter {
  constructor() {
    super("Category", [
      ["<select>", ""],
      ["Most Popular Manga", "most-popular"],
      ["Highest Rated Manga", "highest-rated"],
      ["Trending This Week", "trending"],
      ["Recent Updated Manga", "recent"],
      ["Editors' Choices", "editor-pick"],
      ["Completed Comedy Manga", "completed-comedy-manga"],
      ["Completed Drama Manga", "completed-drama-manga"],
      ["Completed Fantasy Manga", "completed-fantasy-manga"],
      ["Completed Romance Manga", "completed-romance-manga"],
    ]);
  }
}

// The site doesn't seem to list all available genres, so instead the genres
// were sampled from the first 5 pages of recently updated
class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      ["<select>", ""],
      ["Action", "action"],
      ["Adventure", "adventure"],
      ["Comedy", "comedy"],
      ["Drama", "drama"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Gender Bender", "gender-bender"],
      ["Harem", "harem"],
      ["Historical", "historical"],
      ["Horror", "horror"],
      ["Martial Arts", "martial-arts"],
      ["Mature", "mature"],
      ["Music", "music"],
      ["Mystery", "mystery"],
      ["One Shot", "one-shot"],
      ["Psychological", "psychological"],
      ["Reverse Harem", "reverse-harem"],
      ["Romance", "romance"],
      ["School Life", "school-life"],
      ["Sci fi", "sci-fi"],
      ["Seinen", "seinen"],
      ["Shoujo", "shoujo"],
      ["Shounen Ai", "shounen-ai"],
      ["Shounen", "shounen"],
      ["Slice Of Life", "slice-of-life"],
      ["Sports", "sports"],
      ["Supernatural", "supernatural"],
      ["Tragedy", "tragedy"],
      ["Vampire", "vampire"],
      ["Webtoons", "webtoons"],
    ]);
  }
}

const NEXT_PAGE = ".pagination > ul > li.active + li:has(a)";

export default class TodayManga extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2);
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ENGLISH);

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.addPage(`${this.baseUrl}/category/most-popular`, page))).asJsoup();
    const mangaList = document.select("section > main > div.series-info").map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.selectFirst(NEXT_PAGE) != null;
    return new MangasPage(mangaList, hasNextPage);
  }

  private popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("a[href]")!.attr("abs:href"));
    manga.thumbnail_url = this.imgAttr(element.selectFirst("img")!);
    manga.title = element.selectFirst(".series-name")!.text();
    return manga;
  }

  // =============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.addPage(`${this.baseUrl}/category/recent`, page))).asJsoup();
    const mangaList = document.select("ul.series > li").map((it) => this.latestUpdatesFromElement(it));
    const hasNextPage = document.selectFirst(NEXT_PAGE) != null;
    return new MangasPage(mangaList, hasNextPage);
  }

  private latestUpdatesFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.selectFirst(".series-name")!.text();
    manga.url = urlWithoutDomain(element.selectFirst("a[title][href]")!.attr("abs:href"));
    manga.thumbnail_url = this.imgAttr(element.selectFirst("img")!);
    return manga;
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categoryFilter = firstInstance(filters, CategoryFilter);
    const genreFilter = firstInstance(filters, GenreFilter);

    const builder = toHttpUrl(this.baseUrl).newBuilder();
    if (categoryFilter.state !== 0) {
      builder.addPathSegment("category");
      builder.addPathSegments(categoryFilter.toUriPart());
    } else if (genreFilter.state !== 0) {
      builder.addPathSegment("genre");
      builder.addPathSegment(genreFilter.toUriPart());
    } else if (!isBlank(query)) {
      builder.addPathSegment("search");
      builder.addQueryParameter("q", query);
    } else {
      builder.addPathSegments("category/most-popular");
    }

    if (page > 1) builder.addQueryParameter("page", String(page));

    const document = (await this.client.get(builder.build().toString())).asJsoup();
    let mangaList = document.select("section div.serie").map((it) => this.popularMangaFromElement(it));
    if (mangaList.length === 0) mangaList = document.select("ul.series > li").map((it) => this.latestUpdatesFromElement(it));

    const hasNextPage = document.selectFirst(NEXT_PAGE) != null;
    return new MangasPage(mangaList, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== toHttpUrl(this.baseUrl).host || segments[0] !== "book") return null;

    const mangaUrl = `/book/${segments[1]}`;
    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.url = mangaUrl;
    result.initialized = true;
    return result;
  }

  // =============================== Filters ==============================

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Ignored when using text search"),
      new Filter.Header("NOTE: Only one filter will be applied!"),
      new Filter.Separator(),
      new CategoryFilter(),
      new GenreFilter(),
    );
  }

  // =========================== Manga Updates ============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const details = SManga.create();
    const info = document.selectFirst(".series-info")!;
    details.title = info.selectFirst("h1")!.text();
    details.thumbnail_url = this.imgAttr(info.selectFirst("img")!);
    details.genre = info.select("*[itemprop=genre] > a").map((it) => it.text()).join(", ");
    details.author = info.select("span[itemprop=author] > span").map((it) => it.text()).join(", ");
    details.status = this.parseStatus(info.selectFirst("*:containsOwn(Status) + *"));

    let description = "";
    const summary = document.selectFirst(".series-summary")!;
    for (const node of (summary.node as unknown as { children: { type: string; name?: string; data?: string }[] }).children) {
      // TextNode.text() normalises whitespace
      if (node.type === "text") description += (node.data ?? "").replace(/\s+/g, " ");
      if (node.name === "br") description += "\n";
    }
    const extra = summary.selectFirst("div[style]");
    if (extra) description += `\n\n${extra.text()}`;
    details.description = description.trim();

    const chapters = document.select("#chapList > li").map((element) => {
      const chapter = SChapter.create();
      const link = element.selectFirst("a")!;
      chapter.url = urlWithoutDomain(link.attr("abs:href"));
      chapter.name = element.selectFirst("strong")?.text() ?? link.text();

      const dateText = element.selectFirst("span.muted")?.text();
      if (dateText == null) chapter.date_upload = 0;
      else if (dateText.includes("ago")) chapter.date_upload = this.parseRelativeDate(dateText);
      else chapter.date_upload = this.dateFormat.tryParseDate(dateText);
      return chapter;
    });

    return new SMangaUpdate(details, chapters);
  }

  private parseStatus(element: Element | null): number {
    switch (element?.text().toLowerCase()) {
      case "complete":
        return SManga.COMPLETED;
      case "on going":
        return SManga.ONGOING;
      default:
        return SManga.UNKNOWN;
    }
  }

  private parseRelativeDate(text: string): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const first = text.split(" ")[0]?.replace("one", "1").replace("a", "1");
    const relativeDate = first !== undefined && /^[+-]?\d+$/.test(first) ? Number.parseInt(first, 10) : null;
    if (relativeDate === null) return 0;

    if (text.includes("second")) now.setSeconds(now.getSeconds() - relativeDate);
    else if (text.includes("minute")) now.setMinutes(now.getMinutes() - relativeDate);
    else if (text.includes("hour")) now.setHours(now.getHours() - relativeDate);
    else if (text.includes("day")) now.setDate(now.getDate() - relativeDate);
    else if (text.includes("week")) now.setDate(now.getDate() - relativeDate * 7);
    else if (text.includes("month")) now.setMonth(now.getMonth() - relativeDate);
    else if (text.includes("year")) now.setFullYear(now.getFullYear() - relativeDate);
    return now.getTime();
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();

    return document
      .select(".chapter-content > img[data-index]")
      .map((img) => new Page(Number.parseInt(img.attr("data-index"), 10), "", this.imgAttr(img)))
      .sort((a, b) => a.index - b.index);
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const imgHeaders = this.headersBuilder();
    imgHeaders.append("Accept", "image/avif,image/webp,*/*");
    imgHeaders.append("Host", toHttpUrl(page.imageUrl!).host);
    return { url: page.imageUrl!, headers: imgHeaders };
  }

  // ============================= Utilities ==============================

  private addPage(url: string, page: number): string {
    const b = toHttpUrl(url).newBuilder();
    if (page > 1) b.addQueryParameter("page", String(page));
    return b.build().toString();
  }

  private imgAttr(el: Element): string {
    if (el.hasAttr("data-lazy-src")) return el.attr("abs:data-lazy-src");
    if (el.hasAttr("data-src")) return el.attr("abs:data-src");
    return el.attr("abs:src");
  }
}
