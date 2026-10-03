// Port of keiyoushi/extensions-source lib-multisrc/mangacatalog/MangaCatalog.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, substringAfter, type Document, type Element, type FilterList } from "../../sdk/index.ts";

// Based On the original manga maniac source
// MangaCatalog is a network of sites for single franshise sites

export abstract class MangaCatalog extends KeiSource {
  sourceList: [string, string][] = distinctBy(
    [[this.name, this.baseUrl] as [string, string]].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    (it) => it[1],
  );

  // Info

  override get supportsLatest() {
    return false;
  }

  // Popular
  override async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage(
      this.sourceList.map((it) => this.popularMangaFromPair(it[0], it[1])),
      false,
    );
  }

  private popularMangaFromPair(name: string, sourceurl: string): SManga {
    const manga = SManga.create();
    manga.title = name;
    manga.url = sourceurl;
    return manga;
  }

  // Latest
  override getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("Unsupported operation");
  }

  // Search

  override async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas = this.sourceList.filter((it) => it[0].toLowerCase().includes(query.toLowerCase())).map((it) => this.popularMangaFromPair(it[0], it[1]));
    return new MangasPage(mangas, false);
  }

  // Manga and chapter URLs are stored as absolute URLs
  override getMangaUrl(manga: SManga): string {
    return manga.url;
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  // Details and chapters come from the same page
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document), this.chapterListParse(document));
  }

  // Details

  mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const info = document.select("div.bg-bg-secondary > div.px-6 > div.flex-col").text();
    manga.title = document.select("div.container > h1").text();
    manga.description = info.includes("Description") ? substringAfter(info, "Description").trim() : info;
    manga.thumbnail_url = document.select("div.flex > img").attr("abs:src");
    return manga;
  }

  // Chapters

  chapterListSelector(): string {
    return "div.w-full > div.bg-bg-secondary > div.grid";
  }

  chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const name1 = element.select(".col-span-4 > a").text();
    const name2 = element.select(".text-xs:not(a)").text();
    chapter.name = !name2 ? name1 : `${name1} - ${name2}`;
    chapter.url = element.select(".col-span-4 > a").attr("abs:href");
    return chapter;
  }

  private chapterListParse(document: Document): SChapter[] {
    return document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));
  }

  // Pages

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  pageListParse(document: Document): Page[] {
    return document.select("img[data-src]").map((img, index) => new Page(index, "", img.attr("abs:data-src")));
  }
}
