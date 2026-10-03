// Port of keiyoushi/extensions-source src/en/battleinfivesecondsaftermeeting/BattleInFiveSecondsAfterMeeting.kt
import { SChapter, substringAfterLast, toHttpUrl, trimEnd, type Document } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class BattleInFiveSecondsAfterMeeting extends Madara {
  override get supportsLatest() {
    return false;
  }

  protected override mangaDetailsSelectorTitle = "h1";
  protected override mangaDetailsSelectorAuthor = "h5:contains(Author) + h4 a";
  protected override mangaDetailsSelectorArtist = "h5:contains(Artist) + h4 a";
  protected override mangaDetailsSelectorDescription = ".synopsis p";
  protected override mangaDetailsSelectorThumbnail = ".cover_managa img";
  protected override mangaDetailsSelectorStatus = "h5:contains(Status) + h4";
  protected override mangaDetailsSelectorTag = "h5:contains(Tag) + h4 a";
  protected override seriesTypeSelector = "h5:contains(Type) + h4";
  protected override altNameSelector = "h5:contains(Alternative) + h4";

  protected override parseChapterList(document: Document, mangaPath: string): SChapter[] {
    const dates = new Map(document.select(".chapter-item").map((element) => [element.selectFirst("a")!.attr("abs:href"), this.parseChapterDate(element.selectFirst(".post-on")?.text() ?? null)]));
    return document.select(".main-chapter").flatMap((element) => {
      const href = element.selectFirst("a")?.attr("abs:href");
      if (href == null) return [];
      const slug = substringAfterLast(trimEnd(toHttpUrl(href).encodedPath, "/"), "/");
      if (!slug) return [];
      const chapter = SChapter.create();
      chapter.url = slug;
      chapter.name = element.selectFirst(".chapter-content")!.text().replace(/^Battle in 5 Seconds After Meeting, /, "");
      chapter.date_upload = dates.get(href) ?? 0;
      chapter.memo = { mangaPath };
      return [chapter];
    });
  }
}
