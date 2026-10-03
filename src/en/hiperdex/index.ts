// Port of keiyoushi/extensions-source src/en/hiperdex/Hiperdex.kt
import { CheckBoxPreference, EditTextPreference, MangasPage, type ClientBuilder, type PreferenceScreen, type Response, type SManga } from "../../../sdk/index.ts";
import { Hiper } from "../../../themes/hiper/index.ts";

const REMOVE_TITLE_VERSION_PREF = "REMOVE_TITLE_VERSION";
const REMOVE_TITLE_CUSTOM_PREF = "REMOVE_TITLE_CUSTOM";
const NO_REMOVE_TITLE_BROWSING_PREF = "NO_REMOVE_TITLE_BROWSING";

const titleRegex =
  /^(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|𖤍.+?𖤍|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩)\s*)+|(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|𖤍.+?𖤍|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/\s*Official)\s*)+$/gi;

export default class Hiperdex extends Hiper {
  protected override configureHeaders(headers: Headers): Headers {
    headers.set("x-cfg-auth", "yceqt7qgu004");
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return this.addHiperAuthInterceptor(builder).rateLimit(3);
  }

  // Upstream toggles the browsing checkbox's visibility and validates the regex while typing; the app's settings form
  // has neither, so the checkbox is always shown and an invalid regex is ignored when titles are cleaned.
  override setupPreferenceScreen(screen: PreferenceScreen) {
    super.setupPreferenceScreen(screen);

    const noRemoveTitleBrowsingPref = new CheckBoxPreference(screen.context);
    noRemoveTitleBrowsingPref.key = NO_REMOVE_TITLE_BROWSING_PREF;
    noRemoveTitleBrowsingPref.title = "Don't apply title cleaning in browsing/search results";
    noRemoveTitleBrowsingPref.summary = "Don't apply the 2 options above when browsing or searching for manga, but still apply them in manga details.";
    noRemoveTitleBrowsingPref.setDefaultValue(false);

    const removeVersion = new CheckBoxPreference(screen.context);
    removeVersion.key = `${REMOVE_TITLE_VERSION_PREF}_${this.lang}`;
    removeVersion.title = "Remove version information from entry titles";
    removeVersion.summary =
      "This removes version tags like '(Official)' or '(Uncensored)' from entry titles " +
      "and helps identify duplicate entries in your library. " +
      "To update existing entries, remove them from your library (unfavorite) and refresh manually. " +
      "You might also want to clear the database in advanced settings.";
    removeVersion.setDefaultValue(false);
    screen.addPreference(removeVersion);

    const custom = new EditTextPreference(screen.context);
    custom.key = `${REMOVE_TITLE_CUSTOM_PREF}_${this.lang}`;
    custom.title = "Custom regex to be removed from title";
    custom.summary = this.customRemoveTitle();
    custom.setDefaultValue("");
    screen.addPreference(custom);

    screen.addPreference(noRemoveTitleBrowsingPref);
  }

  protected override parseSearchMangaList(response: Response): MangasPage {
    const mangaUpdate = super.parseSearchMangaList(response);
    return new MangasPage(
      mangaUpdate.mangas.map((it) => {
        if (!this.noCleanTitlesWhileBrowsing()) {
          it.title = this.cleanTitleIfNeeded(it.title);
        } else if (this.isRemoveTitleVersion() || this.customRemoveTitle()) {
          // Allow it to refresh the cleaning title when manga is opened
          it.initialized = false;
        }
        return it;
      }),
      mangaUpdate.hasNextPage,
    );
  }

  protected override parseMangaDetails(response: Response): SManga {
    const manga = super.parseMangaDetails(response);
    const cleanedTitle = this.cleanTitleIfNeeded(manga.title);
    if (cleanedTitle !== manga.title.trim()) {
      manga.description = [manga.title, manga.description].filter((it) => it != null).join("\n\n");
      manga.title = cleanedTitle;
    }
    return manga;
  }

  private cleanTitleIfNeeded(title: string): string {
    let tempTitle = title;
    const customRegex = this.customRemoveTitle();
    if (customRegex) {
      try {
        tempTitle = tempTitle.replace(new RegExp(customRegex, "g"), "");
      } catch {
        // runCatching
      }
    }
    if (this.isRemoveTitleVersion()) tempTitle = tempTitle.replace(titleRegex, "");
    return tempTitle.trim();
  }

  private isRemoveTitleVersion(): boolean {
    return this.preferences.getBoolean(`${REMOVE_TITLE_VERSION_PREF}_${this.lang}`, false);
  }
  private customRemoveTitle(): string {
    return this.preferences.getString(`${REMOVE_TITLE_CUSTOM_PREF}_${this.lang}`, "")!;
  }

  private noCleanTitlesWhileBrowsing(): boolean {
    return this.preferences.getBoolean(NO_REMOVE_TITLE_BROWSING_PREF, false);
  }

  protected override get genresList(): string[] {
    return [
    "4-Koma",
    "Action",
    "Adaptation",
    "Adult",
    "Adventure",
    "Age Gap",
    "Aliens",
    "Ancient Korea",
    "Anthology",
    "Campus",
    "Childhood Friends",
    "Comedy",
    "Cooking",
    "Crime",
    "Crossdressing",
    "Dance",
    "Delinquents",
    "Demons",
    "Doujinshi",
    "Drama",
    "Ecchi",
    "Escolar",
    "Fantasy",
    "Fellatio/Blowjob",
    "Fetish",
    "Full Color",
    "Furry",
    "Gender Bender",
    "Genderswap",
    "Ghosts",
    "Girls' Love",
    "Gore",
    "Guideverse",
    "Gyaru",
    "Hair Color Change",
    "Harem",
    "Hentai",
    "Heroes",
    "Historical",
    "Horror",
    "Human-Nonhuman Relationship",
    "Isekai",
    "Josei",
    "Korea",
    "Korean Ambience",
    "Korean BL",
    "Long Strip",
    "Long-Haired Male Character/s",
    "Long-Haired Male Lead",
    "Love Triangle/s",
    "Low Fantasy",
    "Maduro",
    "Mafia",
    "Magic",
    "Male Protagonist",
    "Manga",
    "Martial Arts",
    "Masculine Uke",
    "Mature",
    "Mecha",
    "Medical",
    "Military",
    "Monster Girls",
    "Monsters",
    "Monsters Invade Earth",
    "Murim",
    "Muscular Male Lead",
    "Muscular Uke",
    "Music",
    "Mystery",
    "Nameverse",
    "Ninja",
    "Office Workers",
    "Older Uke Younger Seme",
    "Oneshot",
    "Orphan Female Lead",
    "Police",
    "Post-Apocalyptic",
    "Psychological",
    "Red-Haired Male Lead",
    "Red-Haired Seme",
    "Regression",
    "Reincarnation",
    "Revenge",
    "Romance",
    "Samurai",
    "School Life",
    "Sci-fi",
    "Secret Relationship",
    "Seinen",
    "Sexual Violence",
    "Shota",
    "Shoujo",
    "Shoujo Ai",
    "Shounen",
    "Size Difference",
    "Slice of Life",
    "Smut",
    "Sobrenatural",
    "Sports",
    "Superhero",
    "Supernatural",
    "Survival",
    "Suspense",
    "Thriller",
    "Time Travel",
    "Tower",
    "Tragedy",
    "Uncensored",
    "Video Games",
    "Villainess",
    "Violence",
    "Virtual Reality",
    "Web Comic",
    "Webtoon",
    "Wuxia",
    "Yaoi",
    "Yuri",
    ];
  }
}
