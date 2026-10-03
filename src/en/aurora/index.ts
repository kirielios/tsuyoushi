// Port of keiyoushi/extensions-source src/en/aurora/Aurora.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, substringBefore, urlWithoutDomain, type Document } from "../../../sdk/index.ts";

const auroraDescription = `Aurora is a fantasy webcomic (updates M/W/F) written and illustrated by Red, better known for her work on the YouTube channel “Overly Sarcastic Productions.” It’s been in the works for over a decade, and she’s finally decided to stop putting it off.

If you’d like to discuss the comic, it now has a subreddit, as well as a dedicated twitter and a tumblr where you can ask questions. There’s also a dedicated room on the channel discord for conversations about it!

Find Red’s general ramblings on Twitter, alongside her cohost Blue, at OSPYouTube.`;

export default class Aurora extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.US);

  /**
   * Because the comic is updated 1 page at a time the chapters are turned into different mangas
   * so that the pages can be turned into different chapters which can be automatically updated by
   * Tachiyomi.
   *
   * @return List of all Chapters as separate mangas
   */
  async getPopularManga(_page: number): Promise<MangasPage> {
    const chapterOverviewDoc = (await this.client.get(`${this.baseUrl}/archive/`)).asJsoup();
    const chapterBlockElements = chapterOverviewDoc.select(".wp-block-image:has(a)");
    const mangasFromChapters = chapterBlockElements.map((chapter, chapterIndex) => {
      const chapterOverviewLink = chapter.selectFirst("a")!;
      const chapterOverviewUrl = chapterOverviewLink.attr("href");
      const chapterTitle = `${this.name} - ${chapterOverviewLink.text()}`;
      const chapterThumbnail = chapter.selectFirst("img")!.attr("src");

      const manga = SManga.create();
      manga.url = urlWithoutDomain(chapterOverviewUrl);
      manga.title = chapterTitle;
      manga.author = "OSP-Red";
      manga.description = auroraDescription;
      manga.genre = "fantasy";
      // this will mark every chapter except the last one as completed
      manga.status = chapterIndex >= chapterBlockElements.length - 1 ? SManga.UNKNOWN : SManga.COMPLETED;
      manga.thumbnail_url = chapterThumbnail;
      manga.initialized = true;
      return manga;
    });

    return new MangasPage(mangasFromChapters, false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedChapters = fetchChapters ? await this.fetchChapterListTR(this.baseUrl + manga.url) : chapters;
    return new SMangaUpdate(manga, updatedChapters);
  }

  private async fetchChapterListTR(currentUrl: string): Promise<SChapter[]> {
    const firstPage = (await this.client.get(currentUrl)).asJsoup();

    const pages: Document[] = await Promise.all([Promise.resolve(firstPage), ...firstPage.select("#paginav a[title]").slice(1).map(async (it) => (await this.client.get(it.attr("href"))).asJsoup())]);

    return pages
      .flatMap((page) =>
        page.select(".post-content").map((postContent) => {
          const chapterUrl = postContent.select("a.webcomic-link").attr("href");
          const title = postContent.select(".post-title a").text();
          const chapterNo = toFloat(substringBefore(substringAfter(title, "."), "-"));
          const date = this.dateFormat.tryParseDate(postContent.select(".post-date").text());

          const chapter = SChapter.create();
          chapter.url = urlWithoutDomain(chapterUrl);
          chapter.name = title;
          chapter.chapter_number = chapterNo;
          chapter.date_upload = date;
          return chapter;
        }),
      )
      .reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.baseUrl + chapter.url))
      .asJsoup()
      .select(".webcomic-media .webcomic-link .attachment-full")
      .map((page, idx) => new Page(idx, "", page.attr("src")));
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}

/** String.toFloat(): throws NumberFormatException */
function toFloat(s: string): number {
  const n = Number(s.trim());
  if (s.trim() === "" || Number.isNaN(n)) throw new Error(`NumberFormatException: ${s}`);
  return Math.fround(n);
}
