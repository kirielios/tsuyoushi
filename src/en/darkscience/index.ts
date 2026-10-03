// Port of keiyoushi/extensions-source src/en/darkscience/DarkScience.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type Document } from "../../../sdk/index.ts";

export default class DarkScience extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private initTheManga(manga: SManga): SManga {
    manga.url = "/category/darkscience/";
    manga.thumbnail_url = "https://dresdencodak.com/wp-content/uploads/2019/03/DC_CastIcon_Kimiko.png";
    manga.title = this.name;
    manga.author = "Sen (A. Senna Diaz)";
    manga.artist = "Sen (A. Senna Diaz)";
    manga.description = `Scientist Kimiko Ross has a problem:
her money’s gone and a bank exploded her house. With no place
else to go, she travels to Nephilopolis, the city of giants –
built from the ruins of an ancient war and a fading memory of
tomorrow.
 Follow our cyborg hero as she attempts to survive the
bureaucratic behemoth with a little “help” from her “friends.”
And what exactly is Dark Science anyway?
Support the comic on
Patreon: https://www.patreon.com/dresdencodak
`;
    manga.genre = "Science Fiction, Mystery, LGBT+";
    manga.status = SManga.ONGOING;
    manga.initialized = true;
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.initTheManga(SManga.create())], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedManga = this.initTheManga(manga);
    if (!fetchChapters) return new SMangaUpdate(updatedManga, chapters);

    const updatedChapters: SChapter[] = [];

    let archivePage: Document | null = (await this.client.get(this.baseUrl + updatedManga.url)).asJsoup();

    let chLast = 0;

    while (archivePage != null) {
      const nextArchivePageUrl: string | undefined = archivePage.selectFirst("#nav-below .nav-previous > a")?.attr("href");
      const nextArchivePage: Document | null = nextArchivePageUrl != null ? (await this.client.get(nextArchivePageUrl)).asJsoup() : null;

      for (const it of archivePage.select("#content article header > h2 > a")) {
        const chTitle = it.text();
        const chLink = it.attr("href");
        const n = Number(this.chapterNumberRegex.exec(chTitle)?.[1]);
        const chNum = Number.isNaN(n) ? Math.fround(chLast + 0.01) : n;

        const chapter = SChapter.create();
        chapter.name = chTitle;
        chapter.chapter_number = chNum;
        chapter.date_upload = this.dateFormat.tryParseDate(this.chapterDateRegex.exec(chLink)?.[1]);
        chapter.url = urlWithoutDomain(chLink);
        updatedChapters.push(chapter);

        // This is a hack to make the app not think there’s missing chapters after
        // a title page.
        chLast = chNum;
      }

      archivePage = nextArchivePage;
    }

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return [new Page(0, "", (await this.client.get(this.getChapterUrl(chapter))).asJsoup().selectFirst("article.post img.aligncenter")!.attr("src"))];
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy/MM/dd", Locale.US);
  private readonly chapterDateRegex = /\/(\d\d\d\d\/\d\d\/\d\d)\//;
  private readonly chapterNumberRegex = /Dark Science #(\d+)/;
}
