// Port of keiyoushi/extensions-source lib-multisrc/wpcomics/WPComics.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  Intl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneId,
  ago,
  isBlank,
  isNotBlank,
  substringAfterLast,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type Response,
  type Zone,
} from "../../sdk/index.ts";
import { messages } from "./messages.ts";

export type Pair = [string | null, string];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly pairs: Pair[],
  ) {
    super(
      displayName,
      pairs.map((it) => it[1]),
    );
  }
  toUriPart() {
    return this.pairs[this.state][0];
  }
}
export class StatusFilter extends UriPartFilter {}
export class GenreFilter extends UriPartFilter {}

const doesInclude = (list: string[], thisWord: string) => list.some((it) => it.toLowerCase().includes(thisWord.toLowerCase()));
const containsAny = (s: string, words: string[]) => words.some((it) => s.toLowerCase().includes(it.toLowerCase()));

export abstract class WPComics extends KeiSource {
  protected dateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm - dd/MM/yyyy Z", Locale.US);

  protected gmtOffset: string | null = "+0500";

  protected dateZone: Zone = ZoneId.systemDefault();

  protected override configureHeaders(headers: Headers): Headers {
    headers.delete("Origin");
    return headers;
  }

  readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "vi", "ja"], messages });

  // ============================== Common ======================================

  protected parseMangaPage(response: Response, selector: string, fromElement: (element: Element) => SManga): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(selector).map(fromElement);
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Popular ======================================

  popularPath = "hot";

  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = `${this.baseUrl}/${this.popularPath}` + (page > 1 ? `?page=${page}` : "");
    return this.parseMangaPage(await this.client.get(url), this.popularMangaSelector(), (it) => this.popularMangaFromElement(it));
  }

  protected popularMangaSelector() {
    return "div.items div.item";
  }

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.select("h3 a");
    manga.title = it.text();
    manga.url = urlWithoutDomain(it.attr("abs:href"));
    manga.thumbnail_url = this.imageOrNull(element.select("div.image:first-of-type img").first()!) ?? undefined;
    return manga;
  }

  protected popularMangaNextPageSelector() {
    return "a.next-page, a[rel=next]";
  }

  // ============================== Latest ======================================

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.baseUrl + (page > 1 ? `?page=${page}` : "");
    return this.parseMangaPage(await this.client.get(url), this.latestUpdatesSelector(), (it) => this.latestUpdatesFromElement(it));
  }

  protected latestUpdatesSelector() {
    return this.popularMangaSelector();
  }

  protected latestUpdatesFromElement(element: Element): SManga {
    return this.popularMangaFromElement(element);
  }

  // ============================== Search ======================================

  protected searchPath = "tim-truyen";
  protected queryParam = "keyword";

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const b = toHttpUrl(`${this.baseUrl}/${this.searchPath}`).newBuilder();
    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        const it = filter.toUriPart();
        if (it != null) b.addPathSegment(it);
      } else if (filter instanceof StatusFilter) {
        const it = filter.toUriPart();
        if (it != null) b.addQueryParameter("status", it);
      }
    }
    b.addQueryParameter(this.queryParam, query);
    b.addQueryParameter("page", String(page));
    b.addQueryParameter("sort", "0");

    return this.parseMangaPage(await this.client.get(b.build().toString()), this.searchMangaSelector(), (it) => this.searchMangaFromElement(it));
  }

  protected searchMangaSelector() {
    return "div.items div.item";
  }

  protected searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.select("h3 a");
    manga.title = it.text();
    manga.url = urlWithoutDomain(it.attr("abs:href"));
    manga.thumbnail_url = this.imageOrNull(element.select("div.image a img").first()!) ?? undefined;
    return manga;
  }

  // ============================== Details ======================================

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    return this.mangaUpdateParse(await this.client.get(this.getMangaUrl(manga)), manga, chapters);
  }

  protected async mangaUpdateParse(response: Response, _manga: SManga, _chapters: SChapter[]): Promise<SMangaUpdate> {
    const document = response.asJsoup();
    const updatedManga = this.mangaDetailsParse(document);
    const updatedChapters = document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  protected mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const info = document.selectFirst("article#item-detail");
    if (info) {
      manga.author = info.select("li.author p.col-xs-8").text();
      manga.status = this.toStatus(info.select("li.status p.col-xs-8").text());
      manga.genre = info
        .select("li.kind p.col-xs-8 a")
        .map((it) => it.text())
        .join(", ");
      manga.thumbnail_url = this.imageOrNull(info.selectFirst("div.col-image img")!) ?? undefined;
      const otherName = info.select("h2.other-name").text();
      manga.description =
        info
          .select("div.detail-content p")
          .map((it) => it.wholeText().trim())
          .join("\n") + (isNotBlank(otherName) ? `\n\n${this.intl.get("OTHER_NAME")}: ${otherName}` : "");
    }
    return manga;
  }

  toStatus(s: string | null | undefined): number {
    const ongoingWords = ["Ongoing", "Updating", "Đang tiến hành", "Đang cập nhật", "Đang thực hiện", "Đang ra", "連載中"];
    const completedWords = ["Complete", "Completed", "Hoàn thành", "Đã hoàn thành", "Full", "Truyện Full", "完結済み"];
    const hiatusWords = ["Tạm Ngưng", "Tạm Hoãn"];
    if (s == null) return SManga.UNKNOWN;
    if (doesInclude(ongoingWords, s)) return SManga.ONGOING;
    if (doesInclude(completedWords, s)) return SManga.COMPLETED;
    if (doesInclude(hiatusWords, s)) return SManga.ON_HIATUS;
    return SManga.UNKNOWN;
  }

  // ============================== Chapters ======================================

  protected chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const it = element.select("a");
    chapter.name = it.text();
    chapter.url = urlWithoutDomain(it.attr("href"));
    chapter.date_upload = this.toDate(element.select("div.col-xs-4").text());
    return chapter;
  }

  protected chapterListSelector() {
    return "div.list-chapter li.row:not(.heading)";
  }

  protected toDate(s: string | null | undefined): number {
    if (s == null) return 0;

    const secondWords = ["second", "giây"];
    const minuteWords = ["minute", "phút", "分"];
    const hourWords = ["hour", "giờ", "時間"];
    const dayWords = ["day", "ngày", "日"];
    const weekWords = ["week", "tuần", "週間"];
    const monthWords = ["month", "tháng", "月"];
    const yearWords = ["year", "năm"];
    const agoWords = ["ago", "trước", "前"];

    try {
      if (containsAny(s, agoWords)) {
        const m = /(\d+)/.exec(s);
        if (!m) return 0;
        const amount = Number(m[1]);
        // ponytail: ZonedDateTime.now(dateZone).minusX is ago() in UTC; zone only matters across DST shifts
        if (containsAny(s, yearWords)) return ago(amount, "years");
        if (containsAny(s, monthWords)) return ago(amount, "months");
        if (containsAny(s, dayWords)) return ago(amount, "days");
        if (containsAny(s, weekWords)) return ago(amount, "weeks");
        if (containsAny(s, hourWords)) return ago(amount, "hours");
        if (containsAny(s, minuteWords)) return ago(amount, "minutes");
        if (containsAny(s, secondWords)) return ago(amount, "seconds");
        return Date.now();
      }
      const it = this.gmtOffset == null ? substringAfterLast(s, " ") : `${s} ${this.gmtOffset}`;
      // timestamp has year
      if (/\d+[-/.]\d+[-/.]\d\d/.test(it)) return this.parseDate(it);
      // MangaSum - timestamp sometimes doesn't have year (current year implied)
      const delimiter = it.includes("-") ? "-" : it.includes(".") ? "." : "/";
      return this.parseDate(`${it}${delimiter}${new Date().getFullYear() % 100}`);
    } catch {
      return 0;
    }
  }

  protected parseDate(date: string): number {
    return this.dateFormat.tryParseZonedDateTime(date) || this.dateFormat.tryParseDateTime(date, this.dateZone) || this.dateFormat.tryParseDate(date, this.dateZone);
  }

  // ============================== Pages ======================================

  imageOrNull(element: Element): string | null {
    // sources sometimes have an image element with an empty attr that isn't really an image
    const hasValidAttr = (attr: string) => !isBlank(element.attr(attr)) && /^https?:\/\/.*$/i.test(element.attr(`abs:${attr}`));

    if (hasValidAttr("data-original")) return element.attr("abs:data-original");
    if (hasValidAttr("data-src")) return element.attr("abs:data-src");
    if (hasValidAttr("src")) return element.attr("abs:src");
    return null;
  }

  pageListSelector = "div.page-chapter > img, li.blocks-gallery-item img";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.parsePageList(await this.client.get(this.getChapterUrl(chapter)));
  }

  protected async parsePageList(response: Response): Promise<Page[]> {
    const document = response.asJsoup();
    const images = document
      .select(this.pageListSelector)
      .map((img) => this.imageOrNull(img))
      .filter((it): it is string => it != null);
    return [...new Set(images)].map((image, i) => new Page(i, "", image));
  }

  // ============================== Filters ======================================

  protected getStatusList(): Pair[] {
    return [
      [null, this.intl.get("STATUS_ALL")],
      ["1", this.intl.get("STATUS_ONGOING")],
      ["2", this.intl.get("STATUS_COMPLETED")],
    ];
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.parseGenres((await this.client.get(`${this.baseUrl}/${this.searchPath}`)).asJsoup());
  }

  protected genresSelector = ".genres ul.nav li:not(.active) a";

  protected genresUrlDelimiter = "/";

  protected parseGenres(document: Document): Pair[] {
    const items = document.select(this.genresSelector);
    return [[null, this.intl.get("STATUS_ALL")], ...items.map((it): Pair => [substringAfterLast(it.attr("href").replace(/\/$/, ""), this.genresUrlDelimiter), it.text()])];
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as Pair[] | null) ?? [];
    return this.getFilterListOf(genres);
  }

  /** getFilterList(genres) upstream; renamed because TypeScript has no overloads by type. */
  protected getFilterListOf(genres: Pair[]): FilterList {
    const list: Filter[] = [new StatusFilter(this.intl.get("STATUS"), this.getStatusList())];
    if (genres.length) list.push(new GenreFilter(this.intl.get("GENRE"), genres));
    return list;
  }
}
