// Port of keiyoushi/extensions-source src/en/elftoon/ElfToon.kt
import type { PreferenceScreen } from "../../../sdk/index.ts";
import { MangaThemesia, MangaThemesiaPaidChapterHelper } from "../../../themes/mangathemesia/index.ts";

export default class ElfToon extends MangaThemesia {
  private readonly paidChapterHelper = new MangaThemesiaPaidChapterHelper(undefined, ".gem-price-icon");

  protected override chapterListSelector(): string {
    return this.paidChapterHelper.getChapterListSelectorBasedOnHidePaidChaptersPref(super.chapterListSelector(), this.preferences);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    this.paidChapterHelper.addHidePaidChaptersPreferenceToScreen(screen, this.intl);
  }
}
