// Port of keiyoushi/extensions-source src/en/cutiecomics/CutieComics.kt
import { ClientBuilder, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type Document } from "../../../sdk/index.ts";

export default class CutieComics extends KeiSource {
  private get baseUrlHost(): string {
    return new URL(this.baseUrl).hostname;
  }

  override get supportsLatest(): boolean {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2, 1000, (url) => url.hostname === this.baseUrlHost);
  }

  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/page/${page}`)).asJsoup());
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select("#dle-content > div.w25").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst("strong.field-content > a")!;
      manga.title = a.ownText();
      manga.url = urlWithoutDomain(a.attr("href"));
      manga.thumbnail_url = element.selectFirst("a > img")?.absUrl("src");
      return manga;
    });

    const hasNextPage = document.selectFirst(".navigation > a > i.fa-angle-right") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  // =============================== Latest ===============================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =============================== Search ===============================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== this.baseUrlHost) return null;
    const id = url.pathname.split("/").filter((_, i) => i > 0)[0];
    if (!id) return null;

    const response = await this.client.get(`${this.baseUrl}/${id}`);
    const responseUrl = response.url;
    const manga = this.parseDetails(response.asJsoup());
    manga.url = urlWithoutDomain(responseUrl);
    return manga;
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    if (!(query.trim() !== "" && query.length >= 4)) throw new Error("Invalid search! It should have at least 4 non-blank characters.");
    const body = new URLSearchParams({
      do: "search",
      subaction: "search",
      full_search: "0",
      search_start: `${page}`,
      result_from: `${(page - 1) * 20 + 1}`,
      story: query,
    });
    return this.parseMangaList((await this.client.post(`${this.baseUrl}/index.php?do=search`, undefined, body)).asJsoup());
  }

  // =========================== Manga Details ============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    let updatedManga = manga;
    if (fetchDetails) {
      updatedManga = this.parseDetails((await this.client.get(this.getMangaUrl(manga))).asJsoup());
      updatedManga.url = manga.url;
    }

    const chapter = SChapter.create();
    chapter.url = manga.url;
    chapter.chapter_number = 1;
    chapter.name = "Chapter";

    return new SMangaUpdate(updatedManga, [chapter]);
  }

  private parseDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK

    manga.title = document.selectFirst("h1#page-title")!.text();
    manga.thumbnail_url = document.selectFirst("div.galery > img")?.absUrl("src");
    manga.genre = document
      .select("h3.field-label ~ span")
      .map((it) => it.text())
      .join(", ");
    return manga;
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.galery > img").map((item, index) => new Page(index, "", item.absUrl("src")));
  }
}
