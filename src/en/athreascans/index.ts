// Port of keiyoushi/extensions-source src/en/athreascans/AthreaScans.kt
import { ClientBuilder, type Document, type PreferenceScreen, type SChapter } from "../../../sdk/index.ts";
import { MangaThemesia, MangaThemesiaPaidChapterHelper } from "../../../themes/mangathemesia/index.ts";

export default class AthreaScans extends MangaThemesia {
  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(2);
  }

  private readonly paidChapterHelper = new MangaThemesiaPaidChapterHelper();

  protected override chapterListSelector(): string {
    return this.paidChapterHelper.getChapterListSelectorBasedOnHidePaidChaptersPref(super.chapterListSelector(), this.preferences);
  }

  override chapterListParse(document: Document): SChapter[] {
    // Additional filter: skip chapters without valid URLs (locked chapters have no href)
    return super.chapterListParse(document).filter((chapter) => !(chapter.url.trim() === "" || chapter.url === "#"));
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    this.paidChapterHelper.addHidePaidChaptersPreferenceToScreen(screen, this.intl);
  }
}
