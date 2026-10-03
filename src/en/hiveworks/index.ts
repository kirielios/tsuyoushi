// Port of keiyoushi/extensions-source src/en/hiveworks/Hiveworks.kt (+ Filters.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  DateTimeFormatter,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  HttpUrl,
  substringAfter,
  substringBefore,
  type ClientBuilder,
  type Element,
  type Response,
} from "../../../sdk/index.ts";
import { CompletedFilter, GenreFilter, HiatusFilter, KidsFilter, OriginalsFilter, RatingFilter, SortFilter, TitleFilter, UpdateDay, UriBuilder, isUriFilter } from "./filters.ts";

const POPULAR_MANGA_SELECTOR = "div.comicblock";
const SEARCH_MANGA_SELECTOR = "div.comicblock, div.originalsblock";
const CHAPTER_LIST_SELECTOR = "select[name=comic] option";

// Java's "[MMMM][MMM] d, yyyy" (optional full or short month name): the SDK's MMMM already accepts both
const DATE_FORMATTER = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);
const AWKWARDZOMBIE_DATE_FORMAT = DateTimeFormatter.ofPattern("M-d-yy", Locale.US);

/**
 * Code that used to handle Saturday Morning Breakfast Comics has been split to its
 * own separate extension at eu.kanade.tachiyomi.extension.en.saturdaymorningbreakfastcomics
 */
export default class Hiveworks extends KeiSource {
  // Client

  protected override configureClient(builder: ClientBuilder) {
    // retryOnConnectionFailure / followRedirects are the host's defaults
    return builder.connectTimeout(60_000).readTimeout(60_000);
  }

