// Port of keiyoushi/extensions-source src/en/onepunchmanonline/OnePunchManOnline.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

export default class OnePunchManOnline extends KeiSource {
  // ============================== Popular ===============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  // =============================== Latest ================================
  override get supportsLatest() {
    return false;
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =============================== Search ================================
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const manga = this.createManga();
    return !query.trim() || manga.title.toLowerCase().includes(query.toLowerCase()) ? new MangasPage([manga], false) : new MangasPage([], false);
  }

  // ============================== Details ===============================
  async fetchMangaUpdate(_manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const chapterList = fetchChapters ? await this.getChapters() : chapters;
    return new SMangaUpdate(this.createManga(), chapterList);
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.title = "One Punch Man";
    manga.url = "/";
    manga.thumbnail_url = "https://1punchman.com/wp-content/uploads/2024/02/9782380712018_1_75.jpg";
    manga.author = "ONE";
    manga.artist = "Murata Yusuke";
    manga.status = SManga.ONGOING;
    manga.genre = "Action, Comedy, Superhero, Seinen";
    manga.description = "One-Punch Man is a superhero who has trained so hard that his hair has fallen out, and who can overcome any enemy with one punch.";
    return manga;
  }

  // ============================== Chapters ===============================
  private async getChapters(): Promise<SChapter[]> {
    return (await this.client.get(this.baseUrl)).asJsoup().select("ul li a[href*='/manga/']").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("abs:href"));
      chapter.name = element.text();
      return chapter;
    });
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    return document
      .select("div.entry-content img, .separator img, p img")
      .map((img) => img.attr("abs:data-src") || img.attr("abs:data-lazy-src") || img.attr("abs:src"))
      .filter((it) => it.startsWith("http"))
      .map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // Image host (mangafreak) returns 403 when a Referer from this site is sent
  override imageRequest(page: Page) {
    const request = super.imageRequest(page);
    const headers = new Headers(request.headers);
    headers.delete("Referer");
    headers.delete("Origin");
    return { ...request, headers };
  }
}
