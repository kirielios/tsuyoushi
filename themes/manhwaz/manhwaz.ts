// Port of keiyoushi/extensions-source lib-multisrc/manhwaz/ManhwaZ.kt
import {
  Filter,
  FilterList,
  Intl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ago,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type Response,
} from "../../sdk/index.ts";
import { messages } from "./messages.ts";

export interface SelectOption {
  name: string;
  id: string;
}

class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly options: SelectOption[],
  ) {
    super(
      name,
      options.map((it) => it.name),
    );
  }
}

class GenreFilter extends SelectFilter {
  constructor(intl: Intl, genres: SelectOption[]) {
    super(intl.get("genre_filter_title"), genres);
  }
}

class OrderByFilter extends SelectFilter {
  constructor(intl: Intl) {
    super(intl.get("order_by_filter_title"), [
      { name: intl.get("order_by_latest"), id: "latest" },
      { name: intl.get("order_by_rating"), id: "rating" },
      { name: intl.get("order_by_most_views"), id: "views" },
      { name: intl.get("order_by_new"), id: "new" },
    ]);
  }
}

const ongoingStatusList = ["ongoing", "đang ra"];
const completedStatusList = ["completed", "hoàn thành", "Truyện Full"];

const secondsUnit = ["second", "seconds", "giây"];
const minutesUnit = ["minute", "minutes", "phút"];
const hourUnit = ["hour", "hours", "giờ"];
const dayUnit = ["day", "days", "ngày"];
const weekUnit = ["week", "weeks", "tuần"];
const monthUnit = ["month", "months", "tháng"];
const yearUnit = ["year", "years", "năm"];

export abstract class ManhwaZ extends KeiSource {
  protected mangaDetailsAuthorHeading = "author(s)";

