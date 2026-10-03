// Port of keiyoushi/extensions-source src/en/existentialcomics/ExistentialComics.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, substringAfterLast, urlWithoutDomain } from "../../../sdk/index.ts";

export default class ExistentialComics extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.title = "Existential Comics";
    manga.artist = "Corey Mohler";
    manga.author = "Corey Mohler";
    manga.status = SManga.ONGOING;
    manga.url = "/archive/byDate";
    manga.description = "A philosophy comic about the inevitable anguish of living a brief life in an absurd world. Also Jokes.";
    manga.thumbnail_url = "https://i.ibb.co/pykMVYM/existential-comics.png";
    return new MangasPage([manga], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const list = (await this.client.get(this.getMangaUrl(manga))).asJsoup().select("div#date-comics ul li a:eq(0)").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("href"));
      chapter.name = element.text();
      const n = Number.parseFloat(substringAfterLast(chapter.url, "/"));
      chapter.chapter_number = Number.isNaN(n) ? 0 : n;
      return chapter;
    });
    return new SMangaUpdate(manga, distinctBy(list, (it) => it.url).reverse());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.getChapterUrl(chapter))).asJsoup().select(".comicImg").map((element, i) => new Page(i, "", element.attr("abs:src")));
  }
}
