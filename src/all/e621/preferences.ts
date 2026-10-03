// Port of keiyoushi/extensions-source src/all/e621/Preferences.kt
import { EditTextPreference, ListPreference, SwitchPreferenceCompat, type PreferenceScreen, type SharedPreferences } from "../../../sdk/index.ts";

const BETTER_DETAILS_PREF = "better_details";
const TAG_MODE_ENABLE_PREF = "tag_mode_enable";
const SPLIT_CHAPTERS_PREF = "split_chapters2";
const POPULAR_MODE_PREF = "popular_mode";
const CATEGORY_PREF = "category_filter";
const BLACKLIST_PREF = "blacklist";
const WHITELIST_PREF = "whitelist";
const SCORE_THRESH_PREF = "score_thresh";
const FIRST_END_PREF = "first_end";
const FULL_RESOLUTION_PREF = "first_end"; // sic: upstream shares the key with FIRST_END_PREF
const USERNAME_PREF = "username";
const API_KEY_PREF = "api_key";
const ACCOUNT_BLACKLIST_PREF = "account_blacklist";

const COMMON_BLACKLIST = "( gore necrophilia ) ( gore sex ) mutilation snuff torture gore_focus character_prepared_as_food castration feces urine diaper fart burp_cloud";

const RXPARENTH = "\\([^)]*\\)";
const RXNOWHITE = "\\S+";

export function setupE621PreferenceScreen(screen: PreferenceScreen): void {
  const fullRes = new SwitchPreferenceCompat(screen.context);
  fullRes.key = FULL_RESOLUTION_PREF;
  fullRes.title = "Enable Full Image Resolutions";
  fullRes.summary =
    "Loads images at their full resolution. Full images often have absurd resolutions. Disabling this will speed up image loading at the tradeoff of image quality (usually not noticeable).";
  fullRes.setDefaultValue(false);
  screen.addPreference(fullRes);

  const betterDetails = new SwitchPreferenceCompat(screen.context);
  betterDetails.key = BETTER_DETAILS_PREF;
  betterDetails.title = "Enable Better Manga Details";
  betterDetails.summary =
    "Improves Manga Details by adding authors, tags, and chapter detection. Disabling this will load manga details and chapter lists faster, and reduce API calls.";
  betterDetails.setDefaultValue(false);
  screen.addPreference(betterDetails);

  const split = new ListPreference(screen.context);
  split.key = SPLIT_CHAPTERS_PREF;
  split.title = "Split chapters by";
  split.entries = ["Individual posts", "Individual chapters (slower)", "Merged chapters"];
  split.entryValues = ["posts", "chapters", "merged"];
  split.setDefaultValue("chapters");
  split.summary = "%s";
  screen.addPreference(split);

  const username = new EditTextPreference(screen.context);
  username.key = USERNAME_PREF;
  username.title = "Username";
  username.summary = "Optional: e621 account username for authenticated requests";
  username.setDefaultValue("");
  screen.addPreference(username);

  // upstream masks the input (TYPE_TEXT_VARIATION_PASSWORD); the app's settings form has no such flag
  const apiKey = new EditTextPreference(screen.context);
  apiKey.key = API_KEY_PREF;
  apiKey.title = "API key";
  apiKey.summary = "Optional: e621 account API key";
  apiKey.setDefaultValue("");
  screen.addPreference(apiKey);

  const accountBlacklist = new SwitchPreferenceCompat(screen.context);
  accountBlacklist.key = ACCOUNT_BLACKLIST_PREF;
  accountBlacklist.title = "Apply account blacklist to posts";
  accountBlacklist.summary = "Enables blacklisting posts when loading";
  accountBlacklist.setDefaultValue(false);
  screen.addPreference(accountBlacklist);

  const tagMode = new SwitchPreferenceCompat(screen.context);
  tagMode.key = TAG_MODE_ENABLE_PREF;
  tagMode.title = "Enable Tag Mode for Popular and Latest";
  tagMode.summary =
    "Order Popular by score and improve results for Latest (can result in duplicate pools). When disabled, Popular is ordered by number of posts rather than popularity.";
  tagMode.setDefaultValue(true);
  screen.addPreference(tagMode);

  const popularMode = new ListPreference(screen.context);
  popularMode.key = POPULAR_MODE_PREF;
  popularMode.title = "Filter Popular by (Tag Mode)";
  popularMode.entries = ["Hot", "Week", "Month", "Year", "All Time"];
  popularMode.entryValues = ["order:hot", "order:score date:week", "order:score date:month", "order:score date:year", "order:score"];
  popularMode.setDefaultValue("order:score date:year");
  popularMode.summary = "%s";
  screen.addPreference(popularMode);

  const blacklist = new EditTextPreference(screen.context);
  blacklist.key = BLACKLIST_PREF;
  blacklist.title = "Blacklisted Tags";
  blacklist.summary = "Space separated blacklisted tags. WILL NOT FILTER OUT EVERYTHING! (Tag Search Mode only)";
  blacklist.setDefaultValue(COMMON_BLACKLIST);
  screen.addPreference(blacklist);

  const whitelist = new EditTextPreference(screen.context);
  whitelist.key = WHITELIST_PREF;
  whitelist.title = "Whitelisted Tags";
  whitelist.summary = "Space separated whitelisted tags. This will be applied everywhere! (Tag Search Mode only)";
  whitelist.setDefaultValue("score:>10");
  screen.addPreference(whitelist);

  const scoreThresh = new EditTextPreference(screen.context);
  scoreThresh.key = SCORE_THRESH_PREF;
  scoreThresh.title = "Score Threshold for Latest";
  scoreThresh.summary = "Filter out posts below this threshold in the Latest category (Tag Search Mode only)";
  scoreThresh.setDefaultValue("20");
  screen.addPreference(scoreThresh);

  const category = new ListPreference(screen.context);
  category.key = CATEGORY_PREF;
  category.title = "Pool category filter for Popular and Latest (No Tag Mode)";
  category.entries = ["Series only", "Collections only", "Both"];
  category.entryValues = ["series", "collection", ""];
  category.setDefaultValue("series");
  category.summary = "%s";
  screen.addPreference(category);
}

