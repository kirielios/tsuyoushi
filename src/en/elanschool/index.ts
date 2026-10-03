// Port of keiyoushi/extensions-source src/en/elanschool/ElanSchool.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type Element, type FilterList } from "../../../sdk/index.ts";

export default class ElanSchool extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private mangaInfo(page: number): SManga {
    const manga = SManga.create();
    manga.url = `/chapters/?dps_paged=${page}`;
    manga.title = "Elan School";
    manga.thumbnail_url = `${this.baseUrl}/wp-content/uploads/2018/11/The-Elan-School-Comic-1cNEW-1-768x1491.jpg`;
    manga.description = "A 16 year old boy named Joe gets indoctrinated into a sick cult that is run by imprisoned teenagers. Based on the true story of the Elan School.";
    manga.status = SManga.ONGOING;
    manga.author = "Joe Nobody";
    manga.artist = "Joe Nobody";
    return manga;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return new MangasPage([this.mangaInfo(page)], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.mangaInfo(1) : manga;
    const chapterList = fetchChapters ? await this.fetchChapterList(manga) : chapters;

    return new SMangaUpdate(details, chapterList);
  }

  private chapterNextPageSelector() {
    return "a.next";
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const allChaps: SChapter[] = [];
    let document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    while (true) {
      const chapters = document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));
      if (chapters.length === 0) break;

      allChaps.push(...chapters);

      const hasNext = !document.select(this.chapterNextPageSelector()).isEmpty();
      if (!hasNext) break;

      const nextUrl = document.select(this.chapterNextPageSelector()).attr("href");
      document = (await this.client.get(nextUrl)).asJsoup();
    }

    return allChaps.reverse();
  }

  private chapterListSelector() {
    return "div.listing-item > a.title";
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.name = element.text();
    chapter.url = urlWithoutDomain(element.attr("href"));
    return chapter;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    // Linked images are the language flag, subscribe banner and next-chapter buttons
    return document
      .select("img[data-orig-file]")
      .filter((it) => it.closest("a") == null)
      .map((img, i) => new Page(i, "", img.attr("src")));
  }
}
