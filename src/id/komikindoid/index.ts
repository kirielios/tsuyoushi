// Port of keiyoushi/extensions-source src/id/komikindoid/KomikIndoID.kt
import { ClientBuilder, DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneId, ago, substringAfter, substringBefore, substringBeforeLast, toHttpUrl, urlWithoutDomain, type Document, type Element } from "../../../sdk/index.ts";
import {
  AuthorFilter,
  ContentRatingFilter,
  DemographicFilter,
  FormatFilter,
  GenreFilter,
  OriginalLanguageFilter,
  SortFilter,
  StatusFilter,
  ThemeFilter,
  YearFilter,
  getContentRating,
  getDemographic,
  getFormat,
  getGenre,
  getOriginalLanguage,
  getStatus,
  getTheme,
} from "./filters.ts";

const imgAttr = (e: Element): string => (e.hasAttr("data-lazy-src") ? e.absUrl("data-lazy-src") : e.hasAttr("data-src") ? e.absUrl("data-src") : e.absUrl("src"));

export default class KomikIndoID extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
  private readonly chapterRegex = /Chapter\s+([0-9]+(?:\.[0-9]+)?)/i;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(12, 3000);
  }

  private pagePath(page: number) {
    return page > 1 ? `page/${page}/` : "";
  }

  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/daftar-manga/${this.pagePath(page)}?order=popular`)).asJsoup();
    return this.mangaListParse(document);
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/daftar-manga/${this.pagePath(page)}?order=update`)).asJsoup();
    return this.mangaListParse(document);
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/daftar-manga/${this.pagePath(page)}`).newBuilder();
    if (query.length > 0) url.addQueryParameter("title", query);

    const checked = (group: Filter.Group<Filter.CheckBox & { id: string }>, param: string) =>
      group.state.forEach((it) => {
        if (it.state) url.addQueryParameter(param, it.id);
      });

    for (const filter of filters) {
      if (filter instanceof AuthorFilter) {
        if (filter.state.length > 0) url.addQueryParameter("author", filter.state);
      } else if (filter instanceof YearFilter) {
        if (filter.state.length > 0) url.addQueryParameter("yearx", filter.state);
      } else if (filter instanceof SortFilter) url.addQueryParameter("order", filter.toUriPart());
      else if (filter instanceof OriginalLanguageFilter) checked(filter, "type[]");
      else if (filter instanceof FormatFilter) checked(filter, "format[]");
      else if (filter instanceof DemographicFilter) checked(filter, "demografis[]");
      else if (filter instanceof StatusFilter) checked(filter, "status[]");
      else if (filter instanceof ContentRatingFilter) checked(filter, "konten[]");
      else if (filter instanceof ThemeFilter) checked(filter, "tema[]");
      else if (filter instanceof GenreFilter) checked(filter, "genre[]");
    }

    const document = (await this.client.get(String(url.build()))).asJsoup();
    return this.mangaListParse(document);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (segments[0] !== "komik") return null;
    const slug = segments[1];
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

    if (manga.title.length === 0) {
      const parsedTitle = document.selectFirst("h1.entry-title")?.text()?.replace(/^Komik/, "").trim();
      if (parsedTitle) manga.title = parsedTitle;
    }

    const authorCleaner = document.selectFirst(".infox .spe b:contains(Pengarang)")?.text() ?? "";
    const author = document.selectFirst(".infox .spe span:contains(Pengarang)")?.text();
    manga.author = author != null ? substringAfter(author, authorCleaner).trim() : undefined;

    const artistCleaner = document.selectFirst(".infox .spe b:contains(Ilustrator)")?.text() ?? "";
    const artist = document.selectFirst(".infox .spe span:contains(Ilustrator)")?.text();
    manga.artist = artist != null ? substringAfter(artist, artistCleaner).trim() : undefined;

    manga.genre = infoElement
      ?.select(".infox .genre-info a, .infox .spe span:contains(Grafis:) a, .infox .spe span:contains(Tema:) a, .infox .spe span:contains(Konten:) a, .infox .spe span:contains(Jenis Komik:) a")
      .map((it) => it.text())
      .join(", ");

    manga.status = this.parseStatus(infoElement?.selectFirst(".infox > .spe > span:nth-child(2)")?.text());

    let description = "";
    const p = descElement?.select("p").text();
    const mainDesc = p != null ? substringAfter(p, "bercerita tentang ") : null;
    if (mainDesc) description += mainDesc;
    const altName = document.selectFirst(".infox > .spe > span:nth-child(1)")?.text();
    if (altName) {
      if (description.length > 0) description += "\n\n";
      description += altName;
    }
    manga.description = description;

    const thumb = document.selectFirst(".thumb > img:nth-child(1), .thumb img");
    manga.thumbnail_url = thumb ? substringBeforeLast(imgAttr(thumb), "?") : undefined;
    return manga;
  }

  private parseStatus(status: string | null | undefined): number {
    const s = status?.toLowerCase();
    if (s == null) return SManga.UNKNOWN;
    if (s.includes("berjalan") || s.includes("ongoing")) return SManga.ONGOING;
    if (s.includes("tamat") || s.includes("completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  private parseChapters(document: Document): SChapter[] {
    return document.select("#chapter_list li").map((element) => {
      const urlElement = element.selectFirst(".lchx a")!;
      const c = SChapter.create();
      c.url = urlWithoutDomain(urlElement.absUrl("href"));
      c.name = urlElement.text();

      const m = this.chapterRegex.exec(c.name);
      if (m) c.chapter_number = parseFloat(m[1]);

      const date = element.selectFirst(".dt a")?.text();
      c.date_upload = date != null ? this.parseChapterDate(date) : 0;
      return c;
    });
  }

  private parseChapterDate(date: string): number {
    if (date.includes("yang lalu")) {
      const first = date.split(" ")[0]?.trim();
      if (first == null || !/^[+-]?\d+$/.test(first)) return 0;
      const value = parseInt(first, 10);
      if (date.includes("detik")) return ago(value, "seconds");
      if (date.includes("menit")) return ago(value, "minutes");
      if (date.includes("jam")) return ago(value, "hours");
      if (date.includes("hari")) return ago(value, "days");
      if (date.includes("minggu")) return ago(value * 7, "days");
      if (date.includes("bulan")) return ago(value, "months");
      if (date.includes("tahun")) return ago(value, "years");
      return 0;
    }
    return this.dateFormat.tryParseDate(date, ZoneId.of("Asia/Jakarta"));
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.baseUrl + chapter.url;
    const document = (await this.client.get(chapterUrl)).asJsoup();
    return document
      .select("div.img-landmine img")
      .map((element) => {
        const onerror = element.attr("onError");
        return onerror.includes("src='") ? substringBefore(substringAfter(onerror, "src='"), "';") : imgAttr(element);
      })
      .filter((url) => url.length > 0)
      .map((url, index) => new Page(index, chapterUrl, url));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new SortFilter(),
      new Filter.Header("NOTE: Ignored if using text search!"),
      new AuthorFilter(),
      new YearFilter(),
      new Filter.Separator(),
      new OriginalLanguageFilter(getOriginalLanguage()),
      new FormatFilter(getFormat()),
      new DemographicFilter(getDemographic()),
      new StatusFilter(getStatus()),
      new ContentRatingFilter(getContentRating()),
      new ThemeFilter(getTheme()),
      new GenreFilter(getGenre()),
    );
  }

  // ============================= Utilities ==============================
  private mangaListParse(document: Document): MangasPage {
    const mangas = document.select("div.animepost").map((element) => {
      const m = SManga.create();
      m.title = element.selectFirst("div.tt h3")?.text() || element.selectFirst("div.animposx > a")!.attr("title").replace(/^Komik/, "").trim();
      const a = element.selectFirst("div.animposx > a");
      if (a) m.url = urlWithoutDomain(a.absUrl("href"));
      const img = element.selectFirst("div.limit img");
      m.thumbnail_url = img ? imgAttr(img) : undefined;
      return m;
    });
    const hasNextPage = document.selectFirst("a.next.page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }
}
