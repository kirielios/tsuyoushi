// Port of keiyoushi/extensions-source src/en/thepropertyofhate/ThePropertyOfHate.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringBefore, substringBeforeLast, urlWithoutDomain } from "../../../sdk/index.ts";

export default class ThePropertyOfHate extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // the one and only manga entry
  private get manga(): SManga {
    const manga = SManga.create();
    manga.title = "The Property of Hate";
    manga.thumbnail_url = "https://jolleycomics.com/images/Index/tpoh.png";
    manga.artist = "Sarah Jolley";
    manga.author = "Sarah Jolley";
    manga.status = SManga.UNKNOWN;
    manga.url = this.baseUrl;
    return manga;
  }

  // ========================= Popular =========================

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.manga], false);
  }

  // ========================= Latest =========================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Search =========================

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Details =========================

  override getMangaUrl(_manga: SManga): string {
    return this.baseUrl;
  }

  async fetchMangaUpdate(_manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const manga = this.manga;
    manga.initialized = true;

    return new SMangaUpdate(manga, fetchChapters ? await this.getChapterList() : chapters);
  }

  private async getChapterList(): Promise<SChapter[]> {
    const document = (await this.client.get(`${this.baseUrl}/TPoH/`)).asJsoup();

    const chapters: SChapter[] = [];
    let addedActiveChapter = false;
    let chapterNum = 1;

    const options = document.select("select.jumpbox option:not([value=-1])");
    for (const opt of options) {
      const isBold = opt.hasAttr("style") && opt.attr("style").includes("bold");
      if (isBold) {
        const currentChapterNum = chapterNum++;
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(opt.absUrl("value"));
        chapter.name = `#${currentChapterNum} - ${opt.text().trim()}`;
        chapter.chapter_number = currentChapterNum;
        chapters.push(chapter);
      } else if (!addedActiveChapter) {
        const pageText = opt.text();
        const chapterName = substringBefore(pageText, " : Page").trim();
        const pageUrl = opt.attr("value");
        const chapterUrl = `${substringBeforeLast(pageUrl, "/")}/`;

        const currentChapterNum = chapterNum++;
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(chapterUrl);
        chapter.name = `#${currentChapterNum} - ${chapterName}`;
        chapter.chapter_number = currentChapterNum;
        chapters.push(chapter);
        addedActiveChapter = true;
      }
    }

    return chapters.reverse();
  }

  // ========================= Pages =========================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.baseUrl + chapter.url))
      .asJsoup()
      .select("select.jumpbox option:not([style*=bold]):not([value=-1])")
      .map((opt, num) => new Page(num, opt.absUrl("value")));
  }

  override async getImageUrl(page: Page): Promise<string> {
    return (await this.client.get(page.url)).asJsoup().selectFirst(".comic_comic > img")!.absUrl("src");
  }
}
