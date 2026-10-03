// Port of keiyoushi/extensions-source src/en/gwtb/GWTB.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

export default class GWTB extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.title = this.name;
    manga.url = "/index.php";
    manga.author = "Kimmo Lemetti";
    manga.artist = "Kimmo Lemetti";
    manga.thumbnail_url = `${this.baseUrl}/images/yarr.jpg`;
    manga.description = "Because war can be boring too.";
    return new MangasPage([manga], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let updatedChapters = chapters;
    if (fetchChapters) {
      updatedChapters = (await this.client.get(this.getMangaUrl(manga))).asJsoup().select(".fall > option:not(:first-child)").map((it) => {
        const chapter = SChapter.create();
        chapter.name = it.ownText();
        chapter.url = `/index.php?nro=${it.attr("value")}`;
        const n = parseFloat(it.attr("value"));
        if (Number.isNaN(n)) throw new Error("NumberFormatException");
        chapter.chapter_number = n;
        return chapter;
      });
    }
    return new SMangaUpdate(manga, updatedChapters);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const doc = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return [new Page(0, "", doc.selectFirst(".comic_title + img")!.absUrl("src"))];
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}
