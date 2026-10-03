// Port of keiyoushi/extensions-source src/en/clonemanga/CloneManga.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

const PAGE_REGEX = /&page=(.*?)&lang=/g;

export default class CloneManga extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/viewer_landing.php`)).asJsoup();
    const mangas = document.select(".comicPreviewContainer").map((element) => {
      const attr = element.select(".comicPreview").attr("style");
      const manga = SManga.create();
      manga.title = element.select("h3").first()!.text();
      manga.artist = "Dan Kim";
      manga.author = "Dan Kim";
      manga.status = SManga.UNKNOWN;
      manga.url = "/" + element.select("a").first()!.attr("href").replace(/^\//, "");
      manga.description = element.select("h4").first()?.text() ?? "";
      manga.thumbnail_url = `${this.baseUrl}/` + attr.substring(attr.indexOf("site/themes"), attr.indexOf(")"));
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas = (await this.getPopularManga(1)).mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(mangas, false);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const seriesPath = document.location().replace(new RegExp(`^${this.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
    const scriptContent = document.select("script")[3].outerHtml();
    const match = [...scriptContent.matchAll(PAGE_REGEX)][3];
    if (!match) throw new Error("IndexOutOfBoundsException");
    const numChapters = parseInt(match[1]);
    if (Number.isNaN(numChapters)) throw new Error("NumberFormatException");

    const chapterList: SChapter[] = [];
    for (let i = 1; i <= numChapters; i++) {
      const chapter = SChapter.create();
      chapter.url = `${seriesPath}&page=${i}`;
      chapter.name = `Chapter ${i}`;
      chapter.chapter_number = i;
      chapterList.push(chapter);
    }
    return new SMangaUpdate(manga, chapterList.reverse());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const imgAbsoluteUrl = document.select(".subsectionContainer").first()!.select("img").first()!.absUrl("src");
    return [new Page(1, "", imgAbsoluteUrl)];
  }
}
