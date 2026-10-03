// Port of keiyoushi/extensions-source src/en/schlockmercenary/Schlockmercenary.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringBefore } from "../../../sdk/index.ts";

const DEFAULT_THUMBNAIL_URL = "/static/img/logo.b6dacbb8.jpg";
const ARCHIVE_URL = "/archives/";

const TITLE_SANITIZATION_REGEX = /(["',])/g;
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US);

// LocalDate as UTC midnight millis
const parseLocalDate = (text: string): number => {
  const v = dateFormat.tryParseDate(text, "UTC");
  if (!v && text !== "1970-01-01") throw new Error(`Text '${text}' could not be parsed`);
  return v;
};
const formatLocalDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export default class Schlockmercenary extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // Books

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}${ARCHIVE_URL}`)).asJsoup();
    const mangas = document.select("div.archive-book").map((element) => {
      const book = element.selectFirst("h4 > a")!;
      const thumbUrl = element.selectFirst("img")?.attr("abs:src") ?? `${this.baseUrl}${DEFAULT_THUMBNAIL_URL}`;
      const manga = SManga.create();
      manga.url = book.attr("href");
      manga.title = book.text();
      manga.artist = "Howard Tayler";
      manga.author = "Howard Tayler";
      // Schlock Mercenary finished as of July 2020
      manga.status = SManga.COMPLETED;
      manga.description = element.selectFirst("p")?.text() ?? "";
      manga.thumbnail_url = substringBefore(thumbUrl, "?");
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const document = (await this.client.get(`${this.baseUrl}${ARCHIVE_URL}`)).asJsoup();
    const sanitizedTitle = manga.title.replace(TITLE_SANITIZATION_REGEX, "\\$1");
    const book = document.select(`div.archive-book:contains(${sanitizedTitle})`);

    const chapterList = book
      .select("ul.chapters > li:not(ul > li > ul > li) > a")
      .map((element, index) => {
        const chapter = SChapter.create();
        chapter.url = element.attr("href");
        chapter.name = element.text();
        chapter.chapter_number = index + 1;
        chapter.date_upload = dateFormat.tryParseDate(chapter.url.slice(-10));
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(`${this.baseUrl}${ARCHIVE_URL}`)).asJsoup();

    const currentChapter = document.selectFirst(`ul.chapters > li:not(ul > li > ul > li) > a[href=${chapter.url}]`);
    if (!currentChapter) return [];

    const start = parseLocalDate(currentChapter.attr("href").slice(-10));
    let nextChapter = currentChapter.parent()?.nextElementSibling()?.selectFirst("a") ?? null;

    if (nextChapter == null) {
      nextChapter = currentChapter.parents()[2]?.nextElementSibling()?.selectFirst("ul.chapters > li:not(ul > li > ul > li) > a") ?? null;
    }

    const end = nextChapter ? parseLocalDate(nextChapter.attr("href").slice(-10)) : start + DAY;

    return this.generatePageListBetweenDates(start, end);
  }

  private async generatePageListBetweenDates(start: number, end: number): Promise<Page[]> {
    const pages: Page[] = [];
    let day = start;

    while (day < end) {
      for (const it of await this.getImageUrlsForDay(formatLocalDate(day))) pages.push(new Page(pages.length, "", it));
      day += DAY;
    }

    return pages;
  }

  private async getImageUrlsForDay(day: string): Promise<string[]> {
    const document = (await this.client.get(`${this.baseUrl}/${day}`)).asJsoup();
    return document.select(`div#strip-${day} > img`).map((it) => it.attr("abs:src"));
  }

  // Search

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  // Latest

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}
