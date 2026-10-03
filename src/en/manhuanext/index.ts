// Port of keiyoushi/extensions-source src/en/manhuanext/Manhuanext.kt
import { SwitchPreferenceCompat, type PreferenceScreen } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

const HIDE_PREMIUM = "hide_premium_chapters";
const HIDE_PREMIUM_TITLE = "Hide premium chapters";
const HIDE_PREMIUM_SUM = "Restart the app to apply changes";

export default class Manhuanext extends Madara {
  protected override chapterMode = ChapterMode.MangaAjax;
  private readonly hideChapters = this.preferences.getBoolean(HIDE_PREMIUM, true) ? "li.wp-manga-chapter:not(.premium-block)" : "li.wp-manga-chapter";
  protected override chapterListSelector() {
    return this.hideChapters;
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_PREMIUM;
    p.title = HIDE_PREMIUM_TITLE;
    p.summary = HIDE_PREMIUM_SUM;
    p.setDefaultValue(true);
    screen.addPreference(p);
  }
}