  // Popular

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.comicBlocksParse(await this.client.get(this.baseUrl));
  }

  private comicBlocksParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document
      .select(POPULAR_MANGA_SELECTOR)
      .filter((it) => {
        const url = it.select("a.comiclink").first()!.attr("abs:href");
        return !(url.includes("sparklermonthly.com") || url.includes("explosm.net")); // Filter Unsupported Comics
      })
      .map((element) => this.mangaFromElement(element));

    return new MangasPage(mangas, false);
  }

  // Latest

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const day = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    return this.comicBlocksParse(await this.client.get(`${this.baseUrl}/home/update-day/${day}`));
  }

  // Search
  // Source's website doesn't appear to have a search function; so searching locally

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const uri = new UriBuilder(this.baseUrl);
    if (filters.length > 0) uri.appendPath("home");
    // Append uri filters
    for (const filter of filters) {
      if (isUriFilter(filter)) filter.addToUri(uri);
      else if (filter instanceof OriginalsFilter) {
        if (filter.state) return this.searchList(`${this.baseUrl}/originals`, "", (e) => this.searchOriginalMangaFromElement(e));
      } else if (filter instanceof KidsFilter) {
        if (filter.state) return this.searchList(`${this.baseUrl}/kids`);
      } else if (filter instanceof CompletedFilter) {
        if (filter.state) return this.searchList(`${this.baseUrl}/completed`);
      } else if (filter instanceof HiatusFilter) {
        if (filter.state) return this.searchList(`${this.baseUrl}/hiatus`);
      }
    }
    return this.searchList(uri.toString(), query);
  }

  private async searchList(url: string, query = "", transform: (e: Element) => SManga = (e) => this.mangaFromElement(e)): Promise<MangasPage> {
    const document = (await this.client.get(url)).asJsoup();

    const mangas = document
      .select(SEARCH_MANGA_SELECTOR)
      .filter((it) => query.length === 0 || it.text().toLowerCase().includes(query.toLowerCase()))
      .map(transform);

    return new MangasPage(mangas, false);
  }

  private searchOriginalMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.thumbnail_url = element.select("img")[1].attr("abs:src");
    manga.title = substringBefore(element.select("div.header").text(), "by").trim();
    manga.author = substringAfter(element.select("div.header").text(), "by").trim();
    manga.artist = manga.author;
    manga.description = element.select("div.description").text();
    manga.url = element.select("a").first()!.attr("href");
    return manga;
  }

  // Common

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = element.select("a.comiclink").first()!.attr("abs:href");
    manga.title = element.select("h1").text();
    manga.thumbnail_url = element.select("img").attr("abs:src");
    const by = element.select("h2").text();
    manga.artist = (by.startsWith("by") ? by.slice(2) : by).trim();
    manga.author = manga.artist;
    manga.description = element.select("div.description").text();
    manga.genre = element.select("div.comicrating").text();
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return manga.url;
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  // Details
  // Fetches details by calling home page again and using the existing url to find the correct comic

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.getWithErrors(this.baseUrl)).asJsoup();
    const found = document.select(POPULAR_MANGA_SELECTOR).find((it) => manga.url === it.select("a.comiclink").first()!.attr("abs:href"));
    return found ? this.mangaFromElement(found) : manga;
  }

  // Chapters

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    if (manga.status === SManga.LICENSED) throw new Error("Licensed - No chapters to show");

    const uri = new UriBuilder(manga.url);
    const s = uri.toString();
    if (s.includes("sssscomic")) {
      // sssscomic uses query string in url
      uri.appendQueryParameter("id", "archive");
    } else if (s.includes("awkwardzombie")) {
      uri.appendPath("awkward-zombie").appendPath("archive");
    } else if (s.includes("smbc-comics")) {
      throw new Error("Migrate to the Saturday Morning Breakfast Comics extension to read this comic");
    } else {
      uri.appendPath("comic");
      uri.appendPath("archive");
    }
    return this.chapterListParse(await this.getWithErrors(uri.toString()));
  }

  private chapterListParse(response: Response): SChapter[] {
    const url = response.url;
    if (url.includes("witchycomic")) return this.witchyChapterListParse(response);
    if (url.includes("sssscomic")) return this.ssssChapterListParse(response);
    if (url.includes("awkwardzombie")) return this.awkwardzombieChapterListParse(response);
    const document = response.asJsoup();
    const baseUrl = substringBefore(substringAfter(document.select("div script").html(), "href='"), "'");
    const elements = document.select(CHAPTER_LIST_SELECTOR);
    if (elements.length === 0) throw new Error("This comic has a unsupported chapter list");
    let chapters: SChapter[] = [];
    for (let i = 1; i < elements.length; i++) chapters.push(this.createChapter(elements[i], baseUrl));
    if (url.includes("checkpleasecomic")) chapters = chapters.filter((it) => it.name.endsWith("01") || it.name.endsWith(" 1"));
    chapters.reverse();
    return chapters;
  }

  private createChapter(element: Element, baseUrl: string | null): SChapter {
    const chapter = SChapter.create();
    chapter.name = substringAfter(element.text(), "-").trim();
    chapter.url = String(baseUrl) + element.attr("value"); // Kotlin's String? + String
    chapter.date_upload = DATE_FORMATTER.tryParseDate(substringBefore(element.text(), "-").trim());
    return chapter;
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(chapter.url);
    const url = response.url;
    const document = response.asJsoup();
    const pages: Page[] = [];

    document.select("div#cc-comicbody img").forEach((it) => {
      pages.push(new Page(pages.length, "", it.attr("src")));
    });

    // Site specific pages can be added here
    if (url.includes("sssscomic")) {
      const urlPath = document.select("img.comicnormal").attr("src");
      const urlimg = HttpUrl.parse(url).resolve(`../../${urlPath}`)?.toString();
      pages.push(new Page(pages.length, "", urlimg));
    }

    return pages;
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Only one filter can be used at a time"),
      new Filter.Separator(),
      new UpdateDay(),
      new RatingFilter(),
      new GenreFilter(),
      new TitleFilter(),
      new SortFilter(),
      new Filter.Separator(),
      new Filter.Header("Extra Lists"),
      new OriginalsFilter(),
      new KidsFilter(),
      new CompletedFilter(),
      new HiatusFilter(),
    );
  }

  // Other Code

  private awkwardzombieChapterListParse(response: Response): SChapter[] {
    const chapters: SChapter[] = [];
    response
      .asJsoup()
      .select("div.archive-line")
      .forEach((it) => {
        const chapter = SChapter.create();
        const chapterNumber = substringBefore(substringAfter(it.select(".archive-date").text(), "#"), ",");
        const n = Number(chapterNumber);
        if (chapterNumber.trim() === "" || Number.isNaN(n)) throw new Error("NumberFormatException"); // String.toFloat()
        chapter.chapter_number = n;
        chapter.name = `#${chapterNumber} ${it.select("div.archive-title").text()} (${it.select(".archive-game").text()})`;
        chapter.url = it.select("a").attr("abs:href");
        chapter.date_upload = AWKWARDZOMBIE_DATE_FORMAT.tryParseDate(substringAfter(it.select(".archive-date").text(), ", "));
        chapters.push(chapter);
      });
    return chapters;
  }

  // Gets the chapter list for witchycomic
  private witchyChapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const elements = document.select(".cc-storyline-pagethumb a");
    if (elements.length === 0) throw new Error("This comic has a unsupported chapter list");
    let chapters: SChapter[] = [];
    for (let i = 1; i < elements.length; i++) {
      const chapter = SChapter.create();
      chapter.name = `Page ${i}`;
      chapter.url = elements[i].attr("href");
      // Date upload isn't available for witchy, unfortunately. As a
      // workaround to ensure notifications work, use system time.
      chapter.date_upload = Date.now();
      chapters.push(chapter);
    }
    chapters = chapters.filter((it) => it.url.includes("page-"));
    chapters.reverse();
    return chapters;
  }

  /** Gets the chapter list for sssscomic - based on work by roblabla for witchycomic */
  private ssssChapterListParse(response: Response): SChapter[] {
    const requestUrl = HttpUrl.parse(response.url);
    const document = response.asJsoup();
    // Gets the adventure div's
    const advDiv = document.select("div[id^=adv]");
    let chapters: SChapter[] = [];
    // Iterate through the Div's
    for (let i = 1; i < advDiv.length + 1; i++) {
      const elements = document.select(`#adv${i}Div a`);
      if (elements.length === 0) throw new Error("This comic has a unsupported chapter list");
      for (let c = 0; c < elements.length; c++) {
        const chapter = SChapter.create();
        // Adventure No. and Page No. for chapter name
        chapter.name = `Adventure ${i} - Page ${elements[c].text()}`;
        // Uses relative paths so need to combine the initial host with the path
        const urlPath = elements[c].attr("href");
        chapter.url = String(requestUrl.resolve(`../../${urlPath}`));
        // use system time as the date of the chapters are per page and takes to long to pull each one.
        chapter.date_upload = Date.now();
        chapters.push(chapter);
      }
    }
    chapters = chapters.filter((it) => it.url.includes("page"));
    chapters.reverse();
    return chapters;
  }

  // Used to throw custom error codes for http codes
  private async getWithErrors(url: string): Promise<Response> {
    const response = await this.client.get(url, undefined, { ensureSuccess: false });
    if (!response.isSuccessful) {
      switch (response.code) {
        case 404:
          throw new Error("This comic has a unsupported chapter list");
        default:
          throw new Error(`HiveWorks Comics HTTP Error ${response.code}`);
      }
    }
    return response;
  }
}
