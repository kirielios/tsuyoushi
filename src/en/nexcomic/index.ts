// Port of keiyoushi/extensions-source src/en/nexcomic/NexComic.kt
import type { PreferenceScreen } from "../../../sdk/index.ts";
import { MangaThemesia, MangaThemesiaPaidChapterHelper } from "../../../themes/mangathemesia/index.ts";

export default class NexComic extends MangaThemesia {
  private readonly paidChapterHelper = new MangaThemesiaPaidChapterHelper(undefined, ".text-gold");

  protected override chapterListSelector(): string {
    // Default selector is too broad; it picks up comment <li> as chapters
    const base = "#chapterlist li[data-num]";

    return this.paidChapterHelper.getChapterListSelectorBasedOnHidePaidChaptersPref(base, this.preferences);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    this.paidChapterHelper.addHidePaidChaptersPreferenceToScreen(screen, this.intl);
  }
}
