// Port of keiyoushi/extensions-source src/en/supermega/Supermega.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

export default class Supermega extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain("/");
    manga.title = "SUPER MEGA";
    manga.artist = "JohnnySmash";
    manga.author = "JohnnySmash";
    manga.status = SManga.ONGOING;
    manga.description = "";
    manga.thumbnail_url = "https://www.supermegacomics.com/runningman.png";
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

  async fetchMangaUpdate(_manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const manga = this.createManga();
    let chapterList = chapters;
    if (fetchChapters) {
      const document = (await this.client.get(this.baseUrl)).asJsoup();
      const href = document.selectFirst("[name='bigbuttonprevious']")?.parent()?.attr("abs:href");
      let i: number | null = null;
      try {
        const n = href ? new URL(href).searchParams.get("i") : null;
        i = n != null && /^[+-]?\d+$/.test(n) ? parseInt(n) : null;
      } catch {
        i = null;
      }
      const latestComicNumber = i != null ? i + 1 : 0;

      chapterList = [];
      for (let it = latestComicNumber; it >= 1; it--) {
        const chapter = SChapter.create();
        chapter.name = String(it);
        chapter.chapter_number = it;
        chapter.url = urlWithoutDomain(`?i=${it}`);
        chapterList.push(chapter);
      }
    }

    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.baseUrl + chapter.url)).asJsoup().select("img[border='4']").map((element, i) => new Page(i, "", element.absUrl("src")));
  }
}
