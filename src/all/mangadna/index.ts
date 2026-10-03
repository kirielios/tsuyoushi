// Port of keiyoushi/extensions-source src/all/mangadna/MangaDNA.kt (+ Filters.kt)
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
  firstInstanceOrNull,
  toHttpUrl,
  trimEnd,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList as FilterListType,
} from "../../../sdk/index.ts";

// --- Filters.kt
const GENRES_LIST: [string, string][] = [
  ["Any", ""],
  ["Action", "action"],
  ["Adult", "adult"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Cooking", "cooking"],
  ["Crime", "crime"],
  ["Drama", "drama"],
  ["Fantasy", "fantasy"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Isekai", "isekai"],
  ["Magic", "magic"],
  ["Magical", "magical"],
  ["Manhua", "manhua"],
  ["Manhwa", "manhwa"],
  ["Martial Arts", "martial-arts"],
  ["Mature", "mature"],
  ["Mystery", "mystery"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci-fi", "sci-fi"],
  ["Shounen", "shounen"],
  ["Shounen Ai", "shounen-ai"],
  ["Slice of Life", "slice-of-life"],
  ["Supernatural", "supernatural"],
  ["Thriller", "thriller"],
  ["Uncensored", "uncensored"],
];

const SORTS_LIST: [string, string][] = [
  ["Latest", "latest"],
  ["A-Z", "alphabet"],
  ["Rating", "rating"],
  ["Trending", "trending"],
];

class SelectFilter extends Filter.Select<string> {
  constructor(name: string, private readonly options: [string, string][]) {
    super(name, options.map((it) => it[0]));
  }
  get selected(): string {
    return this.options[this.state][1];
  }
}
class GenreFilter extends SelectFilter {}
class SortFilter extends SelectFilter {}

const getFilters = (): FilterListType =>
  FilterList(new Filter.Header("Filters are ignored when searching by query."), new GenreFilter("Genre", GENRES_LIST), new SortFilter("Sort by", SORTS_LIST));

// --- MangaDNA.kt
export default class MangaDNA extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.mangaListParse((await this.client.get(`${this.baseUrl}/manga/page/${page}?orderby=rating`)).asJsoup());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.mangaListParse((await this.client.get(`${this.baseUrl}/manga/page/${page}?orderby=latest`)).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) {
      const url = toHttpUrl(`${this.baseUrl}/search`)!.newBuilder().addQueryParameter("q", trimmedQuery).addQueryParameter("page", String(page)).build();
      return this.mangaListParse((await this.client.get(url.toString())).asJsoup());
    }

    const genre = firstInstanceOrNull(filters, GenreFilter)?.selected;
    const sort = firstInstanceOrNull(filters, SortFilter)?.selected;

    const builder = !genre ? toHttpUrl(`${this.baseUrl}/manga/page/${page}`)!.newBuilder() : toHttpUrl(`${this.baseUrl}/manga-genre/${genre}/${page}`)!.newBuilder();
    if (sort) builder.addQueryParameter("orderby", sort);
    return this.mangaListParse((await this.client.get(builder.build().toString())).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || segments[0] !== "manga") return null;
    const slug = segments[1];
    if (!slug) return null;

    const manga = SManga.create();
    manga.url = `/manga/${slug}`;
    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    return result;
  }

  private mangaListParse(document: Document): MangasPage {
    const cards = document.select("div.home-item");
    const filtered = this.lang === "en" ? cards.filter((it) => !this.isRaw(it)) : cards;
    const mangas = filtered.map((card) => {
      const manga = SManga.create();
      const link = card.selectFirst("h3.htitle a, .hthumb a")!;
      manga.url = urlWithoutDomain(link.attr("abs:href"));
      manga.title = link.attr("title").trim() ? link.attr("title") : link.text();
      const img = card.selectFirst("img");
      manga.thumbnail_url = img == null ? undefined : this.imgAttr(img);
      return manga;
    });
    const hasNextPage = document.selectFirst("ul.pagination li.next:not(.disabled) a") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private isRaw(element: Element): boolean {
    const href = element.selectFirst("a[href]")?.attr("href");
    return href != null && trimEnd(href, "/").endsWith("-raw");
  }

  // Details and chapters share the manga page, so both are always parsed from one request.
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.mangaDetailsParse(document);
    details.url = manga.url;
    return new SMangaUpdate(details, this.chapterListParse(document));
  }

  private mangaDetailsParse(document: Document): SManga {
    const info = document.selectFirst("div.summary_content_wrap, div.tab-summary") ?? document;

    const manga = SManga.create();
    const title = document.selectFirst("h1.entry-title")?.text() ?? document.selectFirst("div.post-title h1, h1")?.text();
    if (title == null) throw new Error("Title not found");
    manga.title = title;

    const img = document.selectFirst("div.summary_image img");
    manga.thumbnail_url = (img == null ? undefined : this.imgAttr(img)) ?? document.selectFirst("meta[property=og:image]")?.attr("content");

    // Labels arrive with/without trailing colons inconsistently — normalize.
    const rows = new Map<string, string>();
    for (const item of info.select("div.post-content_item")) {
      const label = trimEnd(item.selectFirst(".summary-heading")?.text() ?? "", ":").trim();
      const value = (item.selectFirst(".summary-content")?.text() ?? "").trim();
      rows.set(label, value);
    }

    // Author / Artist / Genre values arrive as concatenated <a> text without
    // separators in the parent `.text()`, so pick the anchors individually.
    const author = info.select("div.author-content a").map((it) => it.text()).join(", ");
    manga.author = author.length > 0 && author !== "Updating" ? author : undefined;
    const artist = info.select("div.artist-content a").map((it) => it.text()).join(", ");
    manga.artist = artist.length > 0 && artist !== "Updating" ? artist : undefined;

    const genreNames = info.select("div.genres-content a").map((it) => it.text().trim()).filter((it) => it.length > 0);
    const typeRow = rows.get("Type");
    const type = typeRow && typeRow !== "Updating" ? typeRow : undefined;
    manga.genre = [...new Set([...genreNames, ...(type != null ? [type] : [])])].join(", ") || undefined;

    manga.status = this.parseStatus(rows.get("Status"));
    manga.description = this.buildDescription(document, info, rows) ?? undefined;
    return manga;
  }

  private buildDescription(doc: Document, info: Element, rows: Map<string, string>): string | null {
    const synopsis = doc.selectFirst("meta[property=og:description]")?.attr("content").trim() ?? doc.selectFirst("div.summary__content, div.dsct, div.manga-content p")?.text();

    const rating = info.selectFirst("#averagerate")?.text().trim();
    const ratingMax = info.selectFirst("[property=bestRating]")?.text().trim() ?? "5";
    const ratingVotes = info.selectFirst("#countrate")?.text().trim();
    let ratingLine: string | undefined;
    if (rating) ratingLine = ratingVotes ? `Rating: ${rating} / ${ratingMax} (${ratingVotes} votes)` : `Rating: ${rating} / ${ratingMax}`;

    const parts: string[] = [];
    if (synopsis) parts.push(synopsis);
    const alt = rows.get("Alternative");
    if (alt && alt !== "Updating") parts.push(`Alternative: ${alt}`);
    const release = rows.get("Release");
    if (release) parts.push(`Released: ${release}`);
    if (ratingLine) parts.push(ratingLine);
    return parts.join("\n\n") || null;
  }

  private chapterListParse(document: Document): SChapter[] {
    return document.select("ul.row-content-chapter li.a-h").map((li) => {
      const chapter = SChapter.create();
      const link = li.selectFirst("a.chapter-name, a")!;
      chapter.url = urlWithoutDomain(link.attr("abs:href"));
      chapter.name = link.text();
      const time = li.selectFirst(".chapter-time");
      const title = time?.attr("title");
      const raw = title ? title : (time?.text() ?? "");
      chapter.date_upload = this.dateFormat.tryParseDate(raw);
      return chapter;
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.read-content img").map((img, i) => new Page(i, "", this.imgAttr(img)));
  }

  override getFilterList(_data: unknown = null): FilterListType {
    return getFilters();
  }

  private parseStatus(raw: string | undefined): number {
    switch (raw?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
      case "complete":
      case "finished":
        return SManga.COMPLETED;
      case "hiatus":
      case "on hiatus":
      case "on hold":
        return SManga.ON_HIATUS;
      case "cancelled":
      case "canceled":
      case "dropped":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private imgAttr(element: Element): string {
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    return element.attr("abs:src");
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("dd MMM yy", Locale.ENGLISH);
}
