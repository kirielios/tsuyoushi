// Port of keiyoushi/extensions-source src/all/mangaball/ScanlatorBlacklist.kt
import { MultiSelectListPreference, type PreferenceScreen, type SChapter, type SharedPreferences } from "../../../sdk/index.ts";

// The selectable names are collected from the chapter lists the user opens, because the site
// exposes no public endpoint for the internal groups that upload its chapters.

export const scanlatorBlacklist = (p: SharedPreferences): Set<string> => new Set(p.getStringSet(SCANLATOR_BLACKLIST_PREF, []).map((it) => it.trim().toLowerCase()));

export const knownScanlatorNames = (p: SharedPreferences): string[] => p.getStringSet(KNOWN_SCANLATORS_PREF, []).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

export function rememberScanlators(p: SharedPreferences, names: string[]) {
  const known = p.getStringSet(KNOWN_SCANLATORS_PREF, []);
  const newNames = [...new Set(names.filter((it) => it.trim()))].filter((it) => !known.includes(it));
  if (!newNames.length) return;
  p.edit().putStringSet(KNOWN_SCANLATORS_PREF, [...known, ...newNames]).apply();
}

export const filterBlacklistedScanlators = (chapters: SChapter[], blacklist: Set<string>): SChapter[] => chapters.filter((it) => !(it.scanlator != null && blacklist.has(it.scanlator.trim().toLowerCase())));

export function addScanlatorBlacklistPreference(screen: PreferenceScreen, preferences: SharedPreferences) {
  const scanlators = knownScanlatorNames(preferences);
  const pref = new MultiSelectListPreference(screen.context);
  pref.key = SCANLATOR_BLACKLIST_PREF;
  pref.title = "Scanlator blacklist";
  pref.summary = "Hide chapters from the selected scanlators. The list fills up automatically as you browse titles.";
  pref.entries = scanlators;
  pref.entryValues = scanlators;
  pref.setDefaultValue([]);
  screen.addPreference(pref);
}

const SCANLATOR_BLACKLIST_PREF = "scanlator_blacklist_pref";
const KNOWN_SCANLATORS_PREF = "known_scanlators_pref";
