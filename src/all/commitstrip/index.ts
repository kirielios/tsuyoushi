// Port of keiyoushi/extensions-source src/all/commitstrip/CommitStrip.kt
import { DateTimeFormatter, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, distinctBy, type FilterList, type Request, type Response } from "../../../sdk/index.ts";

const LOGO_EN = "https://i.imgur.com/HODJlt9.jpg";
const LOGO_FR = "https://i.imgur.com/I7ps9zS.jpg";
const AUTHOR_EN = "Mark Nightingale";
const AUTHOR_FR = "Thomas Gx";
const ARTIST = "Etienne Issartial";
const SUMMARY_EN = "The blog relating the daily life of web agency developers.";
const SUMMARY_FR = "Le blog qui raconte la vie des codeurs";
const NOTE = "\n\nNote: This entry includes all the chapters published in";

const dateRegex = /\d{4}\/\d{2}\/\d{2}/;
const pageRegex = /\d+/g;

const currentYear = () => new Date().getFullYear();

export default class CommitStrip extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  private get siteLang(): string {
    return this.lang;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy/MM/dd", Locale.US);

  // Helper

  private createManga(year: number): SManga {
    const manga = SManga.create();
    manga.url = `${this.baseUrl}/${this.siteLang}/${year}`;
    manga.title = `${this.name} (${year})`;
    manga.thumbnail_url = this.lang === "fr" ? LOGO_FR : LOGO_EN;
    manga.author = this.lang === "fr" ? AUTHOR_FR : AUTHOR_EN;
    manga.artist = ARTIST;
    manga.status = year !== currentYear() ? SManga.COMPLETED : SManga.ONGOING;
    manga.description = `${this.lang === "fr" ? SUMMARY_FR : SUMMARY_EN} ${NOTE} ${year}`;
    return manga;
  }

  // Popular

  override async fetchPopularManga(_page: number): Promise<MangasPage> {
    // have one manga entry for each year
    const mangas: SManga[] = [];
    for (let y = currentYear(); y >= 2012; y--) mangas.push(this.createManga(y));
    return new MangasPage(mangas, false);
  }

  // Search

  override async fetchSearchManga(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangaPage = await this.fetchPopularManga(1);
    const filtered = mangaPage.mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(filtered, false);
  }

  // Details

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    manga.initialized = true;
    return manga;
  }

  // Open in WebView

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${manga.url}/?`, this.headers);
  }

  // Chapters

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const first = await this.executeSuccess(GET(manga.url, this.headers));
    const responseString = first.asJsoup().selectFirst(".wp-pagenavi .pages")?.text() ?? "1";
    const nums = responseString.match(pageRegex);
    const pages = nums && nums.length > 0 ? Number.parseInt(nums[nums.length - 1], 10) : 1;

    const all: SChapter[] = [];
    for (let page = 1; page <= pages; page++) {
      const response = await this.client.execute(GET(`${manga.url}/page/${page}`, this.headers));
      if (!response.isSuccessful) throw new Error(`HTTP error ${response.code}`);
      for (const element of response.asJsoup().select(".excerpt a")) {
        const chapter = SChapter.create();
        const href = element.attr("href");
        chapter.url = `${this.baseUrl}/${this.siteLang}${href.includes(this.baseUrl) ? href.substring(href.indexOf(this.baseUrl) + this.baseUrl.length) : href}`;

        // get the chapter date from the url
        const dateStr = dateRegex.exec(chapter.url)?.[0];
        chapter.date_upload = this.dateFormat.tryParseDate(dateStr);

        chapter.name = element.select("span").text();
        all.push(chapter);
      }
    }
    const chapters = distinctBy(all, (it) => it.url);

    const total = chapters.length;
    chapters.forEach((chapter, index) => {
      chapter.chapter_number = total - index;
    });

    return chapters;
  }

  // Page

  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.execute(GET(chapter.url, this.headers));
    const imageUrl = response.asJsoup().selectFirst(".entry-content p img")?.absUrl("src") ?? "";
    return [new Page(0, "", imageUrl)];
  }

  // Unsupported

  protected popularMangaRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected popularMangaParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
  protected searchMangaRequest(_page: number, _query: string, _filters: FilterList): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected searchMangaParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
  protected mangaDetailsParse(_response: Response): SManga {
    throw new Error("UnsupportedOperationException");
  }
  protected chapterListParse(_response: Response): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }
  protected pageListParse(_response: Response): Page[] {
    throw new Error("UnsupportedOperationException");
  }
  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
