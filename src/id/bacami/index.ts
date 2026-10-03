// Port of keiyoushi/extensions-source src/id/bacami/Bacami.kt
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
  parseAs,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type HttpUrl,
} from "../../../sdk/index.ts";
import { GenreFilter, NewKomikFilter, OrderByFilter, StatusFilter, TypeFilter } from "./filters.ts";

const firstInstanceOrNull = <T extends Filter>(filters: FilterList, cls: abstract new (...args: never[]) => T): T | undefined => filters.find((it): it is T => it instanceof cls);

export default class Bacami extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("d MMMM, yyyy", Locale.ENGLISH);
  private readonly chapterRegex = /(?:Chapter|Ch\.)\s+([0-9]+(?:\.[0-9]+)?)/i;

  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments("custom-search/orderby/score");
    if (page > 1) url.addPathSegments(`page/${page}`);
    return this.mangaListParse((await this.client.get(url.build().toString())).asJsoup());
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments("custom-search/orderby/latest");
    if (page > 1) url.addPathSegments(`page/${page}`);
    return this.mangaListParse((await this.client.get(url.build().toString())).asJsoup());
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: HttpUrl;
    if (query.trim()) {
      const b = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("search").addPathSegment(query);
      if (page > 1) b.addPathSegments(`page/${page}`);
      url = b.build();
    } else {
      const isNewKomik = firstInstanceOrNull(filters, NewKomikFilter)?.state === true;
      if (isNewKomik) {
        const b = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("komik-baru");
        if (page > 1) b.addPathSegments(`page/${page}`);
        url = b.build();
      } else {
        const genre = firstInstanceOrNull(filters, GenreFilter)?.toUriPart() ?? "all";
        const status = firstInstanceOrNull(filters, StatusFilter)?.toUriPart() ?? "all";
        const type = firstInstanceOrNull(filters, TypeFilter)?.toUriPart() ?? "all";
        const orderby = firstInstanceOrNull(filters, OrderByFilter)?.toUriPart() ?? "latest";

        const b = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("custom-search");
        if (genre !== "all") b.addPathSegments(`genre/${genre}`);
        if (status !== "all") b.addPathSegments(`status/${status}`);
        if (type !== "all") b.addPathSegments(`type/${type}`);
        if (orderby !== "latest") b.addPathSegments(`orderby/${orderby}`);
        if (page > 1) b.addPathSegments(`page/${page}`);
        url = b.build();
      }
    }

    return this.mangaListParse((await this.client.get(url.toString())).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    try {
      if (url.host !== new URL(this.baseUrl).host) return null;
      const pathSegments = url.pathname.slice(1).split("/");
      if (!pathSegments.some((it) => it)) return null;

      let mangaPath: string;
      if (pathSegments[0] === "komik") {
        mangaPath = url.pathname;
      } else {
        const document = (await this.client.get(url)).asJsoup();
        const href = document.selectFirst("div.allc a[href*='/komik/'], a.midall[href*='/komik/'], .breadcrumb a[href*='/komik/']")?.absUrl("href");
        if (href == null) return null;
        mangaPath = toHttpUrl(href).encodedPath;
      }

      const manga = SManga.create();
      manga.url = urlWithoutDomain(mangaPath);
      const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
      result.initialized = true;
      return result;
    } catch {
      return null;
    }
  }

  // ======================= Details and Chapters ==========================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.parseDetails(document);
    details.url = manga.url;
    if (!details.title) details.title = manga.title;
    return new SMangaUpdate(details, this.parseChapters(document));
  }

  private parseDetails(document: Document): SManga {
    const manga = SManga.create();
    const content = document.selectFirst("#komik > section.manga-content");
    if (content == null) return manga;

    const h1 = content.selectFirst("header > h1")?.text();
    manga.title = h1 == null ? "" : (h1.endsWith("Bahasa Indonesia") ? h1.slice(0, -"Bahasa Indonesia".length) : h1).trim();
    const thumb = content.selectFirst("figure .image-wrap img");
    manga.thumbnail_url = thumb ? imgAttr(thumb) : undefined;
    const author = content.selectFirst(".info-item:contains(Author) .info-value")?.text();
    manga.author = author === "" ? content.selectFirst("div > div > div:nth-child(3) > span.info-value")?.text() : author;
    manga.genre = content
      .select("nav > span > a")
      .map((it) => it.text())
      .join(", ");
    manga.status = this.parseStatus(document);

    const altTitle = content.select("p.manga-altname").text();
    const desc = content.select("p.manga-description").text();
    manga.description = altTitle ? (desc ? `${desc}\n\nAlternative Title: ${altTitle}` : `Alternative Title: ${altTitle}`) : desc;
    manga.initialized = true;
    return manga;
  }

  private parseStatus(document: Document): number {
    if (document.selectFirst(".hot-tag, .project-tag") != null) return SManga.ONGOING;
    if (document.selectFirst(".tamat-tag") != null) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  private parseChapters(document: Document): SChapter[] {
    return document.select("ol.chapter-list > li").map((element) => {
      const link = element.selectFirst("a.ch-link")!;
      const chapter = SChapter.create();
      const rawName = link.text();
      chapter.name = substringAfter(substringAfter(rawName, "–"), "-").trim() || rawName;
      chapter.url = urlWithoutDomain(link.absUrl("href"));
      const m = this.chapterRegex.exec(chapter.name);
      if (m) {
        const n = Number(m[1]);
        chapter.chapter_number = Number.isNaN(n) ? -1 : n;
      }
      chapter.date_upload = this.dateFormat.tryParseDate(element.select("span.ch-date").text(), "Asia/Jakarta");
      return chapter;
    });
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const scriptContent = document.selectFirst("script:containsData(imageUrls)")?.data();
    if (scriptContent == null) return [];

    const jsonString = substringBefore(substringAfter(scriptContent, "imageUrls:"), "],") + "]";
    const imageUrls = parseAs<string[]>(jsonString);
    return imageUrls.map((url, index) => new Page(index, "", url));
  }

  // ============================== Filters ===============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Filter diabaikan jika menggunakan pencarian teks."),
      new Filter.Separator(),
      new GenreFilter(),
      new StatusFilter(),
      new TypeFilter(),
      new OrderByFilter(),
      new Filter.Separator(),
      new Filter.Header("Centang 'Komik Baru' akan mengabaikan filter lain."),
      new NewKomikFilter(),
    );
  }

  // ============================= Utilities ==============================
  private mangaListParse(document: Document): MangasPage {
    const mangas = document.select("article.genre-card").map((element) => this.searchMangaFromElement(element));
    const hasNextPage = document.selectFirst("div.paginate a.next.page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.selectFirst("div.genre-info > a")!.text();
    manga.url = urlWithoutDomain(element.selectFirst("div.genre-cover > a")!.absUrl("href"));
    const img = element.selectFirst("div.genre-cover > a > img");
    manga.thumbnail_url = img ? imgAttr(img) : undefined;
    return manga;
  }
}

const imgAttr = (element: Element): string => element.absUrl("data-src") || element.absUrl("src");
