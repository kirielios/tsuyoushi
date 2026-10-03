// Port of keiyoushi/extensions-source src/all/myreadingmanga/MyReadingManga.kt
import {
  DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, substringAfterLast, substringBefore, substringBeforeLast, toHttpUrl, urlWithoutDomain,
  type ClientBuilder, type Element,
} from "../../../sdk/index.ts";
import { CatFilter, EnforceLanguageFilter, GenreFilter, PairingFilter, ScanGroupFilter, SearchSortTypeList, TagFilter, isUriFilter } from "./filters.ts";

const dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

const EXTENSION_REGEX = /\.(jpg|png|jpeg|webp)/;
const TITLE_REGEX = /\[[^\]]*\]/g;
const TOTAL_RESULTS_REGEX = /([\d,]+)/;

/** FilterData: name to path-segment pairs. */
interface FilterData {
  genres: [string, string][];
  tags: [string, string][];
  categories: [string, string][];
  pairings: [string, string][];
  groups: [string, string][];
}

/** android.webkit.URLUtil.isValidUrl, for the schemes the page can produce */
const isValidUrl = (url: string | null): url is string => url != null && /^https?:\/\/./i.test(url);

const randomString = (length: number): string => {
  const charPool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length }, () => charPool[Math.floor(Math.random() * charPool.length)]).join("");
};

export default class MyReadingManga extends KeiSource {
  private get siteLang(): string {
    switch (this.lang) {
      case "ar":
        return "Arabic";
      case "id":
        return "Indonesia";
      case "zh":
        return "Chinese";
      case "en":
        return "English";
      case "de":
        return "German";
      case "it":
        return "Italian";
      case "ja":
        return "Japanese";
      case "ko":
        return "Korean";
      case "pt-BR":
        return "Portuguese";
      case "ru":
        return "Russian";
      case "es":
        return "Spanish";
      case "tr":
        return "Turkish";
      case "vi":
        return "Vietnamese";
      default:
        return this.lang;
    }
  }

  private get latestLang(): string {
    return this.lang === "ja" ? "jp" : this.siteLang;
  }

  // Basic Info
  protected override configureHeaders(headers: Headers): Headers {
    headers.append("X-Requested-With", randomString(1 + Math.floor(Math.random() * 20)));
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((request) => {
      const headers = new Headers(request.headers);
      headers.delete("X-Requested-With");
      return { ...request, headers };
    });
  }

