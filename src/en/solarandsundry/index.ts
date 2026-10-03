// Port of keiyoushi/extensions-source src/en/solarandsundry/SolarAndSundry.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, tryParseInstant, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

const ACCEPT_IMAGE = "image/avif,image/webp,image/*,*/*";

const ARCHIVE_URL = "https://sas.ewanb.me";

interface SasPage {
  page_number: number;
  image_url: string;
  name: string;
  published_at: string;
}

export default class SolarAndSundry extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.title = "Solar and Sundry";
    manga.url = "/page";
    manga.author = "Ewan Breakey";
    manga.artist = manga.author;
    manga.status = SManga.ONGOING;
    manga.description = "a sci-fi horror webcomic about life blooming against all odds";
    manga.thumbnail_url = "https://imagedelivery.net/zthi1l8fKrUGB5ig08mq-Q/de292ba7-f164-4f43-ec17-1876a7a44600/public";
    return manga;
  }

  // Popular

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  // Latest

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  // Details & Chapters

  override getMangaUrl(_manga: SManga): string {
    return ARCHIVE_URL;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.createManga() : manga;
    if (!fetchChapters) return new SMangaUpdate(details, chapters);

    const pages = (await this.client.get(this.baseUrl + manga.url)).parseAs<SasPage[]>();
    const chapterList = pages
      .map((page) => {
        const chapter = SChapter.create();
        chapter.name = page.name;
        chapter.url = urlWithoutDomain(`${this.baseUrl}/page/${page.page_number}`);
        chapter.chapter_number = page.page_number;
        chapter.date_upload = tryParseInstant(page.published_at);
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(details, chapterList);
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${ARCHIVE_URL}/comic/${chapter.chapter_number}`;
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const page = (await this.client.get(this.baseUrl + chapter.url)).parseAs<SasPage>();

    return [new Page(0, "", page.image_url)];
  }

  override imageRequest(page: Page) {
    const request = super.imageRequest(page);
    const headers = new Headers(request.headers);
    headers.set("Accept", ACCEPT_IMAGE);
    return { ...request, headers };
  }
}
