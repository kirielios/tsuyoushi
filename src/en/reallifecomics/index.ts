// Port of keiyoushi/extensions-source src/en/reallifecomics/RealLifeComics.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, urlWithoutDomain, type Element } from "../../../sdk/index.ts";

const LOGO = "/images/logo.png";
const AUTHOR = "Maelyn Dean";
const SUMMARY = "The normal daily lives of some abnormal people. This entry includes all the chapters published in";

const currentYear = (): number => new Date().getFullYear();

export default class RealLifeComics extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMMM yyyy d", Locale.US);

  // Helper

  private createManga(year: number): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(`${this.baseUrl}/archivepage.php?year=${year}`);
    manga.title = `${this.name} (${year})`;
    manga.thumbnail_url = `${this.baseUrl}${LOGO}`;
    manga.author = AUTHOR;
    manga.status = year !== currentYear() ? SManga.COMPLETED : SManga.ONGOING;
    manga.description = `${SUMMARY} ${year}`;
    return manga;
  }

  // Popular

  async getPopularManga(_page: number): Promise<MangasPage> {
    // create one manga entry for each yearly archive
    // skip 2016 and 2017 as they don't have any archive
    const mangas: SManga[] = [];
    for (let y = currentYear(); y >= 1999; y--) if (y < 2016 || y > 2017) mangas.push(this.createManga(y));

    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangaList = await this.getPopularManga(1);
    const filtered = mangaList.mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(filtered, mangaList.hasNextPage);
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const list = (await this.client.get(this.getMangaUrl(manga))).asJsoup().select(".calendar tbody tr td a").map((e) => this.chapterFromElement(e));
    const chapterList = distinctBy(list, (it) => it.url).map((chapter, index) => {
      chapter.chapter_number = index;
      return chapter;
    });

    return new SMangaUpdate(manga, chapterList);
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = element.attr("href");

    // entries between 1999-2014 do not have dates in the link
    // but all entries are placed in a calendar class which has the month & year as heading
    // figure out a date using the calendar
    const monthYear = element.closest(".calendar")?.previousElementSiblings().select("h4.month").first()?.text() ?? "";

    const date = `${monthYear} ${element.text()}`.trim();
    const time = this.dateFormat.tryParseDate(date);

    chapter.date_upload = time;
    chapter.name = time !== 0 ? formatNameDate(time) : date;
    return chapter;
  }

  // Page

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const image = (await this.client.get(this.getChapterUrl(chapter))).asJsoup().selectFirst(".comic img")?.attr("abs:src") ?? "";
    return [new Page(0, "", image)];
  }
}

// DateTimeFormatter.ofPattern("EEEE, MMM dd, yyyy", Locale.US) in the system zone
function formatNameDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const s = (o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-US", o);
  return `${s({ weekday: "long" })}, ${s({ month: "short" })} ${p(d.getDate())}, ${d.getFullYear()}`;
}
