// Port of keiyoushi/extensions-source src/en/loadingartist/LoadingArtist.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

interface Comic {
  url: string;
  title: string;
  date?: string;
  section: string;
}

export default class LoadingArtist extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ENGLISH);

  // Popular Section (list of comic archives by year)

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.title = "Loading Artist";
    manga.url = urlWithoutDomain("/archives");
    manga.thumbnail_url = `${this.baseUrl}/img/bg/logo-text_dark.png`;
    manga.artist = "Loading Artist";
    manga.author = manga.artist;
    manga.status = SManga.ONGOING;
    return new MangasPage([manga], false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search

  getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("Search not available for this source");
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const comics = (await this.client.get(`${this.baseUrl}/search.json`)).parseAs<Comic[]>();
    const validTypes = ["comic", "game", "art"];
    const chapterList = comics
      .filter((it) => validTypes.some((type) => it.section === type))
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(it.url);
        chapter.name = it.title;
        chapter.date_upload = this.dateFormat.tryParseDate(it.date ?? "");
        return chapter;
      });
    return new SMangaUpdate(manga, chapterList);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = this.getChapterUrl(chapter);
    const imageUrl = (await this.client.get(url)).asJsoup().selectFirst("div.main-image-container img")!.attr("abs:src");
    return [new Page(0, url, imageUrl)];
  }
}
