// Port of keiyoushi/extensions-source src/id/bacakomik/BacaKomik.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
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
  type Document,
  type Element,
  type Request,
} from "../../../sdk/index.ts";
import { AuthorFilter, GenreListFilter, SortByFilter, StatusFilter, TypeFilter, YearFilter, getGenreList } from "./filters.ts";

export default class BacaKomik extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
  private readonly chapterRegex = /Chapter\s+([0-9]+(?:\.[0-9]+)?)/i;

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(12, 3_000);
  }

  private pagePath(page: number) {
    return page > 1 ? `page/${page}/` : "";
  }

  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = `${this.baseUrl}/daftar-komik/${this.pagePath(page)}?order=popular`;
    return this.mangaListParse((await this.client.get(url)).asJsoup());
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = `${this.baseUrl}/daftar-komik/${this.pagePath(page)}?order=update`;
    return this.mangaListParse((await this.client.get(url)).asJsoup());
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builtUrl = page === 1 ? `${this.baseUrl}/daftar-komik/` : `${this.baseUrl}/daftar-komik/page/${page}/?order=`;
    const url = toHttpUrl(builtUrl).newBuilder();
    if (query) url.addQueryParameter("title", query);

    for (const filter of filters) {
      if (filter instanceof AuthorFilter) {
        if (filter.state) url.addQueryParameter("author", filter.state);
      } else if (filter instanceof YearFilter) {
        if (filter.state) url.addQueryParameter("yearx", filter.state);
      } else if (filter instanceof StatusFilter) {
        const status = filter.toUriPart();
        if (status) url.addQueryParameter("status", status);
      } else if (filter instanceof TypeFilter) {
        const type = filter.toUriPart();
        if (type) url.addQueryParameter("type", type);
      } else if (filter instanceof SortByFilter) {
        const order = filter.toUriPart();
        if (order) url.addQueryParameter("order", order);
      } else if (filter instanceof GenreListFilter) {
        filter.state.filter((it) => it.state !== Filter.TriState.STATE_IGNORE).forEach((it) => url.addQueryParameter("genre[]", it.id));
      }
    }

    return this.mangaListParse((await this.client.get(url.build().toString())).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments[0] !== "komik") return null;
    const slug = pathSegments[1];
    if (!slug) return null;
    const targetUrl = `${this.baseUrl}/komik/${slug}/`;
    const document = (await this.client.get(targetUrl)).asJsoup();
    const manga = SManga.create();
    manga.url = urlWithoutDomain(targetUrl);
    return this.parseDetails(document, manga);
  }

  // ======================= Details and Chapters ==========================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    return new SMangaUpdate(this.parseDetails(document, manga), this.parseChapters(document));
  }

  private parseDetails(document: Document, manga: SManga): SManga {
    const infoElement = document.selectFirst("div.infoanime");
    const descElement = document.selectFirst("div.desc > .entry-content.entry-content-single");

    let parsedTitle = document.selectFirst("#breadcrumbs li:last-child span")?.text() || undefined;
    if (parsedTitle == null) {
      const h1 = document.selectFirst("h1.entry-title")?.text();
      parsedTitle = h1 == null ? undefined : (h1.startsWith("Komik") ? h1.slice("Komik".length) : h1).trim();
    }
    if (parsedTitle) manga.title = parsedTitle;

    manga.author = document.select(".infox .spe span:contains(Author) :not(b)").text();
    manga.artist = document.select(".infox .spe span:contains(Artis) :not(b)").text();
    manga.genre = infoElement
      ?.select(".infox > .genre-info > a, .infox .spe span:contains(Jenis Komik) a")
      .map((it) => it.text())
      .join(", ");
    manga.status = this.parseStatus(document.selectFirst(".infox .spe span:contains(Status)")?.text());

    const pText = descElement?.select("p").text() ?? "";
    const i = pText.indexOf("bercerita tentang ");
    manga.description = (i === -1 ? pText : pText.slice(i + "bercerita tentang ".length)) || pText;

    manga.thumbnail_url = imgAttrOrNull(document.selectFirst(".thumb > img:nth-child(1), .thumb img"));
    return manga;
  }

  private parseStatus(status: string | undefined): number {
    if (status == null) return SManga.UNKNOWN;
    const s = status.toLowerCase();
    if (s.includes("berjalan") || s.includes("ongoing")) return SManga.ONGOING;
    if (s.includes("tamat") || s.includes("completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  private parseChapters(document: Document): SChapter[] {
    return document.select("#chapter_list li").map((element) => {
      const urlElement = element.selectFirst(".lchx a")!;
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(urlElement.absUrl("href"));
      chapter.name = urlElement.text();
      const m = this.chapterRegex.exec(chapter.name);
      if (m) {
        const n = Number(m[1]);
        chapter.chapter_number = Number.isNaN(n) ? -1 : n;
      }
      const date = element.selectFirst(".dt a")?.text();
      chapter.date_upload = date != null ? this.parseChapterDate(date) : 0;
      return chapter;
    });
  }

  private parseChapterDate(date: string): number {
    if (!date.includes("yang lalu")) return this.dateFormat.tryParseDate(date, "Asia/Jakarta");
    const first = date.split(" ")[0].trim();
    if (!/^[+-]?\d+$/.test(first)) return 0; // toIntOrNull
    const value = Number(first);
    // Calendar.getInstance(): local time
    const calendar = new Date();
    if (date.includes("detik")) calendar.setSeconds(calendar.getSeconds() - value);
    else if (date.includes("menit")) calendar.setMinutes(calendar.getMinutes() - value);
    else if (date.includes("jam")) calendar.setHours(calendar.getHours() - value);
    else if (date.includes("hari")) calendar.setDate(calendar.getDate() - value);
    else if (date.includes("minggu")) calendar.setDate(calendar.getDate() - value * 7);
    else if (date.includes("bulan")) calendar.setMonth(calendar.getMonth() - value);
    else if (date.includes("tahun")) calendar.setFullYear(calendar.getFullYear() - value);
    else return 0;
    return calendar.getTime();
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.baseUrl + chapter.url;
    const document = (await this.client.get(chapterUrl)).asJsoup();
    const pages: Page[] = [];
    document
      .select('div:has(>img[alt*="Chapter"]) img')
      .filter((it) => it.parent()?.tagName() !== "noscript")
      .forEach((element, i) => {
        // Jsoup attribute keys are case-insensitive ("onError"); cheerio keeps them lower-cased
        const onerror = element.attr("onerror");
        let url: string;
        if (onerror.includes("src='")) {
          const after = onerror.slice(onerror.indexOf("src='") + "src='".length);
          const end = after.indexOf("';");
          url = end === -1 ? after : after.slice(0, end);
        } else {
          url = element.attr("data-lazy-src") || element.attr("src");
        }
        if (url) pages.push(new Page(i, chapterUrl, url));
      });
    return pages;
  }

  override imageRequest(page: Page): Request {
    const newHeaders = this.headersBuilder();
    newHeaders.set("Accept", "image/avif,image/webp,image/png,image/jpeg,*/*");
    newHeaders.set("Referer", page.url || `${this.baseUrl}/`);
    return GET(page.imageUrl!, newHeaders);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("NOTE: Ignored if using text search!"),
      new Filter.Separator(),
      new AuthorFilter(),
      new YearFilter(),
      new StatusFilter(),
      new TypeFilter(),
      new SortByFilter(),
      new GenreListFilter(getGenreList()),
    );
  }

  // ============================= Utilities ==============================
  private mangaListParse(document: Document): MangasPage {
    const mangas = document.select("div.animepost").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.select("a.next.page-numbers").length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("div.animposx > a")!.absUrl("href"));
    manga.title = element.selectFirst(".animposx .tt h4")!.text();
    manga.thumbnail_url = imgAttrOrNull(element.selectFirst("div.limit img"));
    return manga;
  }
}

function imgAttr(element: Element): string {
  if (element.hasAttr("data-lazy-src")) return element.absUrl("data-lazy-src");
  if (element.hasAttr("data-src")) return element.absUrl("data-src");
  return element.absUrl("src");
}
const imgAttrOrNull = (element: Element | null) => (element ? imgAttr(element) : undefined);
