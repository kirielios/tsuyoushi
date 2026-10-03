// Port of keiyoushi/extensions-source lib-multisrc/mangathemesia/MangaThemesiaPaidChapterHelper.kt
import { SwitchPreferenceCompat, type Intl, type PreferenceScreen, type SharedPreferences } from "../../sdk/index.ts";

export class MangaThemesiaPaidChapterHelper {
  constructor(
    private readonly hidePaidChaptersPrefKey = "pref_hide_paid_chapters",
    private readonly lockedChapterSelector = "a[data-bs-target='#lockedChapterModal']",
  ) {}

  addHidePaidChaptersPreferenceToScreen(screen: PreferenceScreen, intl: Intl) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = this.hidePaidChaptersPrefKey;
    pref.title = intl.get("pref_hide_paid_chapters_title");
    pref.summary = intl.get("pref_hide_paid_chapters_summary");
    pref.setDefaultValue(true);
    screen.addPreference(pref);
  }

  getHidePaidChaptersPref(preferences: SharedPreferences) {
    return preferences.getBoolean(this.hidePaidChaptersPrefKey, true);
  }

  getChapterListSelectorBasedOnHidePaidChaptersPref(baseChapterListSelector: string, preferences: SharedPreferences): string {
    if (!this.getHidePaidChaptersPref(preferences)) return baseChapterListSelector;
    // Fragile
    return baseChapterListSelector
      .split(", ")
      .map((it) => `${it}:not(${this.lockedChapterSelector}):not(:has(${this.lockedChapterSelector}))`)
      .join(", ");
  }
}
