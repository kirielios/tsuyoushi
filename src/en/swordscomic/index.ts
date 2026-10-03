// Port of keiyoushi/extensions-source src/en/swordscomic/SwordsComic.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type ClientBuilder, type FilterList } from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

export default class SwordsComic extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(TextInterceptor());
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.title = "Swords Comic";
    manga.url = "/archive/pages/";
    manga.author = "Matthew Wills";
    manga.artist = manga.author;
    manga.description = "A webcomic about swords and the heroes who wield them";
    manga.thumbnail_url = "https://swordscomic.com/media/ArgoksEdgeEmote.png";
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
    return new MangasPage([this.createManga()], false);
  }

  // Updates

  private readonly dateFormat = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.US);

  async fetchMangaUpdate(_manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const manga = this.createManga();
    manga.initialized = true;

    let chapterList = chapters;
    if (fetchChapters) {
      chapterList = (await this.client.get(this.getMangaUrl(manga)))
        .asJsoup()
        .select("a.archive-tile")
        .map((element) => {
          const chapter = SChapter.create();
          chapter.name = element.selectFirst("strong")!.text();
          chapter.url = urlWithoutDomain(element.absUrl("href"));
          chapter.date_upload = this.dateFormat.tryParseDate(element.selectFirst("small")?.text());
          return chapter;
        })
        .reverse();
    }

    return new SMangaUpdate(manga, chapterList);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const imageElement = (await this.client.get(this.getChapterUrl(chapter))).asJsoup().select("img#comic-image");
    if (!imageElement.first()?.hasAttr("title")) {
      return [new Page(0, "", imageElement.attr("abs:src"))];
    }
    const titleText = TextInterceptorHelper.createUrl("", imageElement.attr("title"));

    return [new Page(0, "", imageElement.attr("abs:src")), new Page(1, "", titleText)];
  }
}
