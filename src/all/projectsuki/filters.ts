// Port of keiyoushi/extensions-source src/all/projectsuki/ProjectSukiFilters.kt and ProjectSukiPreferences.kt
import { EditTextPreference, Filter, ListPreference, type HttpUrlBuilder, type PreferenceScreen, type SharedPreferences } from "../../../sdk/index.ts";
import { SHORT_FORM_ID, UNKNOWN_LANGUAGE } from "./pathpattern.ts";

// --- ProjectSukiFilters.kt

export interface ProjectSukiFilter {
  applyFilter(builder: HttpUrlBuilder): void;
  readonly psHeaders: Filter.Header[];
}

const headers = (block: string): Filter.Header[] => block.split(/\r\n|[\n\r\v\f\x85]/).map((it) => new Filter.Header(it)); // \R
const ensureAdv = (builder: HttpUrlBuilder) => builder.setQueryParameter("adv", "1");

export class SearchMode {
  private constructor(
    readonly display: string,
    readonly ordinal: number,
    readonly description: () => string,
  ) {}
  toString() {
    return this.display;
  }
  static readonly SMART = new SearchMode("Smart", 0, () => "Searches for books that have chapters using Unicode ICU Collation and utilities, should work for queries in all languages.");
  static readonly SIMPLE = new SearchMode("Simple", 1, () => `Ideally the same as ${SearchMode.SMART}. Necessary for Android API < 24. MIGHT make searches faster. Might be unreliable for non-english characters.`);
  static readonly FULL_SITE = new SearchMode("Full Site", 2, () => "Executes a /search web query on the website. Might return non-relevant results without chapters.");
  static readonly entries = [SearchMode.SMART, SearchMode.SIMPLE, SearchMode.FULL_SITE];
}

const StatusValue = [
  { display: "Any", query: "" },
  { display: "Ongoing", query: "ongoing" },
  { display: "Completed", query: "completed" },
  { display: "Hiatus", query: "hiatus" },
  { display: "Cancelled", query: "cancelled" },
];

const OriginValue = [
  { display: "Any", query: "" },
  { display: "Korea", query: "kr" },
  { display: "China", query: "cn" },
  { display: "Japan", query: "jp" },
];

export class SearchModeFilter extends Filter.Select<string> implements ProjectSukiFilter {
  constructor(defaultMode: SearchMode) {
    super(
      "Search Mode",
      SearchMode.entries.map((it) => it.display),
      defaultMode.ordinal,
    );
  }
  readonly psHeaders = headers("See Extensions > Project Suki > Gear icon\nfor differences and for how to set the default.");
  applyFilter() {}
}

export class Author extends Filter.Text implements ProjectSukiFilter {
  constructor() {
    super("Author");
  }
  readonly psHeaders = headers("Search by a single author:");
  applyFilter(builder: HttpUrlBuilder) {
    if (this.state.trim()) ensureAdv(builder).addQueryParameter("author", this.state);
  }
}

export class Artist extends Filter.Text implements ProjectSukiFilter {
  constructor() {
    super("Artist");
  }
  readonly psHeaders = headers("Search by a single artist:");
  applyFilter(builder: HttpUrlBuilder) {
    if (this.state.trim()) ensureAdv(builder).addQueryParameter("artist", this.state);
  }
}

export class Status extends Filter.Select<string> implements ProjectSukiFilter {
  constructor() {
    super(
      "Status",
      StatusValue.map((it) => it.display),
    );
  }
  readonly psHeaders: Filter.Header[] = [];
  applyFilter(builder: HttpUrlBuilder) {
    if (this.state !== 0) ensureAdv(builder).addQueryParameter("status", StatusValue[this.state].query);
  }
}

export class Origin extends Filter.Select<string> implements ProjectSukiFilter {
  constructor() {
    super(
      "Origin",
      OriginValue.map((it) => it.display),
    );
  }
  readonly psHeaders: Filter.Header[] = [];
  applyFilter(builder: HttpUrlBuilder) {
    if (this.state !== 0) ensureAdv(builder).addQueryParameter("origin", OriginValue[this.state].query);
  }
}

function addFilter(out: Filter[], filter: Filter & ProjectSukiFilter) {
  out.push(...filter.psHeaders, filter);
}

