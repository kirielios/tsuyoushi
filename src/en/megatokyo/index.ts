// Port of keiyoushi/extensions-source src/en/megatokyo/Megatokyo.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfterLast, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

const ordinalRegex = /(\d+)(st|nd|rd|th)/g;

export default class Megatokyo extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private readonly dateParser = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

  // ponytail: upstream's configureClient() = ignoreAllSSLErrors() (naive trust manager); the SDK has no TLS knob and the
  // host owns certificate validation, so it is not ported.

  private createManga(): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain("/archive.php?list_by=date");
    manga.title = "Megatokyo";
    manga.artist = "Fred Gallagher";
    manga.author = "Fred Gallagher";
    manga.status = SManga.ONGOING;
    manga.description = "Relax, we understand j00";
    manga.thumbnail_url = "https://i.ibb.co/yWQM1gY/megatokyo.png";
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedManga = fetchDetails ? this.createManga() : manga;
    if (!fetchChapters) return new SMangaUpdate(updatedManga, chapters);

    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const chapterList = document
      .select("div.content h2:contains(Comics by Date) + div ul li a[name]")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.url = element.attr("href");
        const n = parseFloat(substringAfterLast(chapter.url, "/"));
        chapter.chapter_number = Number.isNaN(n) ? -1 : n;
        chapter.name = element.text();
        chapter.date_upload = this.dateParser.tryParseDate(element.attr("title").replace(ordinalRegex, "$1"));
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(updatedManga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#strip img").map((element, i) => new Page(i, "", element.absUrl("src")));
  }
}
