// Port of keiyoushi/extensions-source src/en/killsixbilliondemons/KillSixBillionDemons.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, SwitchPreferenceCompat, substringAfter, substringBefore, urlWithoutDomain, type Document, type Element, type FilterList, type PreferenceScreen } from "../../../sdk/index.ts";

const ACTIVE_CHAPTER_PREF_KEY = "group_ended";
const AUTHOR_KSBD = "Abbadon";
const PAGES_ORDER = "?order=ASC";
const wordpressThumbnailRegex = /-\d+x\d+(?=\.(?:jpe?g|png|webp|gif)(?:\?.*)?$)/gi;

/** String.toFloatOrNull() */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null);

const isValidOption = (e: Element): boolean => {
  const text = e.text().trim();
  return e.attr("value") !== "0" && text.toLowerCase() !== "select chapter";
};
const isBookOption = (e: Element): boolean => isValidOption(e) && toFloatOrNull(substringBefore(e.text().trim(), " (").trim()) == null;

export default class KillSixBillionDemons extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private readonly descriptionKSBD = `Q: What is this all about?
This is a webcomic! It’s graphic novel style, meaning it’s meant to be read in large chunks, but you can subject yourself to the agony of reading it a couple pages a week!

Q: Do you have a twitter/tumble machine? Just who the hell draws this thing anyway?
A mysterious comics goblin named Abbadon draws this mess. My twitter is @orbitaldropkick, my tumblr is orbitaldropkick.tumblr.com. If you’re feeling dangerous, you can e-mail me at ksbdabbadon@gmail.com

Q: A webcomic, eh? When does it update?
Tuesday and Friday evenings (and occasionally weekends). Sometimes it will be up quite late on those days.

Q: Who’s this YISUN guy that keeps getting talked about?
Someone has not read their Psalms and Spasms recently!

Q: What’s this about suggestions?
KSBD will periodically take suggestions, mostly on characters to stick in the background. You can also stick fanart, character ideas, concepts, and literature in the ‘Submit’ section up above. You need tumblr for this. If you want to suggest directly, the best way to do it is through the comments section below the comic! A huge chunk of minor characters have been named and inspired by reader comments so far.

Q: Can I buy this book in a more traditional format?
You absolutely can. You can get your hands on a print copy of the first and second books from Image comics in your local comics shop or anywhere else you can get comics. It looks fantastic in print and if you don’t like reading stuff online I highly recommend it.`;

  private getUrlPath(url: string): string {
    try {
      // java.net.URI(url).path, or the url itself when empty / unparsable
      return new URL(url, "http://localhost").pathname || url;
    } catch {
      return url;
    }
  }

  // ========================= Popular =========================
  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage(await this.fetchBooksAsMangas(), false);
  }

  /**
   * This fetches the different books of Kill Six Billion Demons as different manga.
   * @return a list of all books in form of multiple manga
   */
  private async fetchBooksAsMangas(): Promise<SManga[]> {
    const doc = (await this.client.get(this.baseUrl)).asJsoup();
    const bookElements = doc.select("#chapter option").filter((it) => isBookOption(it));
    return Promise.all(
      bookElements.map(async (bookElement) => {
        const bookOverviewUrl = bookElement.attr("value");
        const bookTitle = substringBefore(bookElement.text(), " (");

        const manga = SManga.create();
        manga.title = bookTitle;
        manga.url = urlWithoutDomain(bookOverviewUrl);
        manga.artist = AUTHOR_KSBD;
        manga.author = AUTHOR_KSBD;
        manga.description = this.descriptionKSBD;
        manga.thumbnail_url = await this.fetchThumbnailUrl(bookOverviewUrl);
        manga.status = this.getStatusForBook(bookTitle, doc);
        return manga;
      }),
    );
  }

  /**
   * This fetches the Thumbnail given the url to a book overview. In ascending order the first
   * image will always be the cover of the given book.
   */
  private async fetchThumbnailUrl(bookOverviewUrl: string): Promise<string> {
    const overviewDoc = (await this.client.get(bookOverviewUrl + PAGES_ORDER)).asJsoup();
    return overviewDoc.selectFirst(".comic-thumbnail-in-archive a img")!.attr("src");
  }

  /**
   * Get the SManga status for a given book by checking if the title of the newest page contains
   * the title of the the given book.
   */
  private getStatusForBook(bookTitle: string, newestPage: Document): number {
    const bookTitleWithoutBook = substringAfter(bookTitle, ": ");
    const postTitle = newestPage.selectFirst(".post-title")?.text() ?? "";
    // title is "<book name> <page(s)>"
    return postTitle.toLowerCase().includes(bookTitleWithoutBook.toLowerCase()) ? SManga.UNKNOWN : SManga.COMPLETED;
  }

  // ========================= Latest =========================
  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Details & Chapters =========================
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = (async () => (fetchDetails ? ((await this.fetchBooksAsMangas()).find((it) => manga.title === it.title) ?? manga) : manga))();
    const chapterList = fetchChapters ? this.fetchChapterList(manga) : Promise.resolve(chapters);

    return new SMangaUpdate(await details, await chapterList);
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const doc = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    const options = doc.select("#chapter option");

    const allOptions = options.filter((it) => isValidOption(it));

    const groupEnded = this.preferences.getBoolean(ACTIVE_CHAPTER_PREF_KEY, false);

    const lastChapterIndex = allOptions.map((it) => !isBookOption(it)).lastIndexOf(true);

    const chapters: SChapter[] = [];
    let foundBook = false;
    let chapterIndex = 1;

    for (const [i, option] of allOptions.entries()) {
      const text = option.text().trim();
      const value = option.attr("value");

      if (isBookOption(option)) {
        if (foundBook) {
          // Reached the next book, stop gathering chapters
          break;
        }
        const optionPath = this.getUrlPath(value).replace(/\/$/, "");
        const mangaPath = this.getUrlPath(manga.url).replace(/\/$/, "");
        if (optionPath.toLowerCase() === mangaPath.toLowerCase()) foundBook = true;
      } else if (foundBook) {
        const chapterTitle = `Chapter ${substringBefore(text, " (").trim()}`;
        const shouldExpand = !groupEnded || i === lastChapterIndex;

        if (shouldExpand) {
          chapters.push(...(await this.fetchActiveChapterPages(this.getUrlPath(value), chapterTitle, chapterIndex++)));
        } else {
          const chapter = SChapter.create();
          chapter.url = urlWithoutDomain(value);
          chapter.name = chapterTitle;
          chapter.chapter_number = chapterIndex++;
          chapter.date_upload = 0;
          chapters.push(chapter);
        }
      }
    }

    return chapters.reverse();
  }

  /**
   * Fetches all pages of the active chapter from the website, following the archive pagination,
   * creating individual chapter entries for each.
   */
  private async fetchActiveChapterPages(chapterUrl: string, chapterTitle: string, startChapterNumber: number): Promise<SChapter[]> {
    const list: SChapter[] = [];
    let currentUrl = this.baseUrl + chapterUrl + PAGES_ORDER;

    for (;;) {
      const currentPage = (await this.client.get(currentUrl)).asJsoup();

      const links = currentPage.select(".comic-thumbnail-in-archive a");
      for (const link of links) {
        const href = link.attr("href");
        const title = link.attr("title").trim();
        if (href.length > 0) {
          const pageNum = list.length + 1;
          const pageTitle = title.length > 0 ? `${chapterTitle} - ${title}` : `${chapterTitle} Page ${pageNum}`;
          const chapter = SChapter.create();
          chapter.url = urlWithoutDomain(href);
          chapter.name = pageTitle;
          chapter.chapter_number = startChapterNumber + pageNum / 1000;
          chapter.date_upload = 0;
          list.push(chapter);
        }
      }

      currentUrl = currentPage.select(".paginav-next a").attr("href");
      if (currentUrl.length === 0) break;
    }
    return list;
  }

  // ========================= Pages =========================

  /**
   * Collects comic page images for a chapter, following pagination. Supports both chapter
   * archives (with multiple thumbnails) and individual comic pages.
   */
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const list: Page[] = [];
    let currentUrl = this.baseUrl + chapter.url + PAGES_ORDER;

    for (;;) {
      const currentPage = (await this.client.get(currentUrl)).asJsoup();

      const images = currentPage.select(".comic-thumbnail-in-archive a img");
      if (!images.isEmpty()) {
        for (const img of images) {
          const src = img.attr("src");
          if (src.length > 0) list.push(new Page(list.length + 1, "", src.replace(wordpressThumbnailRegex, "")));
        }
      } else {
        const src = currentPage.selectFirst("#comic img")?.attr("src");
        if (src != null && src.length > 0) list.push(new Page(list.length + 1, "", src.replace(wordpressThumbnailRegex, "")));
      }

      currentUrl = currentPage.select(".paginav-next a").attr("href");
      if (currentUrl.length === 0) break;
    }
    return list;
  }

  // ========================= Search =========================
  getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("Search functionality is not available.");
  }

  // ========================= Preferences =========================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const activeChapterPref = new SwitchPreferenceCompat(screen.context);
    activeChapterPref.key = ACTIVE_CHAPTER_PREF_KEY;
    activeChapterPref.title = "Group ended chapters";
    activeChapterPref.summary = "Group pages into chapters when they have fully ended. For the active/ongoing chapter, its pages will be listed individually.";
    activeChapterPref.setDefaultValue(false);
    screen.addPreference(activeChapterPref);
  }
}
