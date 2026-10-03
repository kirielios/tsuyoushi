// Port of keiyoushi/extensions-source src/en/explosm/Explosm.kt (+ Dto.kt)
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, type FilterList } from "../../../sdk/index.ts";

interface ComicDto {
  slug: string;
  file?: string | null;
  file_static?: string | null;
  publish_at: string;
  author_name?: string | null;
}

interface ComicsResponse {
  pageProps: { comicArchiveData: Record<string, Record<string, ComicDto[]>> };
}

export default class Explosm extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private get archivePage() {
    return `${this.baseUrl}/comics`;
  }

  private async getArchiveAllYears(): Promise<Record<string, Record<string, ComicDto[]>>> {
    const src = (await this.client.get(this.archivePage)).asJsoup().select("head > script").last()?.attr("src");
    if (src == null) throw new Error("Error at last() in getArchiveAllYears");
    const replaced = src.replaceAll("static", "data");
    const i = replaced.lastIndexOf("/");
    const jsonPath = i === -1 ? replaced : `${replaced.substring(0, i + 1)}comics.json`;
    return (await this.client.get(this.baseUrl + jsonPath)).parseAs<ComicsResponse>().pageProps.comicArchiveData;
  }

  // Popular

  async getPopularManga(_page: number): Promise<MangasPage> {
    const eachYearAsAManga = Object.keys(await this.getArchiveAllYears())
      .map((year) => {
        const manga = SManga.create();
        manga.initialized = true;
        manga.title = `C&H ${year}`;
        manga.url = year;
        manga.thumbnail_url = "https://vhx.imgix.net/vitalyuncensored/assets/13ea3806-5ebf-4987-bcf1-82af2b689f77/S2E4_Still1.jpg";
        manga.author = "Explosm.net";
        return manga;
      })
      .reverse();

    return new MangasPage(eachYearAsAManga, false);
  }

  // Latest

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  // Details

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comics#${manga.url}-01`;
  }

  // Chapters

  private readonly date = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.US);

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    let chapterCount = 0;
    const year = (await this.getArchiveAllYears())[manga.url];
    if (year == null) throw new Error("Error with main jsonObject");
    const chapterList = Object.values(year)
      .flatMap((month) =>
        month.map((comic) => {
          chapterCount++;
          const chapter = SChapter.create();
          chapter.name = comic.slug;
          // we get the url for page.imageurl here
          let imageUrl: string;
          if (comic.file_static != null) imageUrl = comic.file_static;
          else if (comic.file?.startsWith("http") === true) imageUrl = comic.file;
          else imageUrl = `https://files.explosm.net/comics/${comic.file}`;
          chapter.url = `/comics/${comic.slug}#${imageUrl}`;
          chapter.date_upload = this.date.tryParseDateTime(comic.publish_at);
          chapter.scanlator = comic.author_name ?? undefined;
          chapter.chapter_number = chapterCount; // so no "missing chapters" warning in app
          return chapter;
        }),
      )
      .reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return [new Page(0, "", substringAfter(chapter.url, "#"))];
  }
}
