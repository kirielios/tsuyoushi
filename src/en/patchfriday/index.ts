// Port of keiyoushi/extensions-source src/en/patchfriday/PatchFriday.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

export default class PatchFriday extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.initialized = true;
    manga.title = "Patch Friday";
    manga.status = SManga.ONGOING;
    manga.url = "";
    manga.author = "Patch Friday";
    manga.artist = manga.author;
    manga.thumbnail_url = "https://patchfriday.com/patches/68.png";
    manga.description = "The IT security webcomic";
    return manga;
  }

  // Popular

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  // Latest

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  // Details + Chapters

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.createManga() : manga;
    const chapterList = fetchChapters ? await this.fetchChapterList() : chapters;

    return new SMangaUpdate(details, chapterList);
  }

  private async fetchChapterList(): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    let document = (await this.client.get(`${this.baseUrl}/search/?search=`)).asJsoup();
    let page = parseInt(document.select("div > div:first-of-type > div:first-of-type > a").attr("abs:href").replace(this.baseUrl, "").replaceAll("/", "").trim());
    if (Number.isNaN(page)) throw new Error("NumberFormatException");
    while (page > 0) {
      const element = document.select("div > div > div:first-of-type > a");
      element.forEach((it) => {
        const chapter = SChapter.create();
        chapter.url = it.attr("abs:href").replace(this.baseUrl, "").trim();
        chapter.chapter_number = parseFloat(chapter.url.replaceAll("/", "").trim());
        chapter.name = `#${Math.trunc(chapter.chapter_number)} - ${it.text()}`;
        chapter.date_upload = Date.now();
        chapters.push(chapter);
      });
      page -= 10;
      document = (await this.client.get(`${this.baseUrl}/search/?search=&id=${page}`)).asJsoup();
    }
    // Add First Chapter becouse for some reason it does not show up in chapter search
    const first = SChapter.create();
    first.url = "/1/";
    first.chapter_number = parseFloat(first.url.replaceAll("/", "").trim());
    first.name = `#${Math.trunc(first.chapter_number)} - The One`;
    first.date_upload = Date.now();
    chapters.push(first);
    return chapters;
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return [new Page(0, this.baseUrl + chapter.url)];
  }

  override async getImageUrl(page: Page): Promise<string> {
    return (await this.client.get(page.url)).asJsoup().select("div#strip_image img").attr("abs:src");
  }
}
