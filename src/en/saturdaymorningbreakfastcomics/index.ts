// Port of keiyoushi/extensions-source src/en/saturdaymorningbreakfastcomics/SaturdayMorningBreakfastComics.kt
import { Base64, ClientBuilder, DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, Response, SChapter, SManga, SMangaUpdate } from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";
import { THUMBNAIL_PNG_BASE64 } from "./thumbnail.ts";

const dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

/** Split from Hiveworks extension */
export default class SaturdayMorningBreakfastComics extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(TextInterceptor()).addChainInterceptor(async (chain) => {
      const request = chain.request();
      if (new URL(request.url).hostname !== "thumbnail") return chain.proceed(request);
      return Response.of(request.url, Base64.decode(THUMBNAIL_PNG_BASE64), "image/png");
    });
  }

  private makeSManga(): SManga {
    const manga = SManga.create();
    manga.title = "Saturday Morning Breakfast Comics";
    manga.artist = "Zach Weinersmith";
    manga.author = "Zach Weinersmith";
    manga.status = SManga.ONGOING;
    manga.url = "/comic/archive";
    manga.description = "SMBC is a daily comic strip about life, philosophy, science, mathematics, and dirty jokes.";
    manga.thumbnail_url = "https://thumbnail/smbc.png";
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.makeSManga()], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(this.makeSManga(), chapters);

    // the archive page responds with HTTP 500 despite serving the full list
    const response = await this.client.get(this.getMangaUrl(manga), undefined, { ensureSuccess: false });
    if (!response.isSuccessful && response.code !== 500) {
      throw new Error(`HTTP ${response.code}`);
    }

    const chapterList = response
      .asJsoup()
      .select('option[value*="comic/"]')
      .map((element, index) => {
        const chapter = SChapter.create();
        chapter.url = `/${element.attr("value")}`;
        const parts = element.text().split(" - ");
        if (parts.length < 2) throw new Error("Destructuring declaration initializer of type List<String> must have a 'component2()' function");
        const [date, title] = parts;
        chapter.name = title;
        chapter.date_upload = dateFormat.tryParseDate(date);
        chapter.chapter_number = index + 1;
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(this.makeSManga(), chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pages: Page[] = [];
    const image = document.select("img#cc-comic");
    pages.push(new Page(0, "", image.attr("abs:src")));
    if (image.first()?.hasAttr("title")) {
      pages.push(new Page(1, "", TextInterceptorHelper.createUrl("", image.attr("title"))));
    }
    pages.push(new Page(2, "", document.select("#aftercomic > img").attr("abs:src")));
    return pages;
  }
}
