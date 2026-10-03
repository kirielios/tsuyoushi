// Port of keiyoushi/extensions-source src/en/comix/Filters.kt
import { Filter, FilterList, type HttpUrlBuilder } from "../../../sdk/index.ts";

// Kotlin marker interfaces, as flags the search code can test at runtime
export interface UriFilter {
  addToUri(builder: HttpUrlBuilder, query?: string): void;
  readonly preferenceFilter?: boolean; // PreferenceFilter
  readonly queryAware?: boolean; // QueryAwareFilter
  readonly requiresTermSelection?: boolean; // RequiresTermSelection
}
export interface TermFilter {
  readonly hasSelection: boolean;
}
export const isUriFilter = (f: unknown): f is UriFilter & Filter => typeof (f as UriFilter)?.addToUri === "function";
export const isTermFilter = (f: unknown): f is TermFilter => f instanceof TermGroupFilter;

const OLDEST_YEAR = 1928;

const CONTENT_RATING_OPTIONS: [string, string][] = [
  ["Show all", ""],
  ["Safe only", "safe"],
  ["Up to Suggestive", "suggestive"],
  ["Up to Erotica", "erotica"],
  ["Up to Pornographic", "pornographic"],
];

function getYearsArray(forFromFilter: boolean): [string, string][] {
  const newest = new Date().getFullYear() + 1;
  const years: [string, string][] = [];
  for (let y = newest; y >= OLDEST_YEAR; y--) years.push([String(y), String(y)]);
  const any: [string, string] = ["Any", ""];
  return forFromFilter ? [...years, any] : [any, ...years];
}

export const getGenres = (): [string, string][] => [
  ["Action", "6"],
  ["Adult", "87264"],
  ["Adventure", "7"],
  ["Boys Love", "8"],
  ["Comedy", "9"],
  ["Crime", "10"],
  ["Drama", "11"],
  ["Ecchi", "87265"],
  ["Fantasy", "12"],
  ["Girls Love", "13"],
  ["Harem", "40"],
  ["Hentai", "87266"],
  ["Historical", "14"],
  ["Horror", "15"],
  ["Isekai", "16"],
  ["Magical Girls", "17"],
  ["Mature", "87267"],
  ["Mecha", "18"],
  ["Medical", "19"],
  ["Mystery", "20"],
  ["Philosophical", "21"],
  ["Psychological", "22"],
  ["Romance", "23"],
  ["Sci-Fi", "24"],
  ["Slice of Life", "25"],
  ["Smut", "87268"],
  ["Sports", "26"],
  ["Superhero", "27"],
  ["Thriller", "28"],
  ["Tragedy", "29"],
  ["Wuxia", "30"],
];

export const getFormats = (): [string, string][] => [
  ["4-Koma", "93164"],
  ["Adaptation", "93167"],
  ["Anthology", "93165"],
  ["Award Winning", "93166"],
  ["Doujinshi", "93168"],
  ["Full Color", "93172"],
  ["Long Strip", "93170"],
  ["Oneshot", "93169"],
  ["Web Comic", "93171"],
];

export const getDemographics = (): [string, string][] => [
  ["Josei", "3"],
  ["Seinen", "4"],
  ["Shoujo", "1"],
  ["Shounen", "2"],
];

export const getTypes = (): [string, string][] => [
  ["Manga", "manga"],
  ["Manhwa", "manhwa"],
  ["Manhua", "manhua"],
  ["Other", "other"],
];

export function getContentRatingsUpTo(maxRating: string): string[] {
  if (!maxRating) return [];
  const ratings = ["safe", "suggestive", "erotica", "pornographic"];
  const index = ratings.indexOf(maxRating);
  return index === -1 ? [] : ratings.slice(0, index + 1);
}

export class Filters {
  constructor(
    private readonly contentRating: string,
    private readonly selectedTypes: string[],
    private readonly selectedDemographics: string[],
    private readonly blockedGenres: string[],
  ) {}

  getFilterList(): FilterList {
    return FilterList(
      new SortFilter(getSortables()),
      new ContentRatingFilter(this.contentRating),
      new TypeFilter(this.selectedTypes),
      new Filter.Separator(),
      new Filter.Header("Tags — comma separated"),
      new TagsFilter(),
      new Filter.Header("Match: AND requires every selection, OR matches any"),
      new MatchModeFilter(),
      new GenreFilter(getGenres(), this.blockedGenres),
      new FormatFilter(getFormats()),
      new Filter.Separator(),
      new DemographicFilter(getDemographics(), this.selectedDemographics),
      new StatusFilter(),
      new MinChapterFilter(),
      new Filter.Separator(),
      new Filter.Header("Release Year"),
      new YearFromFilter(),
      new YearToFilter(),
      new Filter.Separator(),
      new Filter.Header("Author / Artist — comma separated"),
      new AuthorFilter(),
      new ArtistFilter(),
    );
  }
}

class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    protected readonly vals: [string, string][],
    defaultValue: string | null = null,
  ) {
    const idx = vals.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      vals.map((it) => it[0]),
      idx !== -1 ? idx : 0,
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const v = this.vals[this.state][1];
    if (v) builder.addQueryParameter(this.param, v);
  }
}

class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: [string, string][],
    selectedValues: string[] = [],
    private readonly onlyIfSome = false,
  ) {
    super(
      name,
      vals.map(([n, value]) => {
        const o = new UriMultiSelectOption(n, value);
        o.state = selectedValues.includes(value);
        return o;
      }),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state);
    // Ignore when no explicit inclusion (default)
    if (this.onlyIfSome && checked.length === this.vals.length) return;
    checked.forEach((it) => builder.addQueryParameter(this.param, it.value));
  }
}

