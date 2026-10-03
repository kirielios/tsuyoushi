// Port of keiyoushi/extensions-source src/en/mangareadercc/MangaReaderIN.kt
import {
  DateTimeFormatter, Filter, FilterList, HttpSource, Locale, MangasPage, Page, SChapter, SManga, distinctBy, substringAfter, substringBefore, toHttpUrl, urlWithoutDomain,
  type ClientBuilder, type Element, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET } from "../../../sdk/httpsource.ts";
import { GenreFilter, OrderFilter } from "./filters.ts";

const currentYear = String(new Date().getFullYear()).slice(-2);
const dateFormat = DateTimeFormatter.ofPattern("MMM d yy", Locale.US);

export default class MangaReaderIN extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  /**
   * The chapter list interceptor tells chapterListParse the manga title upstream through an X-Manga-Title request header
   * (Response.request.header); our Response carries no request, so the title is kept here, keyed by the ajax URL.
   */
  private readonly mangaTitles = new Map<string, string>();

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const url = toHttpUrl(request.url);
      if (url.fragment !== "chapterList") return chain.proceed(request);

      const htmlRequest: Request = { ...request, url: url.newBuilder().fragment(null).build().toString() };
      const htmlResponse = await chain.proceed(htmlRequest);
      const document = htmlResponse.asJsoup();
      const script = document.selectFirst("script:containsData(var mangaID)")?.data();
      if (script == null) return htmlResponse.withBody(new Uint8Array());
      const mangaId = substringBefore(substringAfter(script, "var mangaID = '"), "';");

      const mangaTitle = document.selectFirst("div.manga-detail h1")?.text() ?? "";
      const xhrUrl = `${this.baseUrl}/ajax-list-chapter?mangaID=${mangaId}`;
      this.mangaTitles.set(xhrUrl, mangaTitle);
      return chain.proceed(GET(xhrUrl, this.headers));
    });
  }

  // ============================== Popular ==============================
  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/popular-manga?page=${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document
      .select(this.popularMangaSelector())
      .map((it) => this.popularMangaFromElement(it))
      .filter((it): it is SManga => it != null);
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private popularMangaSelector() {
    return "div.anipost";
  }

  private popularMangaFromElement(element: Element): SManga | null {
    const a = element.selectFirst("a:has(h3)");
    if (a == null) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(a.absUrl("href"));
    manga.title = a.text();
    manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
    return manga;
  }

  private popularMangaNextPageSelector() {
    return "a[rel=next]";
  }

  // ============================== Latest ===============================

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/latest-manga?page=${page}`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Search ===============================
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (query.trim() !== "") return GET(`${this.baseUrl}/search?s=${query}&post_type=manga&page=${page}`, this.headers);

    const url = toHttpUrl(`${this.baseUrl}/genres/`).newBuilder();
    for (const filter of filters) {
      if (filter instanceof GenreFilter) url.addPathSegment(filter.toUriPart());
      else if (filter instanceof OrderFilter) url.addQueryParameter("orderby", filter.toUriPart());
    }
    url.addQueryParameter("page", String(page));
    return GET(url.build().toString(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Details ==============================
  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst(".animeinfo .rm h1")!.text();
    manga.thumbnail_url = document.selectFirst(".animeinfo .lm img")?.attr("abs:src");
    for (const element of document.select(".listinfo li")) {
      const text = element.text();
      if (text.startsWith("Author")) manga.author = substringAfter(text, ":").trim();
      else if (text.startsWith("Artist")) manga.artist = substringAfter(text, ":").trim().replaceAll(";", ",");
      else if (text.startsWith("Genre")) manga.genre = substringAfter(text, ":").trim().replaceAll(";", ",");
      else if (text.startsWith("Status")) manga.status = this.toStatus(substringAfter(text, ":").trim());
    }
    manga.description = document
      .select("#noidungm")
      .map((it) => it.text())
      .join("\n");
    return manga;
  }

  private toStatus(s: string | null): number {
    if (s == null) return SManga.UNKNOWN;
    const l = s.toLowerCase();
    if (l.includes("ongoing")) return SManga.ONGOING;
    if (l.includes("completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  // ============================= Chapters ==============================

  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}${manga.url}#chapterList`, this.headers);
  }

  private chapterListSelector() {
    return "li";
  }

  protected chapterListParse(response: Response): SChapter[] {
    const mangaTitle = this.mangaTitles.get(response.url) ?? "";
    const chapters = response
      .asJsoup()
      .select(this.chapterListSelector())
      .map((it) => this.chapterFromElement(it, mangaTitle))
      .filter((it): it is SChapter => it != null);
    return distinctBy(chapters, (it) => it.url);
  }

  private chapterFromElement(element: Element, mangaTitle: string): SChapter | null {
    const leftoff = element.selectFirst(".leftoff");
    if (leftoff == null) return null;
    const a = leftoff.selectFirst("a");
    if (a == null) return null;
    const chapter = SChapter.create();
    chapter.name = substringAfter(leftoff.text(), `${mangaTitle} `);
    chapter.url = urlWithoutDomain(a.absUrl("href"));
    chapter.date_upload = this.toDate(element.selectFirst(".rightoff")?.text());
    return chapter;
  }

  protected toDate(s: string | null | undefined): number {
    if (s == null) return 0;
    try {
      const lower = s.toLowerCase();
      if (lower.includes("yesterday")) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.getTime();
      }
      if (lower.includes("ago")) {
        const trimmedDate = substringBefore(s, " ago").replace(/s$/, "").split(" ");
        const n = Number.parseInt(trimmedDate[0], 10);
        const num = /^[+-]?\d+$/.test(trimmedDate[0]) ? n : 1;
        const d = new Date();
        switch (trimmedDate[1]) {
          case "day":
            d.setDate(d.getDate() - num);
            break;
          case "hour":
            d.setHours(d.getHours() - num);
            break;
          case "minute":
            d.setMinutes(d.getMinutes() - num);
            break;
          case "second":
            d.setSeconds(d.getSeconds() - num);
            break;
          default:
            return 0;
        }
        return d.getTime();
      }
      const dateString = `${substringBefore(s, ",")} ${currentYear}`;
      return dateFormat.tryParseDate(dateString);
    } catch {
      return 0;
    }
  }

  // =============================== Pages ===============================
  protected pageListParse(response: Response): Page[] {
    const text = response.asJsoup().selectFirst("#arraydata")?.text();
    if (!text) return [];
    return text.split(",").map((url, i) => new Page(i, "", url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Filters ==============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator(), new OrderFilter(), new GenreFilter());
  }
}
