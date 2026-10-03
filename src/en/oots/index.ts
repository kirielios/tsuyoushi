// Port of keiyoushi/extensions-source src/en/oots/OOTS.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, type FilterList } from "../../../sdk/index.ts";

const NUMBER_REGEX = /oots(\d+)\.html/;

export default class OOTS extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.title = "The Order Of The Stick";
    manga.artist = "Rich Burlew";
    manga.author = "Rich Burlew";
    manga.status = SManga.ONGOING;
    manga.url = "/comics/oots.html";
    manga.description = "Having fun with games.";
    manga.thumbnail_url = "https://i.giantitp.com/redesign/Icon_Comics_OOTS.gif";
    manga.initialized = true;

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
    const elements = document.select("p.ComicList a");

    const currentTimeMillis = Date.now();
    const prefs = this.preferences;
    const editor = prefs.edit();

    const chapterList = distinctBy(
      elements.map((element) => {
        const chapter = SChapter.create();
        chapter.url = element.attr("href");
        chapter.name = element.text();

        const numberStr = NUMBER_REGEX.exec(chapter.url)?.[1] ?? "";
        const n = parseFloat(numberStr);
        chapter.chapter_number = Number.isNaN(n) ? -1 : n;

        if (numberStr) {
          if (!prefs.contains(numberStr)) editor.putLong(numberStr, currentTimeMillis);
          chapter.date_upload = prefs.getLong(numberStr, currentTimeMillis);
        } else {
          chapter.date_upload = currentTimeMillis;
        }
        return chapter;
      }),
      (it) => it.url,
    );

    editor.apply();

    return new SMangaUpdate(manga, chapterList.reverse());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const imageUrl = document.select("td[align='center'] > img").attr("abs:src");
    return [new Page(0, "", imageUrl)];
  }
}
