// Port of keiyoushi/extensions-source src/en/gunnerkriggcourt/GunnerkriggCourt.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

export default class GunnerkriggCourt extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.title = this.name;
    manga.artist = "Tom Siddell";
    manga.author = manga.artist;
    manga.status = SManga.ONGOING;
    manga.url = "/archives/";
    manga.description = [
      "Gunnerkrigg Court is a Science Fantasy webcomic by Tom Siddell about a strange young girl attending an equally strange school. The intricate story is deeply rooted in world mythology, but has a strong focus on science (chemistry and robotics, most prominently) as well.",
      "",
      "Antimony Carver begins classes at the eponymous U.K. Boarding School, and soon notices that strange events are happening: a shadow creature follows her around; a robot calls her \"Mummy\"; a Rogat Orjak smashes in the dormitory roof; odd birds, ticking like clockwork, stand guard in out-of-the-way places.",
      "",
      "Stranger still, in the middle of all this, Annie remains calm and polite to a fault.",
    ].join("\n");
    manga.thumbnail_url = "https://i.imgur.com/g2ukAIKh.jpg";

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

    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const chapterList = document
      .select("div.chapters option[value~=\\d*]")
      .map((element) => {
        const chapter = SChapter.create();
        const chapterNumStr = element.attr("value");
        const n = parseFloat(chapterNumStr);
        chapter.chapter_number = Number.isNaN(n) ? -1 : n;
        chapter.url = urlWithoutDomain(`/?p=${chapterNumStr}`);

        const title = element.parent()?.previousElementSibling()?.text() ?? "Chapter";
        chapter.name = `${title} (${chapter.chapter_number >= 0 ? Math.trunc(chapter.chapter_number) : chapterNumStr})`;
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();

    return document.select(".comic_image").map((element, i) => new Page(i, "", element.absUrl("src")));
  }
}