export const ProjectSukiFilters = {
  headersSequence: (_preferences: ProjectSukiPreferences): Filter[] => [],
  filtersSequence(preferences: ProjectSukiPreferences): Filter[] {
    const out: Filter[] = [];
    addFilter(out, new SearchModeFilter(preferences.defaultSearchMode()));
    out.push(new Filter.Separator());
    out.push(new Filter.Header("All filters below will only work in Full Site mode."));
    addFilter(out, new Origin());
    addFilter(out, new Status());
    out.push(new Filter.Separator());
    addFilter(out, new Author());
    addFilter(out, new Artist());
    return out;
  },
  footersSequence: (_preferences: ProjectSukiPreferences): Filter[] => [],
};

// --- ProjectSukiPreferences.kt

const toLanguageSet = (s: string) =>
  new Set(
    s
      .split(",")
      .filter((it) => it.trim())
      .map((it) => it.trim().toLowerCase()),
  );

export class ProjectSukiPreferences {
  constructor(readonly shared: SharedPreferences) {}

  private static readonly DEFAULT_SEARCH_MODE = `${SHORT_FORM_ID}-default-search-mode`;
  private static readonly WHITELIST = `${SHORT_FORM_ID}-languages-whitelist`;
  private static readonly BLACKLIST = `${SHORT_FORM_ID}-languages-blacklist`;

  defaultSearchMode(): SearchMode {
    const v = this.shared.getString(ProjectSukiPreferences.DEFAULT_SEARCH_MODE, SearchMode.SMART.display)!;
    return SearchMode.entries.find((it) => it.display === v) ?? SearchMode.SMART;
  }
  whitelistedLanguages(): Set<string> {
    return toLanguageSet(this.shared.getString(ProjectSukiPreferences.WHITELIST, "")!);
  }
  blacklistedLanguages(): Set<string> {
    return toLanguageSet(this.shared.getString(ProjectSukiPreferences.BLACKLIST, "")!);
  }

  configure(screen: PreferenceScreen) {
    const mode = new ListPreference(screen.context);
    mode.key = ProjectSukiPreferences.DEFAULT_SEARCH_MODE;
    mode.entries = SearchMode.entries.map((it) => it.display);
    mode.entryValues = SearchMode.entries.map((it) => it.display);
    mode.setDefaultValue(SearchMode.SMART.display);
    mode.title = "Default search mode";
    mode.summary = [
      `Select which Search Mode to use by default. Can be useful for global searches. ${SearchMode.SMART} is recommended.`,
      ` - ${SearchMode.SMART}: ${SearchMode.SMART.description()}`,
      ` - ${SearchMode.SIMPLE}: ${SearchMode.SIMPLE.description()}`,
      ` - ${SearchMode.FULL_SITE}: ${SearchMode.FULL_SITE.description()}`,
    ].join("\n");
    screen.addPreference(mode);

    const wl = new EditTextPreference(screen.context);
    wl.key = ProjectSukiPreferences.WHITELIST;
    wl.title = "Whitelisted languages";
    wl.dialogTitle = "Include chapters in the following languages:";
    wl.summary = [
      "NOTE: You will need to refresh comics that have already been fetched!! (drag down in the comic page in tachiyomi)",
      "",
      "When empty will allow all languages (see blacklisting).",
      'It will match the string present in the "Language" column of the chapter (NOT case sensitive).',
      `Chapters that do not have a "Language" column, will be listed as "${UNKNOWN_LANGUAGE}", which is always whitelisted (see blacklisting).`,
      "Enter the languages you want to include by separating them with a comma ',' (e.g. \"English, SPANISH, gReEk\", without quotes (\")).",
    ].join("\n");
    screen.addPreference(wl);

    const bl = new EditTextPreference(screen.context);
    bl.key = ProjectSukiPreferences.BLACKLIST;
    bl.title = "Blacklisted languages";
    bl.dialogTitle = "Exclude chapters in the following languages:";
    bl.summary = [
      "NOTE: You will need to refresh comics that have already been fetched!! (drag down in the comic page in tachiyomi)",
      "",
      "When a language is in BOTH whitelist and blacklist, it will be EXCLUDED.",
      'It will match the string present in the "Language" column of the chapter (NOT case sensitive).',
      `Chapters that do not have a "Language" column, will be listed as "${UNKNOWN_LANGUAGE}", you can exclude them by adding "unknown" to the list (e.g. "Chinese, unknown, Alienese").`,
      "Enter the languages you want to exclude by separating them with a comma ',' (e.g. \"English, SPANISH, gReEk\", without quotes (\")).",
    ].join("\n");
    screen.addPreference(bl);
  }
}
