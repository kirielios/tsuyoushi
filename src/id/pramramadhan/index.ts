// Port of keiyoushi/extensions-source src/id/pramramadhan/Pramramadhan.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ago, toHttpUrl, urlWithoutDomain, type Document } from "../../../sdk/index.ts";
import { ArtistFilter, AuthorFilter, FormatFilter, GenreFilter, ProjectFilter, SortFilter, StatusFilter } from "./filters.ts";

const dateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("id"));

export default class Pramramadhan extends KeiSource {
  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    if (page > 1) return new MangasPage([], false);

    const document = (await this.client.get(`${this.baseUrl}/search.php?sort=popular&page=${page}`)).asJsoup();
    return this.mangaListParse(document);
  }

  // ============================== Latest ================================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    if (page > 1) return new MangasPage([], false);

    const document = (await this.client.get(`${this.baseUrl}/search.php?sort=newest&page=${page}`)).asJsoup();
    return this.mangaListParse(document);
  }

  // ============================== Search ================================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (page > 1) return new MangasPage([], false);

    const url = toHttpUrl(`${this.baseUrl}/search.php`).newBuilder();
    if (query.length > 0) url.addQueryParameter("q", query);
    url.addQueryParameter("page", String(page));

    for (const filter of filters) {
      if (filter instanceof SortFilter) url.addQueryParameter("sort", filter.toUriPart());
      else if (filter instanceof GenreFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("genre", filter.toUriPart());
      } else if (filter instanceof FormatFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("type", filter.toUriPart());
      } else if (filter instanceof ProjectFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("project", filter.toUriPart());
      } else if (filter instanceof StatusFilter) {
        if (filter.toUriPart().length > 0) url.addQueryParameter("status", filter.toUriPart());
      } else if (filter instanceof AuthorFilter) {
        if (filter.state.length > 0) url.addQueryParameter("author", filter.state);
      } else if (filter instanceof ArtistFilter) {
        if (filter.state.length > 0) url.addQueryParameter("artist", filter.state);
      }
    }

    const document = (await this.client.get(String(url.build()))).asJsoup();
    return this.mangaListParse(document);
  }

  private mangaListParse(document: Document): MangasPage {
    const mangas: SManga[] = [];
    for (const element of document.select("a.result-card")) {
      const titleText = element.selectFirst("div.result-title")?.text();
      if (titleText == null) continue;
      const m = SManga.create();
      m.url = urlWithoutDomain(element.attr("abs:href"));
      m.title = titleText;
      m.thumbnail_url = element.selectFirst("div.result-cover img")?.attr("abs:src");
      mangas.push(m);
    }
    return new MangasPage(mangas, false);
  }

  // =========================== Manga Details & Updates ==================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.mangaDetailsParse(document);
    details.url = manga.url;
    return new SMangaUpdate(details, this.chapterListParse(document));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const host = url.hostname.toLowerCase();
    if (host !== new URL(this.baseUrl).hostname.toLowerCase() && host !== "pramramadhan.my.id") return null;

    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (segments.length < 2 || segments[0] !== "series") return null;

    const slug = segments[1];
    if (slug.length === 0) return null;

    const mangaUrl = `/series/${slug}`;
    const probe = SManga.create();
    probe.url = mangaUrl;
    const document = (await this.client.get(this.getMangaUrl(probe))).asJsoup();
    if (document.selectFirst("h1.series-title") == null) return null;

    const manga = this.mangaDetailsParse(document);
    manga.url = mangaUrl;
    return manga;
  }

  private mangaDetailsParse(document: Document): SManga {
    const m = SManga.create();
    const titleText = document.selectFirst("h1.series-title")?.text();
    if (titleText == null) throw new Error("Missing title");
    m.title = titleText;
    m.author = document.selectFirst(".tag-row:has(.tag-label:contains(Author)) .tag-pill")?.text();
    m.artist = document.selectFirst(".tag-row:has(.tag-label:contains(Artist)) .tag-pill")?.text();
    m.genre = document
      .select(".tag-row:has(.tag-label:contains(Genre)) .tag-list a.tag-pill")
      .map((it) => it.text())
      .join(", ");
    m.status = this.parseStatus(document.selectFirst(".tag-row:has(.tag-label:contains(Status)) .tag-pill")?.text());
    m.description = document.selectFirst("p.series-desc")?.text();
    m.thumbnail_url = document.selectFirst("div.series-cover img")?.attr("abs:src");
    m.initialized = true;
    return m;
  }

  private parseStatus(status: string | null | undefined): number {
    switch (status?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ============================== Chapters ==============================
  private chapterListParse(document: Document): SChapter[] {
    return document.select("div.chapter-grid a.chapter-card").map((element) => {
      const titleText = element.selectFirst("div.chapter-title")?.text();
      if (titleText == null) throw new Error("Missing chapter name");
      const c = SChapter.create();
      c.url = urlWithoutDomain(element.attr("abs:href"));
      let name = titleText;
      const subTitle = element.selectFirst("div.chapter-sub")?.text();
      if (subTitle) name += ` - ${subTitle}`;
      c.name = name;
      c.date_upload = this.parseChapterDate(element.selectFirst("div.chapter-time")?.text());
      return c;
    });
  }

  private parseChapterDate(dateString: string | null | undefined): number {
    if (dateString == null) return 0;
    let trimmedDate = dateString.toLowerCase().trim();
    if (trimmedDate.endsWith("lalu")) trimmedDate = trimmedDate.slice(0, -"lalu".length);
    trimmedDate = trimmedDate.trim();

    const parts = trimmedDate.split(" ");
    if (/^[+-]?\d+$/.test(parts[0])) {
      const amount = parseInt(parts[0], 10);
      const units: Record<string, Parameters<typeof ago>[1]> = { detik: "seconds", menit: "minutes", jam: "hours", hari: "days", minggu: "weeks", bulan: "months", tahun: "years" };
      const unit = units[parts[1] ?? ""];
      if (unit) return ago(amount, unit);
    }
    return dateFormat.tryParseDate(dateString);
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.reader-container img.page").map((element, index) => new Page(index, "", element.attr("abs:src")));
  }

  // ============================== Filters ===============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new GenreFilter(), new FormatFilter(), new ProjectFilter(), new StatusFilter(), new AuthorFilter(), new ArtistFilter());
  }
}
