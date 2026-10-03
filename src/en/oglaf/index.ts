// Port of keiyoushi/extensions-source src/en/oglaf/Oglaf.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

const nameRegex = /\/(.*)\//;
const urlRegex = /^\/.*\/\d*\/$/s;

export default class Oglaf extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.title = "Oglaf";
    manga.artist = "Trudy Cooper & Doug Bayne";
    manga.author = "Trudy Cooper & Doug Bayne";
    manga.status = SManga.ONGOING;
    manga.url = "/archive/";
    manga.description = "Filth and other Fantastical Things in handy webcomic form.";
    manga.thumbnail_url = "https://i.ibb.co/tzY0VQ9/oglaf.png";

    return new MangasPage([manga], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    const chapterList: SChapter[] = [];
    // mapNotNull{...}.distinct(): SChapter is a class upstream (identity equality), so nothing is ever dropped
    for (const element of document.select("a:has(img[width=400])")) {
      const href = element.attr("href");
      const nameMatch = nameRegex.exec(href);
      if (!nameMatch) continue;
      const chapter = SChapter.create();
      chapter.url = href;
      chapter.name = nameMatch[1];
      chapterList.push(chapter);
    }

    chapterList.forEach((ch, i) => {
      ch.chapter_number = chapterList.length - i;
    });
    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pages: Page[] = [];
    let document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();

    while (true) {
      const imageUrl = document.selectFirst("img#strip")?.attr("abs:src");
      if (imageUrl === undefined) break;
      pages.push(new Page(pages.length, "", imageUrl));

      const nextUrl = document.selectFirst("a[rel=next]")?.attr("href");
      if (nextUrl != null && urlRegex.test(nextUrl)) {
        document = (await this.client.get(this.baseUrl + nextUrl)).asJsoup();
      } else {
        break;
      }
    }

    return pages;
  }
}
