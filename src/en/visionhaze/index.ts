// Port of keiyoushi/extensions-source src/en/visionhaze/VisionHaze.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfterLast, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

export default class VisionHaze extends KeiSource {
  private manga(): SManga {
    const manga = SManga.create();
    manga.title = "Vision Haze";
    manga.thumbnail_url = `${this.baseUrl}/_assets/media/banners/banner0.png`;
    manga.author = "Yttrium";
    manga.status = SManga.UNKNOWN;
    manga.url = "/";
    manga.initialized = true;
    return manga;
  }

  override get supportsLatest(): boolean {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.manga()], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([this.manga()], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) {
      return new SMangaUpdate(manga, chapters);
    }

    const document = (await this.client.get(`${this.baseUrl}/archive/`)).asJsoup();
    const chapterTitles = document.select(".archive").map((it) => it.select("b").text());
    const chapterPayload = document.select(".archivepayload");

    const chapterList: SChapter[] = [];
    // zip: stops at the shorter list
    for (let i = 0; i < Math.min(chapterTitles.length, chapterPayload.length); i++) {
      const cTitle = chapterTitles[i];
      for (const it of chapterPayload[i].select("a")) {
        const url = it.absUrl("href");
        const pageNum = it.text();
        const title = `Page ${pageNum} - ${cTitle}`;
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(url);
        chapter.name = title;
        chapterList.push(chapter);
      }
    }

    return new SMangaUpdate(manga, chapterList.reverse());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const raw = substringAfterLast(chapter.url, "?p=");
    const pageNum = /^[+-]?\d+$/.test(raw) ? parseInt(raw) : NaN;
    if (Number.isNaN(pageNum)) return [];
    const pageNumFormatted = String(pageNum).padStart(3, "0");
    return [new Page(0, "", `${this.baseUrl}/comic/p${pageNumFormatted}.png`)];
  }
}