export const betterDetailsPref = (p: SharedPreferences): boolean => p.getBoolean(BETTER_DETAILS_PREF, false);

export const fullResolution = (p: SharedPreferences): boolean => p.getBoolean(FULL_RESOLUTION_PREF, false);

export const searchModePref = (p: SharedPreferences): string => (p.getBoolean(TAG_MODE_ENABLE_PREF, true) ? "tags" : "pools");

export const firstEndPref = (p: SharedPreferences): string => (p.getBoolean(FIRST_END_PREF, false) ? "( ~first_page ~end_page )" : "");

export const splitChaptersPref = (p: SharedPreferences): string => p.getString(SPLIT_CHAPTERS_PREF, "chapters") ?? "chapters";

export const categoryPref = (p: SharedPreferences): string => p.getString(CATEGORY_PREF, "series") ?? "series";

export const blacklistPref = (p: SharedPreferences): string =>
  [...(p.getString(BLACKLIST_PREF, COMMON_BLACKLIST)?.trim()?.replace(/\s+/g, " ") ?? COMMON_BLACKLIST).matchAll(new RegExp(`(?=${RXPARENTH})${RXPARENTH}|${RXNOWHITE}`, "g"))]
    .map((it) => `-${it[0]}`)
    .join(" ");

export const whitelistPref = (p: SharedPreferences): string => p.getString(WHITELIST_PREF, "score:>10")?.trim()?.replace(/\s+/g, " ") ?? "score:>10";

export const popularModePref = (p: SharedPreferences): string => p.getString(POPULAR_MODE_PREF, "order:score date:year") ?? "order:score date:year";

export const scoreThreshPref = (p: SharedPreferences): string => p.getString(SCORE_THRESH_PREF, "20")?.replace(/\s+/g, " ") ?? "20";

export const usernamePref = (p: SharedPreferences): string => p.getString(USERNAME_PREF, "") ?? "";

export const apiKeyPref = (p: SharedPreferences): string => p.getString(API_KEY_PREF, "") ?? "";

export const accountBlacklistPref = (p: SharedPreferences): boolean => p.getBoolean(ACCOUNT_BLACKLIST_PREF, false);
