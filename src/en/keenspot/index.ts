// Port of keiyoushi/extensions-source src/en/keenspot/TwoKinds.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, type Document } from "../../../sdk/index.ts";

interface TwoKindsPage {
  url: string;
  name: string;
}

export default class TwoKinds extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // the one and only manga entry
  mangaSinglePages(): SManga {
    const manga = SManga.create();
    manga.title = "TwoKinds (1 page per chapter)";
    manga.thumbnail_url = `https://dummyimage.com/768x994/000/ffffff.jpg&text=${manga.title}`;
    manga.artist = "Tom Fischbach";
    manga.author = "Tom Fischbach";
    manga.status = SManga.UNKNOWN;
    manga.url = "1";
    return manga;
  }

  manga20Pages(): SManga {
    const manga = SManga.create();
    manga.title = "TwoKinds (20 pages per chapter)";
    manga.thumbnail_url = `https://dummyimage.com/768x994/000/ffffff.jpg&text=${manga.title}`;
    manga.artist = "Tom Fischbach";
    manga.author = "Tom Fischbach";
    manga.status = SManga.UNKNOWN;
    manga.url = "20";
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.mangaSinglePages(), this.manga20Pages()], false);
  }

  // latest Updates not used
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    // the manga is one and only, but still write the data again to avoid bugs in backup restore
    const details = manga.url === "1" ? this.mangaSinglePages() : this.manga20Pages();

    if (!fetchChapters) return new SMangaUpdate(details, chapters);

    return new SMangaUpdate(details, this.chapterListParse(await this.fetchArchive(), manga));
  }

  // chapter list

  private async fetchArchive(): Promise<Document> {
    return (await this.client.get(`${this.baseUrl}/archive/`)).asJsoup();
  }

  private parseArchivePages(document: Document): TwoKindsPage[] {
    return document
      .select(".chapter-links")
      .flatMap((season) => [...season.select("> a")])
      .map((a) => {
        // /comic/1185halloween/ -> 1185halloween
        const urlPart = a.attr("href").split("/")[2];
        const name = a.selectFirst("span")!.text();

        return { url: urlPart, name };
      });
  }

  private chapterListParse(document: Document, manga: SManga): SChapter[] {
    const pages = this.parseArchivePages(document);

    // 1 page per chapter
    if (manga.url === "1") {
      return pages
        .map((page) => {
          const chapter = SChapter.create();
          chapter.url = `1-${page.url}`;
          chapter.name = `Page ${page.name}`;
          return chapter;
        })
        .reverse();
    }

    // 20 pages per chapter
    const chapters: SChapter[] = [];
    for (let i = 0; i < pages.length; i += 20) {
      const chapter = SChapter.create();
      chapter.url = `20-${pages[i].url}`;
      chapter.name = `Pages ${pages[i].name}-${pages[Math.min(pages.length, i + 20) - 1].name}`;
      chapters.push(chapter);
    }
    return chapters.reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.url.startsWith("1")) {
      return [new Page(0, `${this.baseUrl}/comic/${substringAfter(chapter.url, "-")}/`)];
    }
    const firstPage = substringAfter(chapter.url, "-");
    const pages = this.parseArchivePages(await this.fetchArchive());

    const firstPageIdx = pages.findIndex((it) => it.url === firstPage);
    const lastPageIdx = Math.min(pages.length, firstPageIdx + 20);

    return pages.slice(firstPageIdx, lastPageIdx).map((page, idx) => new Page(idx, `${this.baseUrl}/comic/${page.url}/`));
  }

  override async getImageUrl(page: Page): Promise<string> {
    const document = (await this.client.get(page.url)).asJsoup();

    return document.select("#content article img").first()!.attr("src");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("Search functionality is not available.");
  }
}