class UriTriSelectOption extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

// The API ignores demographic exclusions, so this must remain include/off.
class DemographicFilter extends UriMultiSelectFilter {
  readonly preferenceFilter = true;
  constructor(demographics: [string, string][], selectedValues: string[]) {
    super("Demographic", "demographics[]", demographics, selectedValues, true);
  }
}

class TypeFilter extends UriMultiSelectFilter {
  readonly preferenceFilter = true;
  constructor(selectedValues: string[]) {
    super("Type", "types[]", getTypes(), selectedValues, true);
  }
}

abstract class TermGroupFilter extends Filter.Group<UriTriSelectOption> implements UriFilter, TermFilter {
  constructor(title: string, options: [string, string][], excludedValues: string[] = []) {
    super(
      title,
      options.map(([name, value]) => {
        const o = new UriTriSelectOption(name, value);
        if (excludedValues.includes(value)) o.state = Filter.TriState.STATE_EXCLUDE;
        return o;
      }),
    );
  }
  get hasSelection() {
    return this.state.some((it) => it.state !== Filter.TriState.STATE_IGNORE);
  }
  addToUri(builder: HttpUrlBuilder) {
    this.state.filter((it) => it.state === Filter.TriState.STATE_INCLUDE).forEach((it) => builder.addQueryParameter("genres_in[]", it.value));
    this.state.filter((it) => it.state === Filter.TriState.STATE_EXCLUDE).forEach((it) => builder.addQueryParameter("genres_ex[]", it.value));
  }
}

class GenreFilter extends TermGroupFilter {
  readonly preferenceFilter = true;
  constructor(genres: [string, string][], blockedGenres: string[]) {
    super("Genres", genres, blockedGenres);
  }
}

class FormatFilter extends TermGroupFilter {
  constructor(formats: [string, string][]) {
    super("Formats", formats);
  }
}

export class TagsFilter extends Filter.Text {
  constructor() {
    super("Tags");
  }
}

class StatusFilter extends UriMultiSelectFilter {
  constructor() {
    super("Status", "statuses[]", [
      ["Releasing", "releasing"],
      ["Finished", "finished"],
      ["On Hiatus", "on_hiatus"],
      ["Discontinued", "discontinued"],
      ["Not Yet Released", "not_yet_released"],
    ]);
  }
}

class YearFromFilter extends UriPartFilter {
  constructor() {
    super("From", "year_from", getYearsArray(true), "");
  }
}

class YearToFilter extends UriPartFilter {
  constructor() {
    super("To", "year_to", getYearsArray(false), "");
  }
  override addToUri(builder: HttpUrlBuilder) {
    if (this.state > 0) super.addToUri(builder);
  }
}

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}

export class ArtistFilter extends Filter.Text {
  constructor() {
    super("Artist");
  }
}

class MatchModeFilter extends UriPartFilter {
  readonly requiresTermSelection = true;
  constructor() {
    super("Match", "genres_mode", [
      ["All (AND)", "and"],
      ["Any (OR)", "or"],
    ]);
  }
}

class ContentRatingFilter extends UriPartFilter {
  readonly preferenceFilter = true;
  constructor(defaultValue: string) {
    super("Content rating", "content_rating", CONTENT_RATING_OPTIONS, defaultValue);
  }
  override addToUri(builder: HttpUrlBuilder) {
    const ratings = getContentRatingsUpTo(CONTENT_RATING_OPTIONS[this.state][1]);
    ratings.forEach((it) => builder.addQueryParameter("content_rating[]", it));
  }
}

class MinChapterFilter extends Filter.Text implements UriFilter {
  constructor() {
    super("Minimum Chapter Length");
  }
  addToUri(builder: HttpUrlBuilder) {
    if (this.state) {
      const n = /^[+-]?\d+$/.test(this.state) ? Number.parseInt(this.state, 10) : null;
      if (n == null || n <= 0) throw new Error("Minimum chapter length must be a positive integer greater than 0");
      builder.addQueryParameter("min_chap", String(n));
    }
  }
}

interface Sortable {
  title: string;
  value: string;
}

const getSortables = (): Sortable[] =>
  [
    ["Relevance", "relevance"],
    ["Latest update", "chapter_updated_at"],
    ["Recently added", "created_at"],
    ["Title", "title"],
    ["Year", "year"],
    ["Highest rated", "score"],
    ["Most viewed · 7 days", "views_7d"],
    ["Most viewed · 30 days", "views_30d"],
    ["Most viewed · 90 days", "views_90d"],
    ["Most viewed · all time", "views_total"],
    ["Most followed", "follows_total"],
  ].map(([title, value]) => ({ title, value }));

class SortFilter extends Filter.Sort implements UriFilter {
  readonly queryAware = true;
  constructor(private readonly sortables: Sortable[]) {
    super(
      "Sort By",
      sortables.map((it) => it.title),
      { index: 0, ascending: false },
    );
  }
  addToUri(builder: HttpUrlBuilder, query = "") {
    if (this.state != null) {
      const selected = this.sortables[this.state.index].value;
      const order = selected === "relevance" && !query.trim() ? "chapter_updated_at" : selected;
      const value = this.state.ascending ? "asc" : "desc";
      builder.addQueryParameter(`order[${order}]`, value);
    }
  }
}
