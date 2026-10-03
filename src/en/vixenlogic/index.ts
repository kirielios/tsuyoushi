// Port of keiyoushi/extensions-source src/en/vixenlogic/VixenLogic.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneOffset, startOfDayUtc, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

export default class VixenLogic extends KeiSource {
  private manga(): SManga {
    const manga = SManga.create();
    manga.title = "Vixen Logic";
    manga.thumbnail_url = `${this.baseUrl}/wp-content/uploads/2026/06/VL_Cover_Toocheke.png`;
    manga.author = "tootaloo and foxboy83";
    manga.status = SManga.UNKNOWN;
    manga.url = "/";
    manga.initialized = true;
    return manga;
  }

  override get supportsLatest(): boolean {
    return false;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.ENGLISH);

  private parseDate(dateStr: string): number {
    switch (dateStr.toLowerCase()) {
      case "today":
        return startOfDayUtc();
      case "yesterday":
        return startOfDayUtc(1);
      default:
        return this.dateFormat.tryParseDate(dateStr, ZoneOffset.UTC);
    }
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.manga()], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([this.manga()], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) {
      return new SMangaUpdate(manga, chapters);
    }

    const archives = (await this.client.get(`${this.baseUrl}/archives/`)).asJsoup();
    const comicItems = archives.select(".comic-item");

    const chapterList = comicItems.map((ci) => {
      const title = ci.select(".comic-title").text();
      const dateText = ci.select(".comic-post-date").text();
      const url = ci.parent()!.absUrl("href");
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(url);
      chapter.name = title;
      chapter.date_upload = this.parseDate(dateText);
      return chapter;
    });

    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(`${this.baseUrl}/${chapter.url}`, this.headers)).asJsoup();
    return document.select("#comic p a img").map((img, index) => {
      const imgUrl = img.absUrl("src") || img.attr("src");
      return new Page(index, "", imgUrl);
    });
  }
}
