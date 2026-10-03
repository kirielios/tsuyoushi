// Port of keiyoushi/extensions-source src/en/mangadistrict/MangaDistrict.kt
import { CheckBoxPreference, EditTextPreference, ListPreference, type Document, type Element, type PreferenceScreen, type SChapter, type SManga } from "../../../sdk/index.ts";
import { MadaraNoAjax } from "../../../themes/madara/index.ts";

// `]` escaped and the `u` flag added (for 𖤍); otherwise as upstream
const BRACKETS = String.raw`\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|𖤍.+?𖤍|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩`;
const titleRegex = new RegExp(String.raw`^(?:\s*(?:${BRACKETS})\s*)+|(?:\s*(?:${BRACKETS}|/\s*Official)\s*)+$`, "giu");

const REMOVE_TITLE_VERSION_PREF = "REMOVE_TITLE_VERSION";
const REMOVE_TITLE_CUSTOM_PREF = "REMOVE_TITLE_CUSTOM";
const NO_REMOVE_TITLE_BROWSING_PREF = "NO_REMOVE_TITLE_BROWSING";

const IMG_RES_PREF = "IMG_RES";
const IMG_RES_ALL = "all";
const IMG_RES_HIGH = "high";
const IMG_RES_FULL = "full";
const IMG_RES_DEFAULT = IMG_RES_ALL;

export default class MangaDistrict extends MadaraNoAjax {
  protected override mangaSubString = "series";
  protected override genreDirectory = "publication-genre";
  protected override nextPageSelector() {
    return ".wp-pagenavi a.last";
  }

  protected override archiveManga(element: Element, id: string): SManga | null {
    const it = super.archiveManga(element, id);
    if (it == null) return null;
    return this.noCleanTitlesWhileBrowsing() ? it : this.cleanTitleIfNeeded(it);
  }

  protected override parseDetails(document: Document, id: string, preserveUrl: string | null): SManga {
    return this.cleanTitleIfNeeded(super.parseDetails(document, id, preserveUrl));
  }

  protected override parseChapterList(document: Document, mangaPath: string): SChapter[] {
    const chapters = super.parseChapterList(document, mangaPath);
    switch (this.getImgRes()) {
      case IMG_RES_HIGH:
        return chapters.filter((it) => !it.url.includes("/v2-full-quality"));
      case IMG_RES_FULL:
        return chapters.filter((it) => !it.url.includes("/v1-high-quality"));
      default:
        return chapters;
    }
  }

  protected override chapterDateSelector = ".chapter-release-date .timediff";

  protected override pageListParseSelector = "div.page-break img:not(noscript img):not(#image-99999)";

  private cleanTitleIfNeeded(manga: SManga): SManga {
    let tempTitle = manga.title;
    const customRegex = this.customRemoveTitle();
    if (customRegex) {
      try {
        tempTitle = tempTitle.replace(new RegExp(customRegex, "g"), "");
      } catch {
        // runCatching
      }
    }
    if (this.isRemoveTitleVersion()) {
      tempTitle = tempTitle.replace(titleRegex, "");
    }
    manga.title = tempTitle.trim();
    return manga;
  }

  private isRemoveTitleVersion() {
    return this.preferences.getBoolean(REMOVE_TITLE_VERSION_PREF, false);
  }
  private customRemoveTitle(): string {
    return this.preferences.getString(`${REMOVE_TITLE_CUSTOM_PREF}_${this.lang}`, "")!;
  }
  private noCleanTitlesWhileBrowsing(): boolean {
    return this.preferences.getBoolean(NO_REMOVE_TITLE_BROWSING_PREF, false);
  }
  private getImgRes() {
    return this.preferences.getString(IMG_RES_PREF, IMG_RES_DEFAULT)!;
  }

  // Android-only behaviour dropped: setVisible on the browsing checkbox, the regex-validating TextWatcher and Toast.
  // An invalid custom regex is still ignored at use, as upstream's runCatching does.
  override setupPreferenceScreen(screen: PreferenceScreen) {
    const noRemoveTitleBrowsingPref = new CheckBoxPreference(screen.context);
    noRemoveTitleBrowsingPref.key = NO_REMOVE_TITLE_BROWSING_PREF;
    noRemoveTitleBrowsingPref.title = "Don't apply title cleaning in browsing/search results";
    noRemoveTitleBrowsingPref.summary = "Don't apply the 2 options above when browsing or searching for manga, but still apply them in manga details.";
    noRemoveTitleBrowsingPref.setDefaultValue(false);

    const removeTitleVersionPref = new CheckBoxPreference(screen.context);
    removeTitleVersionPref.key = REMOVE_TITLE_VERSION_PREF;
    removeTitleVersionPref.title = "Remove version information from entry titles";
    removeTitleVersionPref.summary =
      "This removes version tags like “(Official)” or “(Doujinshi)” from entry titles " +
      "and helps identify duplicate entries in your library. " +
      "To update existing entries, remove them from your library (unfavorite) and refresh manually. " +
      "You might also want to clear the database in advanced settings.";
    removeTitleVersionPref.setDefaultValue(false);
    screen.addPreference(removeTitleVersionPref);

    const customPref = new EditTextPreference(screen.context);
    customPref.key = `${REMOVE_TITLE_CUSTOM_PREF}_${this.lang}`;
    customPref.title = "Custom regex to be removed from title";
    customPref.summary = this.customRemoveTitle();
    customPref.setDefaultValue("");
    screen.addPreference(customPref);

    screen.addPreference(noRemoveTitleBrowsingPref);

    const imgResPref = new ListPreference(screen.context);
    imgResPref.key = IMG_RES_PREF;
    imgResPref.title = "Image quality";
    imgResPref.entries = ["All", "High quality", "Full quality"];
    imgResPref.entryValues = [IMG_RES_ALL, IMG_RES_HIGH, IMG_RES_FULL];
    imgResPref.summary = "%s\nRefresh entry to update the chapter list.";
    imgResPref.setDefaultValue(IMG_RES_DEFAULT);
    screen.addPreference(imgResPref);
  }

  protected override imageFromElement(element: Element): string | null {
    if (element.hasAttr("data-wpfc-original-src")) return element.attr("abs:data-wpfc-original-src");
    return super.imageFromElement(element);
  }
}