  // Popular - Random
  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/page/${page}/?s=&ep_sort=rand&ep_filter_lang=${this.siteLang}`)).asJsoup(); // Random Manga as returned by search
    return this.searchMangaParse(document);
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/lang/${this.latestLang.toLowerCase()}${page > 1 ? `/page/${page}/` : ""}`)).asJsoup(); // Home Page - Latest Manga
    const mangas = document.select("article:not(.category-video)").map((element) => this.buildManga(element.selectFirst("a[rel]")!, element.selectFirst("a.entry-image-link img")));
    const hasNextPage = document.selectFirst("li.pagination-next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const uri = toHttpUrl(`${this.baseUrl}/page/${page}/`).newBuilder().addQueryParameter("s", query);
    for (const filter of filters) {
      if (isUriFilter(filter)) filter.addToUri(uri);
      if (filter instanceof SearchSortTypeList) uri.addQueryParameter("ep_sort", ["date", "date_asc", "rand", ""][filter.state]);
    }

    return this.searchMangaParse((await this.client.get(uri.build().toString())).asJsoup());
  }

  private mangaParsedSoFar = 0;

  private searchMangaParse(document: Element): MangasPage {
    if (document.location().includes("/page/1")) this.mangaParsedSoFar = 0;
    const articles = document.select("article");
    this.mangaParsedSoFar += articles.length;
    // video posts have no readable pages
    const mangas = articles.filter((it) => !it.hasClass("category-video")).map((element) => this.buildManga(element.selectFirst("a[rel]")!, element.selectFirst("a.entry-image-link img")));
    const totalResults = Number.parseInt((TOTAL_RESULTS_REGEX.exec(document.selectFirst(".ep-search-count")?.text() ?? "")?.[1] ?? "").replaceAll(",", ""), 10);
    return new MangasPage(mangas, this.mangaParsedSoFar < (Number.isNaN(totalResults) ? 0 : totalResults));
  }

  // Build Manga From Element
  private buildManga(titleElement: Element, thumbnailElement: Element | null): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(titleElement.absUrl("href"));
    manga.title = this.cleanTitle(titleElement.text());
    if (thumbnailElement != null) manga.thumbnail_url = this.getThumbnail(this.imageOf(thumbnailElement)) ?? undefined;
    return manga;
  }

  private imageOf(element: Element): string | null {
    let url: string;
    if (EXTENSION_REGEX.test(element.attr("data-src"))) url = element.attr("abs:data-src");
    else if (EXTENSION_REGEX.test(element.attr("data-cfsrc"))) url = element.attr("abs:data-cfsrc");
    else if (EXTENSION_REGEX.test(element.attr("src"))) url = element.attr("abs:src");
    else url = element.attr("abs:data-lazy-src");

    return isValidUrl(url) ? url : null;
  }

  // removes resizing
  private getThumbnail(thumbnailUrl: string | null): string | null {
    if (thumbnailUrl == null) return null;
    const url = `${substringBeforeLast(thumbnailUrl, "-")}.${substringAfterLast(thumbnailUrl, ".")}`;
    return isValidUrl(url) ? url : null;
  }

  // cleans up the name removing author and language from the title
  private cleanTitle(title: string): string {
    return substringBeforeLast(title.replace(TITLE_REGEX, ""), "(").trim();
  }

  private cleanAuthor(author: string): string {
    return substringBefore(substringAfter(author, "["), "]").trim();
  }

  // Manga Details
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const needCover = fetchDetails && (manga.thumbnail_url != null ? !(await this.client.get(manga.thumbnail_url, undefined, { ensureSuccess: false })).isSuccessful : true);

    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const updatedManga = fetchDetails ? await this.mangaDetailsParse(document, needCover) : manga;

    return new SMangaUpdate(updatedManga, this.chapterListParse(document));
  }

  private async mangaDetailsParse(document: Element, needCover: boolean): Promise<SManga> {
    const manga = SManga.create();
    manga.title = this.cleanTitle(document.selectFirst("h1")?.text() ?? "");
    manga.author = this.cleanAuthor(document.selectFirst("h1")?.text() ?? "");
    manga.artist = manga.author;
    manga.genre = document
      .select(".entry-header p a[href*=genre], [href*=tag], span.entry-categories a")
      .map((it) => it.text())
      .join(", ");
    const basicDescription = document.selectFirst("h1")?.text();
    // too troublesome to achieve 100% accuracy assigning scanlator group during chapterListParse
    const scanlatedBy = document.selectFirst(".entry-terms:has(a[href*=group])");
    const scanlatedByText =
      scanlatedBy != null
        ? `Scanlated by: ${scanlatedBy
            .select("a[href*=group]")
            .map((it) => it.text())
            .join(", ")}`
        : null;
    const extendedDescription = document
      .select(".entry-content p:not(p:containsOwn(|)):not(.chapter-class + p)")
      .map((it) => it.text())
      .join("\n");
    manga.description = [basicDescription, scanlatedByText, extendedDescription]
      .filter((it): it is string => it != null)
      .join("\n")
      .trim();
    const status = document.selectFirst("a[href*=status]")?.text();
    manga.status = status === "Ongoing" ? SManga.ONGOING : status === "Completed" ? SManga.COMPLETED : SManga.UNKNOWN;

    if (needCover) {
      const it = (await this.client.get(`${this.baseUrl}/?s=${document.location()}`)).asJsoup().selectFirst("div.ep-search-content div.entry-content img");
      manga.thumbnail_url = (it != null ? this.getThumbnail(this.imageOf(it)) : null) ?? undefined;
    }
    return manga;
  }

  // Start Chapter Get
  private chapterListParse(document: Element): SChapter[] {
    const chapters: SChapter[] = [];

    const date = dateFormat.tryParseDate(document.selectFirst(".entry-time")?.text());
    // create first chapter since its on main manga page
    chapters.push(this.createChapter("1", document.location(), date, "Part 1"));
    // see if there are multiple chapters or not
    const lastText = document.select("a[class=page-numbers]").last()?.text();
    const lastChapterNumber = lastText != null && /^[+-]?\d+$/.test(lastText) ? Number(lastText) : null;
    if (lastChapterNumber != null) {
      // There are entries with more chapters but those never show up,
      // so we take the last one and loop it to get all hidden ones.
      // Example: 1 2 3 4 .. 7 8 9 Next
      for (let i = 2; i <= lastChapterNumber; i++) chapters.push(this.createChapter(String(i), document.location(), date, `Part ${i}`));
    }
    chapters.reverse();
    return chapters;
  }

  private createChapter(pageNumber: string, mangaUrl: string, date: number, chname: string): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(`${mangaUrl}/${pageNumber}`);
    chapter.name = chname;
    chapter.date_upload = date;
    return chapter;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const urls = [...document.select("div.entry-content img"), ...document.select("div.separator img[data-src]")]
      .map((it) => this.imageOf(it))
      .filter((it): it is string => it != null);
    return [...new Set(urls)].map((url, i) => new Page(i, "", url));
  }

  // Filter Parsing, grabs pages as document and filters out Genres, Popular Tags, and Categories, Parings, and Scan Groups
  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<FilterData> {
    const fetchFilter = async (url: string, css: string): Promise<[string, string][]> =>
      (await this.client.get(url)).asJsoup().select(css).map((it): [string, string] => [it.text(), it.attr("href").split("/").slice(0, -1).at(-1) ?? ""]);

    return {
      genres: await fetchFilter(this.baseUrl, ".tagcloud a[href*=/genre/]"),
      tags: await fetchFilter(`${this.baseUrl}/tags/`, ".tag-groups-alphabetical-index a"),
      categories: await fetchFilter(`${this.baseUrl}/cats/`, ".tag-groups-alphabetical-index a"),
      pairings: await fetchFilter(`${this.baseUrl}/pairing/`, ".tag-groups-alphabetical-index a"),
      groups: await fetchFilter(`${this.baseUrl}/group/`, ".tag-groups-alphabetical-index a"),
    };
  }

  // Generates the filter lists for app
  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new EnforceLanguageFilter(this.siteLang), new SearchSortTypeList()];

    if (data != null) {
      const it = data as FilterData;
      filters.push(new GenreFilter(it.genres));
      filters.push(new TagFilter(it.tags));
      filters.push(new CatFilter(it.categories));
      filters.push(new PairingFilter(it.pairings));
      filters.push(new ScanGroupFilter(it.groups));
    }

    return FilterList(...filters);
  }
}