  protected mangaDetailsStatusHeading = "status";

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "vi"], messages });

  protected searchPath = "search";

  // ============================== Common ======================================

  protected parseMangaPage(response: Response, selector: string, fromElement: (element: Element) => SManga, hasNextPage: boolean | null = null): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(selector).map(fromElement);
    const sel = this.latestUpdatesNextPageSelector();
    const hasNext = hasNextPage ?? (sel != null ? document.selectFirst(sel) != null : false);
    return new MangasPage(mangas, hasNext);
  }

  // ============================== Popular ======================================

  override async getPopularManga(_page: number): Promise<MangasPage> {
    const response = await this.client.get(this.baseUrl);
    return this.parseMangaPage(response, this.popularMangaSelector(), (it) => this.popularMangaFromElement(it), false);
  }

  protected popularMangaSelector() {
    return "#slide-top > .item";
  }

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst(".info-item a")!;
    manga.title = it.text();
    manga.url = urlWithoutDomain(it.attr("href"));
    manga.thumbnail_url = this.imgAttrOrNull(element.selectFirst(".img-item img"));
    return manga;
  }

  // ============================== Latest ======================================

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/?page=${page}`);
    return this.parseMangaPage(response, this.latestUpdatesSelector(), (it) => this.latestUpdatesFromElement(it));
  }

  protected latestUpdatesSelector() {
    return ".page-item-detail";
  }

  protected latestUpdatesFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst(".item-summary a")!;
    manga.title = it.text();
    manga.url = urlWithoutDomain(it.attr("href"));
    manga.thumbnail_url = this.imgAttrOrNull(element.selectFirst(".item-thumb img"));
    return manga;
  }

  protected latestUpdatesNextPageSelector(): string | null {
    return "ul.pager a[rel=next]";
  }

  // ============================== Search ======================================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (query) {
      url.addPathSegment(this.searchPath);
      url.addQueryParameter("s", query);
      url.addQueryParameter("page", String(page));
    } else {
      const genreFilter = filters.find((it): it is GenreFilter => it instanceof GenreFilter);
      const orderByFilter = filters.find((it): it is OrderByFilter => it instanceof OrderByFilter);
      const genreId = genreFilter?.options[genreFilter.state]?.id;

      if (genreFilter != null && genreFilter.state !== 0) {
        url.addPathSegments(genreId!);
      }

      // Can't sort in "All" or "Completed"
      if (orderByFilter != null && genreId?.startsWith("genre/") === true) {
        url.addQueryParameter("m_orderby", orderByFilter.options[orderByFilter.state].id);
      }

      url.addQueryParameter("page", String(page));
    }

    const response = await this.client.get(url.build().toString());
    return this.parseMangaPage(response, this.searchMangaSelector(), (it) => this.searchMangaFromElement(it));
  }

  protected searchMangaSelector() {
    return this.latestUpdatesSelector();
  }

  protected searchMangaFromElement(element: Element) {
    return this.latestUpdatesFromElement(element);
  }

  // ============================== Details ======================================

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const document = response.asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  protected parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    const statusText = document.selectFirst(`div.summary-heading:contains(${this.mangaDetailsStatusHeading}) + div.summary-content`)?.text() ?? "";

    manga.title = document.selectFirst("div.post-title h1")!.text();
    manga.author = document.selectFirst(`div.summary-heading:contains(${this.mangaDetailsAuthorHeading}) + div.summary-content`)?.text();
    manga.description = document.selectFirst("div.summary__content")?.text();
    manga.genre = document
      .select("div.genres-content a[rel=tag]")
      .map((it) => it.text())
      .join(", ");
    const lower = statusText.toLowerCase();
    if (ongoingStatusList.some((it) => lower.includes(it.toLowerCase()))) manga.status = SManga.ONGOING;
    else if (completedStatusList.some((it) => lower.includes(it.toLowerCase()))) manga.status = SManga.COMPLETED;
    else manga.status = SManga.UNKNOWN;
    manga.thumbnail_url = this.imgAttrOrNull(document.selectFirst("div.summary_image img"));
    return manga;
  }

  // ============================== Chapters ======================================

  protected parseChapterList(document: Document): SChapter[] {
    return document.select(this.chapterListSelector()).map((element) => {
      const chapter = SChapter.create();
      const it = element.selectFirst("a")!;
      chapter.url = urlWithoutDomain(it.attr("href"));
      chapter.name = it.text();

      const date = element.selectFirst("span.chapter-release-date")?.text();
      if (date != null) chapter.date_upload = this.parseRelativeDate(date);
      return chapter;
    });
  }

  protected chapterListSelector() {
    return "li.wp-manga-chapter";
  }

  // ============================== Pages ======================================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.parsePageList((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  protected pageListSelector(): string {
    return "div.page-break img";
  }

  protected parsePageList(document: Document): Page[] {
    return document.select(this.pageListSelector()).map((element, i) => new Page(i, "", this.imgAttr(element)));
  }

  // ============================== Filters ======================================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/genre`)).asJsoup();
    const genres: SelectOption[] = document.select(this.genreListSelector()).map((it) => ({
      name: it.ownText(),
      id: toHttpUrl(it.absUrl("href")).encodedPath.replace(/^\//, ""),
    }));
    return genres;
  }

  protected genreListSelector() {
    return "ul.page-genres li a";
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = data as SelectOption[] | null;

    const genreOptions: SelectOption[] = [{ name: this.intl.get("genre_all"), id: "" }, { name: this.intl.get("genre_completed"), id: "completed" }, ...(genres ?? [])];

    return FilterList(
      new Filter.Header(this.intl.get("filter_ignored_warning")),
      new Filter.Header(this.intl.format("cannot_use_order_by_warning", this.intl.get("genre_all"), this.intl.get("genre_completed"))),
      new Filter.Separator(),
      new GenreFilter(this.intl, genreOptions),
      new OrderByFilter(this.intl),
    );
  }

  private parseRelativeDate(date: string): number {
    const parts = substringBeforeLast(date, " ").split(" ");
    // Kotlin's split(" ", limit = 2) destructured into two: fewer parts throws, as does a non-numeric value
    if (parts.length < 2) throw new Error(`Index 1 out of bounds for length ${parts.length}`);
    const valueString = parts[0];
    const unit = parts.slice(1).join(" ");
    if (!/^[+-]?\d+$/.test(valueString)) throw new Error(`For input string: "${valueString}"`);
    const value = Number(valueString);

    if (secondsUnit.includes(unit)) return ago(value, "seconds");
    if (minutesUnit.includes(unit)) return ago(value, "minutes");
    if (hourUnit.includes(unit)) return ago(value, "hours");
    if (dayUnit.includes(unit)) return ago(value, "days");
    if (weekUnit.includes(unit)) return ago(value, "weeks");
    if (monthUnit.includes(unit)) return ago(value, "months");
    if (yearUnit.includes(unit)) return ago(value, "years");
    return 0;
  }

  protected imgAttr(element: Element): string {
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("srcset")) return substringBefore(element.attr("abs:srcset"), " ");
    if (element.hasAttr("data-cfsrc")) return element.attr("abs:data-cfsrc");
    return element.attr("abs:src");
  }

  /** `?.imgAttr()` */
  private imgAttrOrNull(element: Element | null): string | undefined {
    return element ? this.imgAttr(element) : undefined;
  }
}
