// Port of keiyoushi/extensions-source lib-multisrc/zmanga/ZManga.kt
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
  isBlank,
  isNotBlank,
  str,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../sdk/index.ts";
import { AuthorFilter, GenreList, OrderByFilter, ProjectFilter, StatusFilter, Tag, TypeFilter, YearFilter } from "./filters.ts";

export abstract class ZManga extends KeiSource {
  protected dateFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);

  // Some sites rename the advanced-search route (e.g. "advance-search").
  protected searchPath = "advanced-search";

  protected typeFilterValues: [string, string][] = [
    ["All", ""],
    ["Manga", "Manga"],
    ["Manhua", "Manhua"],
    ["Manhwa", "Manhwa"],
    ["One-Shot", "One-Shot"],
    ["Doujin", "Doujin"],
  ];

  // ============================== Popular ==============================

  override async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/${this.searchPath}/${this.pagePathSegment(page)}?order=popular`)).asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((element) => this.popularMangaFromElement(element));
    const hasNextPage = document.select(this.popularMangaNextPageSelector()).length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  popularMangaSelector() {
    return "div.flexbox2-item";
  }

  popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.select("div.flexbox2-content a").attr("abs:href"));
    manga.title = element.select("div.flexbox2-title > span").first()!.text();
    manga.thumbnail_url = element.select("img").attr("abs:src");
    return manga;
  }

  popularMangaNextPageSelector() {
    return "div.pagination .next";
  }

  // ============================== Latest ===============================

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/${this.searchPath}/${this.pagePathSegment(page)}?order=update`)).asJsoup();
    const mangas = document.select(this.latestUpdatesSelector()).map((element) => this.latestUpdatesFromElement(element));
    const hasNextPage = document.select(this.latestUpdatesNextPageSelector()).length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  latestUpdatesSelector() {
    return this.popularMangaSelector();
  }

  latestUpdatesFromElement(element: Element): SManga {
    return this.popularMangaFromElement(element);
  }

  latestUpdatesNextPageSelector() {
    return this.popularMangaNextPageSelector();
  }

  // ============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const isProjectPage = filters.some((it) => it instanceof ProjectFilter && it.toUriPart() === "project-filter-on");

    let document: Document;
    if (isBlank(query) && isProjectPage) {
      document = (await this.client.get(toHttpUrl(`${this.baseUrl}${this.projectPageString}/page/${page}`).toString())).asJsoup();
    } else {
      const url = toHttpUrl(`${this.baseUrl}/${this.searchPath}/${this.pagePathSegment(page)}`).newBuilder();
      url.addQueryParameter("title", query);
      for (const filter of filters) {
        if (filter instanceof AuthorFilter) {
          url.addQueryParameter("author", filter.state);
        } else if (filter instanceof YearFilter) {
          url.addQueryParameter("yearx", filter.state);
        } else if (filter instanceof StatusFilter) {
          const status = filter.state === Filter.TriState.STATE_INCLUDE ? "completed" : filter.state === Filter.TriState.STATE_EXCLUDE ? "ongoing" : "";
          url.addQueryParameter("status", status);
        } else if (filter instanceof TypeFilter) {
          url.addQueryParameter("type", filter.toUriPart());
        } else if (filter instanceof OrderByFilter) {
          url.addQueryParameter("order", filter.toUriPart());
        } else if (filter instanceof GenreList) {
          filter.state.filter((it) => it.state).forEach((it) => url.addQueryParameter("genre[]", it.id));
        }
      }
      document = (await this.client.get(url.build().toString())).asJsoup();
    }
    const mangas = document.select(this.searchMangaSelector()).map((element) => this.searchMangaFromElement(element));
    const hasNextPage = document.select(this.searchMangaNextPageSelector()).length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  projectPageString = "/project-list";

  searchMangaSelector() {
    return this.popularMangaSelector();
  }

  searchMangaFromElement(element: Element): SManga {
    return this.popularMangaFromElement(element);
  }

  searchMangaNextPageSelector() {
    return this.popularMangaNextPageSelector();
  }

  // ============================== Details ==============================

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const updatedManga = this.mangaDetailsParse(document);

    const updatedChapters = document.select(this.chapterListSelector()).map((element) => this.chapterFromElement(element));

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const thumb = document.select("div.series-thumb img");
    const lazy = thumb.attr("data-lazy-src");
    manga.thumbnail_url = isNotBlank(lazy) ? lazy : thumb.attr("abs:src");
    manga.author = document.select(".series-infolist li:contains(Author) span").text();
    manga.artist = document.select(".series-infolist li:contains(Artist) span").text();
    manga.status = this.parseStatus(document.select(".series-infoz .status").first()?.ownText());
    manga.description = document.select("div.series-synops").text();
    manga.genre = document
      .select("div.series-genres a")
      .map((it) => it.text())
      .join(", ");

    // add series type(manga/manhwa/manhua/other) thinggy to genre
    const type = document.select(this.seriesTypeSelector).first()?.ownText();
    if (type != null && type.length > 0 && type !== "-" && !manga.genre.toLowerCase().includes(type.toLowerCase())) {
      manga.genre = !manga.genre ? type : `${manga.genre}, ${type}`;
    }

    // add alternative name to manga description
    const alt = document.select(this.altNameSelector).first()?.ownText();
    if (alt != null && alt.length > 0) {
      manga.description = !manga.description ? this.altName + alt : `${manga.description}\n\n${this.altName}${alt}`;
    }
    return manga;
  }

  seriesTypeSelector = "div.block span.type";
  altNameSelector = ".series-title span";
  altName = "Alternative Name: ";

  // ============================= Chapters ==============================

  // careful not to include download links
  chapterListSelector() {
    return "ul.series-chapterlist div.flexch-infoz a";
  }

  chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.attr("abs:href"));
    chapter.name = element.select("span").first()!.ownText();
    chapter.date_upload = this.parseDate(element.select("span.date").text());
    return chapter;
  }

  protected parseDate(dateString: string): number {
    return this.dateFormatter.tryParseDate(dateString);
  }

  // =============================== Pages ===============================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.baseUrl + chapter.url)).asJsoup());
  }

  pageListParse(document: Document): Page[] {
    return document.select("div.reader-area img:not(noscript img)").map((img, i) => {
      const lazy = img.attr("data-lazy-src");
      const urlStr = (isBlank(lazy) ? img.attr("src") : lazy).replaceAll("\\", "");
      // img.attr("src", urlStr).attr("abs:src")
      let imageUrl = "";
      try {
        imageUrl = urlStr.trim() ? new URL(urlStr.trim(), img.baseUri).href : "";
      } catch {
        imageUrl = "";
      }
      return new Page(i, "", imageUrl);
    });
  }

  // ============================== Filters ==============================

  hasProjectPage = false;

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/${this.searchPath}/`)).asJsoup();
    return document.select('div.custom-checkbox input[name="genre[]"]').map((element) => ({
      id: element.attr("value"),
      name: element.nextElementSibling()?.text() ?? element.attr("id"),
    }));
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = Array.isArray(data) ? data.map((it: Record<string, unknown>) => new Tag(str(it["id"])!, str(it["name"])!)) : [];

    const filters: Filter[] = [
      new Filter.Header("You can combine filter."),
      new Filter.Separator(),
      new AuthorFilter(),
      new YearFilter(),
      new StatusFilter(),
      new TypeFilter(this.typeFilterValues),
      new OrderByFilter(),
      new GenreList(genres),
    ];
    if (this.hasProjectPage) {
      filters.push(new Filter.Separator(), new Filter.Header("NOTE: cant be used with other filter!"), new Filter.Header(`${this.name} Project List page`), new ProjectFilter());
    }
    return FilterList(...filters);
  }

  // ============================= Utilities =============================

  protected pagePathSegment(page: number): string {
    return page > 1 ? `page/${page}/` : "";
  }

  private parseStatus(status: string | null | undefined): number {
    if (status == null) return SManga.UNKNOWN;
    const lowerCaseStatus = status.toLowerCase();
    if (lowerCaseStatus.includes("ongoing")) return SManga.ONGOING;
    if (lowerCaseStatus.includes("completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }
}
