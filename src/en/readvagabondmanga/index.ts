// Port of keiyoushi/extensions-source src/en/readvagabondmanga/ReadVagabondManga.kt (+ Dto.kt)
// Not upstream: the site dropped its /api/mihon JSON API (404 since 2026-10) for a static Astro site, so this reads
// the home page (details), sitemap.xml (chapters) and the chapter pages (images) instead.
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

const CHAPTER_LOC = /<loc>https?:\/\/[^/]+(\/volume-(\d+)\/chapter-(\d+))\/?<\/loc>/g;

export default class ReadVagabondManga extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private async details(): Promise<SManga> {
    const document = (await this.client.get(`${this.baseUrl}/`)).asJsoup();
    const manga = SManga.create();
    manga.title = "Vagabond";
    // keeps the url of entries saved from the old API ("/#<id>"), which had a single manga
    manga.url = "/#1";
    manga.thumbnail_url = document.selectFirst("a[href^=/volume-] img")?.absUrl("src") ?? document.selectFirst("meta[property=og:image]")?.attr("content");
    manga.author = "Takehiko Inoue";
    manga.artist = "Takehiko Inoue";
    manga.description = document.selectFirst("meta[name=description]")?.attr("content");
    manga.status = SManga.ON_HIATUS;
    manga.initialized = true;
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([await this.details()], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const manga = await this.details();
    return new MangasPage(manga.title.toLowerCase().includes(query.trim().toLowerCase()) ? [manga] : [], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.details() : manga, fetchChapters ? this.chapterList() : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async chapterList(): Promise<SChapter[]> {
    const xml = (await this.client.get(`${this.baseUrl}/sitemap.xml`)).text();
    return [...xml.matchAll(CHAPTER_LOC)]
      .map(([, path, volume, number]) => {
        const chapter = SChapter.create();
        chapter.url = `${path}/#1`;
        chapter.name = `Vol. ${volume} Ch. ${number}`;
        chapter.chapter_number = Number(number);
        chapter.scanlator = "Read Vagabond Manga";
        return chapter;
      })
      .sort((a, b) => b.chapter_number - a.chapter_number);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("img[data-page]").map((img, i) => new Page(i, "", img.absUrl("src")));
  }

  override getMangaUrl(_manga: SManga): string {
    return this.baseUrl;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url.replace(/#.*$/, "")}`;
  }
}
