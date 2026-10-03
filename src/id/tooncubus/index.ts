// Port of keiyoushi/extensions-source src/id/tooncubus/Tooncubus.kt
import { SChapter, type Document } from "../../../sdk/index.ts";
import { ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class Tooncubus extends ZeistManga {
  protected override pageListSelector = "div.check-box center";
  protected override supportsChapterFeed = false;

  override async getChapterList(_feedUrl: string, doc: Document | null = null): Promise<SChapter[]> {
    return doc!
      .selectFirst("ul.series-chapterlist")!
      .select("div.flexch-infoz")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.name = element.select("span").text();
        chapter.url = element.select("a").attr("href"); // The website uses another domain for reading
        return chapter;
      });
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }
}
