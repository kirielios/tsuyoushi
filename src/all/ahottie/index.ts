// Port of keiyoushi/extensions-source src/all/ahottie/AHottie.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneOffset, toHttpUrl, urlWithoutDomain, type Document, type FilterList } from "../../../sdk/index.ts";

const DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ENGLISH);

export default class AHottie extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // ========================= Popular =========================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("page", String(page)).build();
    return this.popularMangaParse((await this.client.get(url.toString())).asJsoup());
  }

  private popularMangaParse(document: Document): MangasPage {
    const mangas = document.select("#main > div > div").map((element) => {
      const manga = SManga.create();
      const link = element.selectFirst("a")!;
      const titleEl = element.selectFirst("h2") ?? (() => { throw new Error("Title not found"); })();
      manga.title = titleEl.text();
      manga.thumbnail_url = element.selectFirst(".relative img")?.absUrl("src");
      manga.genre = element
        .select(".flex a")
        .map((it) => it.text())
        .join(", ");
      manga.url = urlWithoutDomain(link.absUrl("href"));
      manga.initialized = true;
      return manga;
    });
    const hasNextPage = document.selectFirst("a[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ========================= Latest =========================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Search =========================

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("search").addQueryParameter("kw", query).addQueryParameter("page", String(page)).build();

    const document = (await this.client.get(url.toString())).asJsoup();

    if (document.selectFirst("h1") != null && document.selectFirst("div.pl-3 > a") != null) {
      const manga = this.mangaDetailsParse(document);
      manga.url = url.encodedPath;
      return new MangasPage([manga], false);
    }

    return this.popularMangaParse(document);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const document = (await this.client.get(url)).asJsoup();
    if (document.selectFirst("h1") != null && document.selectFirst("div.pl-3 > a") != null) {
      const manga = this.mangaDetailsParse(document);
      manga.url = toHttpUrl(url.href).encodedPath;
      return manga;
    }
    return null;
  }

  // ========================= Details =========================

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const titleEl = document.selectFirst("h1");
    if (titleEl == null) throw new Error("Title not found");
    manga.title = titleEl.text();
    manga.genre = document
      .select("div.pl-3 > a")
      .map((it) => it.text())
      .join(", ");
    manga.initialized = true;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const updatedManga = this.mangaDetailsParse(document);

    const chapter = SChapter.create();
    const link = document.selectFirst("link[rel=canonical]");
    if (link == null) throw new Error("Chapter link not found");
    chapter.url = urlWithoutDomain(link.absUrl("href"));
    chapter.chapter_number = 0;
    chapter.name = "GALLERY";
    const time = document.selectFirst("time")?.text();
    chapter.date_upload = time != null ? this.parseDate(time) : 0;

    return new SMangaUpdate(updatedManga, [chapter]);
  }

  private parseDate(dateStr: string): number {
    return DATE_FORMATTER.tryParseDate(dateStr, ZoneOffset.UTC);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  // ========================= Chapters =========================

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  // ========================= Pages =========================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pages: Page[] = [];
    let doc = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    for (;;) {
      for (const it of doc.select("#main img.block")) pages.push(new Page(pages.length, "", it.absUrl("src")));
      const nextPageUrl = doc.selectFirst("a[rel=next]")?.absUrl("href") ?? "";
      if (nextPageUrl.length === 0) break;
      doc = (await this.client.get(nextPageUrl)).asJsoup();
    }
    return pages;
  }
}
