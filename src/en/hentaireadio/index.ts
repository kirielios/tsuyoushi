// Port of keiyoushi/extensions-source src/en/hentaireadio/HentaiReadio.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneOffset, urlWithoutDomain, type Document } from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, getFilters } from "./filters.ts";

export default class HentaiReadio extends KeiSource {
  // Site is behind Cloudflare

  private readonly dateFormatter = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

  parseFilteredManga(document: Document): MangasPage {
    const mangas = document.select("div.card:has(.jtip)").map((element) => {
      const manga = SManga.create();
      const anchor = element.selectFirst(".title-manga a")!;
      manga.title = anchor.text();
      manga.url = urlWithoutDomain(anchor.attr("href"));
      manga.thumbnail_url = element.selectFirst("img.card-img-top")?.absUrl("src");
      return manga;
    });
    const hasNextPage = document.selectFirst("ul.pagination li.page-item a.page-link:contains(»)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/?act=search&f[status]=all&f[sortby]=top-manga&pageNum=${page}`)).asJsoup();
    return this.parseFilteredManga(document);
  }

  // =============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/?act=search&f[status]=all&f[sortby]=lastest-chap&pageNum=${page}`)).asJsoup();
    return this.parseFilteredManga(document);
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = new URL(this.baseUrl);
    url.searchParams.append("act", "search");
    url.searchParams.append("pageNum", String(page));

    if (query.length > 0) url.searchParams.append("f[keyword]", query);

    let statusAdded = false;
    let sortAdded = false;

    for (const filter of filters) {
      if (filter instanceof StatusFilter) {
        url.searchParams.append("f[status]", filter.toUriPart());
        statusAdded = true;
      } else if (filter instanceof SortFilter) {
        url.searchParams.append("f[sortby]", filter.toUriPart());
        sortAdded = true;
      } else if (filter instanceof GenreFilter) {
        const genre = filter.toUriPart();
        if (genre.length > 0) url.searchParams.append("f[genres]", genre);
      }
    }

    if (!statusAdded) url.searchParams.append("f[status]", "all");
    if (!sortAdded) url.searchParams.append("f[sortby]", "lastest-chap");

    const document = (await this.client.get(url)).asJsoup();
    return this.parseFilteredManga(document);
  }

  // ============================== Details ===============================

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.title-detail")!.text();
    const author = document.selectFirst(".author p.col-8")?.text();
    manga.author = author != null && author.toLowerCase().includes("updating") ? undefined : author;
    manga.status = this.parseStatus(document.selectFirst(".status p.col-8")?.text());
    manga.genre = document
      .select(".kind p.col-8 a")
      .map((it) => it.text())
      .join(", ");
    manga.description = document.selectFirst("#summary_shortened")?.text();
    manga.thumbnail_url = document.selectFirst(".col-image img")?.absUrl("src");
    manga.initialized = true;
    return manga;
  }

  protected async getMangaByUrl(url: URL): Promise<SManga> {
    if (url.hostname !== new URL(this.baseUrl).hostname) throw new Error("Unsupported URL");

    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments.length < 1 || pathSegments.length > 2 || pathSegments[0].trim() === "" || (pathSegments[1] ?? "").trim() !== "") {
      throw new Error("Unsupported URL");
    }

    const document = (await this.client.get(url)).asJsoup();
    const manga = this.parseMangaDetails(document);
    manga.url = urlWithoutDomain(url.toString());
    return manga;
  }

  private parseStatus(status: string | null | undefined): number {
    switch (status?.trim().toLowerCase()) {
      case "complete":
      case "completed":
        return SManga.COMPLETED;
      case "in process":
      case "ongoing":
        return SManga.ONGOING;
      case "pause":
      case "on hiatus":
        return SManga.ON_HIATUS;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ============================== Chapters ==============================

  private parseChapterList(document: Document): SChapter[] {
    return document.select("ul#list_chapter_id_detail li.wp-manga-chapter, ul.version-chap li.wp-manga-chapter").map((element) => {
      const chapter = SChapter.create();
      const link = element.selectFirst("a")!;
      chapter.url = urlWithoutDomain(link.attr("href"));
      chapter.name = link.text();
      const text = element.selectFirst(".chapter-release-date i")?.text()?.trim();
      chapter.date_upload = text ? this.dateFormatter.tryParseDate(text, ZoneOffset.UTC) : 0;
      return chapter;
    });
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    return document.select(".page-chapter img").map((img, index) => {
      // Prefer data-src (lazy-loaded) over src which may be a placeholder
      const src = img.absUrl("data-src");
      return new Page(index, "", src === "" ? img.absUrl("src") : src);
    });
  }

  // =============================== Filters ==============================

  getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }
}
