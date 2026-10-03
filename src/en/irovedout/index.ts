// Port of keiyoushi/extensions-source src/en/irovedout/IRovedOut.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);

export default class IRovedOut extends KeiSource {
  override get supportsLatest() {
    return false;
  }
  private get archiveUrl() {
    return `${this.baseUrl}/archive`;
  }
  private readonly thumbnailUrl = "https://i.ibb.co/2g7Htwq/irovedout.png";
  private readonly seriesTitle = "I Roved Out in Search of Truth and Love";
  private readonly authorName = "Alexis Flower";
  private readonly seriesGenre = "Fantasy";
  private readonly seriesDescription = "I ROVED OUT IN SEARCH OF TRUTH AND LOVE is written & illustrated by Alexis Flower.\nIt updates in chunks anywhere between 3 and 30 pages long at least once a month.";
  private readonly titleRegex = /^Book (\d+): (.+)$/s;

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const mainPage = (await this.client.get(this.baseUrl)).asJsoup();
    const books = mainPage.select(`#menu-menu > li > a[href^=${this.archiveUrl}]`);

    let chapterCounter = 1;
    const chaptersByBook: SChapter[][] = [];
    for (const [bookIndex, book] of books.entries()) {
      const bookNumber = bookIndex + 1;
      const bookUrl = book.attr("href");
      const bookPage = (await this.client.get(bookUrl)).asJsoup();
      const chapterWraps = bookPage.select(".comic-archive-chapter-wrap");
      chaptersByBook.push(
        chapterWraps.map((it) => {
          const chapterWrap = it.selectFirst(".comic-archive-chapter-wrap")!;
          const chapter = SChapter.create();
          chapter.name = `Book ${bookNumber}: ${chapterWrap.selectFirst(".comic-archive-chapter")!.text()}`;
          chapter.url = chapterWrap.selectFirst(".comic-archive-title > a")!.attr("href");
          chapter.date_upload = dateFormat.tryParseDate(chapterWrap.select(".comic-archive-date").last()!.text());
          chapter.chapter_number = chapterCounter++;
          return chapter;
        }),
      );
    }
    return new SMangaUpdate(manga, chaptersByBook.flat().reverse());
  }

  override async getImageUrl(page: Page): Promise<string> {
    const comicPage = (await this.client.get(page.url)).asJsoup();
    return comicPage.selectFirst("#comic img")!.attr("src");
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const match = this.titleRegex.exec(chapter.name);
    if (!match) return [];
    const bookNumber = parseInt(match[1]);
    const title = match[2];
    const bookPage = (await this.client.get(this.archiveUrl + (bookNumber !== 1 ? `-book-${bookNumber}` : ""))).asJsoup();
    const chapterWrap = bookPage.select(".comic-archive-chapter-wrap").find((it) => it.selectFirst(".comic-archive-chapter")!.text() === title);
    const pageUrls = chapterWrap?.select(".comic-archive-list-wrap .comic-archive-title > a")?.map((it) => it.attr("href"));
    if (!pageUrls) return [];
    return pageUrls.map((pageUrl, pageIndex) => new Page(pageIndex, pageUrl));
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.url = "";
    manga.thumbnail_url = this.thumbnailUrl;
    manga.title = this.seriesTitle;
    manga.author = this.authorName;
    manga.artist = this.authorName;
    manga.description = this.seriesDescription;
    manga.genre = this.seriesGenre;
    manga.status = SManga.ONGOING;
    manga.initialized = true;
    return new MangasPage([manga], false);
  }

  getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}
