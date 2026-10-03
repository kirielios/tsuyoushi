// Port of keiyoushi/extensions-source src/en/mangademon/MangaDemon.kt (+ Filters.kt)
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
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type FilterList as FilterListType,
  type HttpUrl,
} from "../../../sdk/index.ts";

const DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ENGLISH);

// --- Filters.kt
abstract class SelectFilter extends Filter.Select<string> {
  constructor(name: string, private readonly options: [string, string][]) {
    super(name, options.map((it) => it[0]));
  }
  get selected() {
    return this.options[this.state][1];
  }
}

class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", "all"],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}

class SortFilter extends SelectFilter {
  constructor() {
    super("Sort", [
      ["Top Views", "VIEWS DESC"],
      ["A To Z", "NAME ASC"],
    ]);
  }
}

class CheckBoxFilter extends Filter.CheckBox {
  constructor(name: string, readonly value: string) {
    super(name);
  }
}

const genres: [string, string][] = [
  ["Action", "1"],
  ["Adventure", "2"],
  ["Comedy", "3"],
  ["Cooking", "34"],
  ["Doujinshi", "25"],
  ["Drama", "4"],
  ["Ecchi", "19"],
  ["Fantasy", "5"],
  ["Gender Bender", "30"],
  ["Harem", "10"],
  ["Historical", "28"],
  ["Horror", "8"],
  ["Isekai", "33"],
  ["Josei", "31"],
  ["Martial Arts", "6"],
  ["Mature", "22"],
  ["Mecha", "32"],
  ["Mystery", "15"],
  ["One Shot", "26"],
  ["Psychological", "11"],
  ["Romance", "12"],
  ["School Life", "13"],
  ["Sci-fi", "16"],
  ["Seinen", "17"],
  ["Shoujo", "14"],
  ["Shoujo Ai", "23"],
  ["Shounen", "7"],
  ["Shounen Ai", "29"],
  ["Slice of Life", "21"],
  ["Smut", "27"],
  ["Sports", "20"],
  ["Supernatural", "9"],
  ["Tragedy", "18"],
  ["Webtoons", "24"],
];

class GenreFilter extends Filter.Group<CheckBoxFilter> {
  constructor() {
    super("Genre", genres.map((it) => new CheckBoxFilter(it[0], it[1])));
  }
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

const getFilters = () => FilterList(new Filter.Header("Ignored when using text search"), new Filter.Separator(), new SortFilter(), new StatusFilter(), new GenreFilter());

// --- MangaDemon.kt
export default class MangaDemon extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(6, 1000, (url) => url.toString().includes("images/thumbnails")).rateLimit(2);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.mangaList(toHttpUrl(`${this.baseUrl}/advanced.php?list=${page}&status=all&orderby=VIEWS%20DESC`)!);
  }

  private async mangaList(url: HttpUrl): Promise<MangasPage> {
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select("div#advanced-content > div.advanced-element").map((element) => {
      const manga = SManga.create();
      manga.url = this.encodedAttr(element.selectFirst("a")!, "href");
      manga.title = element.selectFirst("h1")!.ownText();
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      return manga;
    });
    const hasNextPage = document.selectFirst("div.pagination > ul > a > li:contains(Next)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/lastupdates.php?list=${page}`)).asJsoup();
    const mangas = document.select("div#updates-container > div.updates-element:not(:has(.toffee-badge))").map((element) => {
      const manga = SManga.create();
      const info = element.selectFirst("div.updates-element-info")!;
      manga.url = this.encodedAttr(info.selectFirst("a")!, "href");
      manga.title = info.selectFirst("a")!.ownText();
      manga.thumbnail_url = element.selectFirst("div.thumb img")!.attr("abs:src");
      return manga;
    });
    const hasNextPage = document.selectFirst("div.pagination > ul > a > li:contains(Next)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    if (query.length === 0) return this.mangaList(this.filterSearchUrl(page, filters));

    const url = toHttpUrl(`${this.baseUrl}/search.php`)!.newBuilder().addQueryParameter("manga", query).build();
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select("body > a[href]").map((element) => {
      const manga = SManga.create();
      manga.url = this.encodedAttr(element, "href");
      manga.title = element.selectFirst("div.seach-right > div")!.ownText();
      manga.thumbnail_url = element.selectFirst("img")!.attr("abs:src");
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  private filterSearchUrl(page: number, filters: FilterListType): HttpUrl {
    const b = toHttpUrl(`${this.baseUrl}/advanced.php`)!.newBuilder();
    b.addQueryParameter("list", String(page));
    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        for (const genre of filter.checked) b.addQueryParameter("genre[]", genre);
      } else if (filter instanceof StatusFilter) {
        b.addQueryParameter("status", filter.selected);
      } else if (filter instanceof SortFilter) {
        b.addQueryParameter("orderby", filter.selected);
      }
    }
    return b.build();
  }

  override getFilterList(_data: unknown = null): FilterListType {
    return getFilters();
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const info = document.selectFirst("div#manga-info-container")!;
    manga.title = info.selectFirst("h1.big-fat-titles")!.ownText();
    manga.thumbnail_url = info.selectFirst("div#manga-page img")!.attr("abs:src");
    manga.genre = info.select("div.genres-list > li").map((it) => it.text()).join(", ");
    manga.description = info.selectFirst("div#manga-info-rightColumn > div > div.white-font")!.text();
    manga.author = this.parseAuthor(info.select("div#manga-info-stats > div:has(> li:eq(0):contains(Author)) > li:eq(1)").text());
    manga.status = this.parseStatus(info.select("div#manga-info-stats > div:has(> li:eq(0):contains(Status)) > li:eq(1)").text());

    const chapterList = document.select("div#chapters-list a.chplinks").map((element) => {
      const chapter = SChapter.create();
      chapter.url = this.encodedAttr(element, "href");
      chapter.name = element.ownText();
      chapter.date_upload = DATE_FORMATTER.tryParseDate(element.selectFirst("span")?.ownText());
      return chapter;
    });

    return new SMangaUpdate(manga, chapterList);
  }

  private parseAuthor(author: string | null): string | undefined {
    return author == null || author.toLowerCase().includes("updating") ? undefined : author;
  }

  private parseStatus(status: string | null): number {
    if (status == null) return SManga.UNKNOWN;
    if (status.toLowerCase().includes("ongoing")) return SManga.ONGOING;
    if (status.toLowerCase().includes("completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div > img.imgholder").map((element, i) => new Page(i, "", element.attr("abs:src")));
  }

  /**
   * setUrlWithoutDomain(element.encodedAttr("href")): URLEncoder.encode(href) then Mihon's URI(...).path, which decodes
   * the %XX escapes again; what is left is the href with spaces turned into '+'.
   */
  private encodedAttr(element: Element, attribute: string): string {
    return urlWithoutDomain(element.attr(attribute).replaceAll(" ", "+"));
  }
}
