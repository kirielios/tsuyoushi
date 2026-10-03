// Port of keiyoushi/extensions-source src/en/imanevilgod/IAmAnEvilGod.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

export default class IAmAnEvilGod extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // --- Catalogue (single entry) ---

  private createManga(): SManga {
    const manga = SManga.create();
    manga.title = "I'm An Evil God";
    manga.url = "/";
    manga.status = SManga.UNKNOWN;
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    return url.host === new URL(this.baseUrl).host ? this.createManga() : null;
  }

  // --- Manga details & chapter list ---

  async fetchMangaUpdate(_manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.baseUrl)).asJsoup();

    const details = SManga.create();
    details.title = "I'm An Evil God";
    details.url = "/";
    details.status = SManga.UNKNOWN;
    details.description = "Across the realms, the manliest and most handsome evil god in history! " + "Xie Yan crosses over and falls into the vixen's lair...";
    details.thumbnail_url = doc.selectFirst("meta[property=og:image]")?.attr("content");

    // Chapters are <a> tags inside the paragraph with class "has-medium-font-size"
    const chapterList = doc.select("p.has-medium-font-size a[href*=imanevilgod.com]").map((el, index) => {
      const chapter = SChapter.create();
      chapter.name = el.text();
      chapter.url = urlWithoutDomain(el.absUrl("href"));
      chapter.chapter_number = index;
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  // --- Page list ---

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const doc = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    // Chapter pages are <img> tags inside the post content
    return doc.select("div.entry-content img").map((el, index) => new Page(index, "", el.absUrl("src") || el.absUrl("data-src")));
  }
}
