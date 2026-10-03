// Port of keiyoushi/extensions-source src/id/themanga/TheManga.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, tryParseInstant, urlWithoutDomain, type ClientBuilder, type Document } from "../../../sdk/index.ts";
import { GenreFilter, OtherFilterGroup, StatusFilter, isUrlFilter } from "./filters.ts";

export default class TheManga extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  // =============================== Popular ================================
  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/?q=&sort=popular&page=${page}`)).asJsoup();
    return this.mangaListParse(document);
  }

  // =============================== Latest =================================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/?q=&sort=latest_update&page=${page}`)).asJsoup();
    return this.mangaListParse(document);
  }

  // =============================== Search =================================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/explore`).newBuilder();
    url.addQueryParameter("q", query);
    url.addQueryParameter("page", String(page));
    filters.filter(isUrlFilter).forEach((it) => it.addToUrl(url));

    const document = (await this.client.get(url.build().toString())).asJsoup();
    return this.mangaListParse(document);
  }

  private mangaListParse(document: Document): MangasPage {
    const mangas: SManga[] = [];
    for (const element of document.select("a.card, a.manga-card")) {
      const titleText = element.selectFirst(".card-title")?.text();
      if (titleText == null) continue;
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.attr("href"));
      manga.title = titleText;
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      mangas.push(manga);
    }

    const hasNextPage = document.selectFirst(".explore-pagination__btn[rel=next], a[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // =========================== Manga Details ============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const url = toHttpUrl(this.getMangaUrl(manga)).newBuilder().addQueryParameter("all", "1").build();
    const document = (await this.client.get(url.toString())).asJsoup();
    const details = this.mangaDetailsParse(document);
    details.url = manga.url;
    return new SMangaUpdate(details, this.chapterListParse(document));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host.toLowerCase() !== new URL(this.baseUrl).host.toLowerCase()) return null;

    const segments = url.pathname.slice(1).split("/");
    if (segments.length < 2 || segments[0] !== "manga") return null;

    const slug = segments[1];
    if (!slug) return null;

    const mangaUrl = `/manga/${slug}`;
    const probe = SManga.create();
    probe.url = mangaUrl;
    const requestUrl = toHttpUrl(this.getMangaUrl(probe)).newBuilder().addQueryParameter("all", "1").build();
    const document = (await this.client.get(requestUrl.toString())).asJsoup();
    if (document.selectFirst(".hero-title") == null) return null;

    const manga = this.mangaDetailsParse(document);
    manga.url = mangaUrl;
    manga.initialized = true;
    return manga;
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const titleText = document.selectFirst(".hero-title")?.text();
    if (titleText == null) throw new Error("Missing title");
    manga.title = titleText;
    manga.author = this.metaText(document, "Author");
    manga.artist = this.metaText(document, "Artist");
    manga.description = document.selectFirst(".synopsis-text")?.text();
    manga.thumbnail_url = document.selectFirst(".hero-cover img")?.absUrl("src");

    switch (document.selectFirst(".hero-status-badge")?.text()?.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }

    const genres = document.select(".meta-pill-row .meta-pill").map((it) => it.text());
    const type = this.metaText(document, "Type");
    if (type != null && type.trim()) genres.push(type);

    manga.genre = genres.join(", ");
    return manga;
  }

  // ============================== Chapters ==============================
  private chapterListParse(document: Document): SChapter[] {
    return document.select(".chapter-row").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("data-href"));
      const name = element.selectFirst(".chapter-title")?.text();
      if (name == null) throw new Error("Missing chapter name");
      chapter.name = name;
      chapter.date_upload = tryParseInstant(element.selectFirst("[data-local-time]")?.attr("data-local-time"));
      return chapter;
    });
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    let url: string;
    if (!chapter.url.includes("/chapter/")) {
      // Support old Madara URLs
      const segments = toHttpUrl(chapter.url).pathSegments;
      const mangaSlug = segments[1];
      const number = segments[2].replace(/^chapter-/, "").replaceAll("-", ".");
      const dotIndex = number.indexOf(".");
      const formatted = dotIndex >= 0 ? number.padEnd(dotIndex + 3, "0") : `${number}.00`;

      url = `${this.baseUrl}/manga/${mangaSlug}/chapter/${formatted}`;
    } else {
      url = this.getChapterUrl(chapter);
    }

    const document = (await this.client.get(url)).asJsoup();

    return document.select("img.page-img").map((image, idx) => new Page(idx, "", image.absUrl("src")));
  }

  // ============================== Filters ===============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new StatusFilter(), new GenreFilter(), new Filter.Separator(), new OtherFilterGroup());
  }

  // ============================== Utils ===============================
  private metaText(document: Document, label: string): string | undefined {
    return document.selectFirst(`.meta-item-label:matchesOwn(^${label}$) + .meta-item-value`)?.text();
  }
}
