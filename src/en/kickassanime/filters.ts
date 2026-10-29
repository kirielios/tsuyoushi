// Port of yuzono/anime-extensions src/en/kickassanime/KickAssAnimeFilters.kt
import { Filter, firstInstance, type FilterList } from "../../../sdk/index.ts";

class QueryPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toQueryPart() {
    return this.vals[this.state][1];
  }
}

class CheckBoxVal extends Filter.CheckBox {}

export class GenreFilter extends Filter.Group<CheckBoxVal> {
  constructor() {
    super(
      "Genre",
      GENRE.map((it) => new CheckBoxVal(it)),
    );
  }
}
export class YearFilter extends QueryPartFilter {
  constructor() {
    super("Year", YEAR());
  }
}
export class StatusFilter extends QueryPartFilter {
  constructor() {
    super("Status", STATUS);
  }
}
export class TypeFilter extends QueryPartFilter {
  constructor() {
    super("Type", TYPE);
  }
}
export class SubPageFilter extends QueryPartFilter {
  constructor() {
    super("Sub-page", SUBPAGE);
  }
}

export const FILTER_LIST = (): FilterList => [
  new GenreFilter(),
  new YearFilter(),
  new StatusFilter(),
  new TypeFilter(),
  new Filter.Separator(),
  new Filter.Header("NOTE: Overrides & ignores search and other filters"),
  new SubPageFilter(),
];

export interface FilterSearchParams {
  filters: string;
  subPage: string;
}

const getJsonList = (listString: string, name: string) => (listString ? `"${name}":[${listString}]` : "");
const getJsonItem = (item: string, name: string) => (item ? `"${name}":${item}` : "");

export function getSearchParameters(filters: FilterList): FilterSearchParams {
  if (!filters.length) filters = FILTER_LIST();
  const genre = firstInstance(filters, GenreFilter)
    .state.filter((it) => it.state)
    .map((it) => `"${it.name}"`)
    .join(",");
  const year = firstInstance(filters, YearFilter).toQueryPart();
  const status = firstInstance(filters, StatusFilter).toQueryPart();
  const type = firstInstance(filters, TypeFilter).toQueryPart();

  const filtersQuery = `{${[getJsonList(genre, "genres"), getJsonItem(year, "year"), getJsonItem(status, "status"), getJsonItem(type, "type")].filter((it) => it).join(",")}}`;
  return {
    filters: filtersQuery,
    subPage: firstInstance(filters, SubPageFilter).toQueryPart(),
  };
}

// Every genre's value is its name upstream, so only the names are kept.
const GENRE = [
  "Action", "Adult Cast", "Adventure", "Anthropomorphic", "Avant Garde", "Award Winning", "Boys Love", "CGDCT", "Childcare", "Combat Sports",
  "Comedy", "Crossdressing", "Delinquents", "Detective", "Drama", "Ecchi", "Educational", "Erotica", "Fantasy", "Gag Humor", "Girls Love",
  "Gore", "Gourmet", "Harem", "High Stakes Game", "Historical", "Horror", "Idols (Female)", "Idols (Male)", "Isekai", "Iyashikei", "Josei",
  "Kids", "Love Polygon", "Magical Sex Shift", "Mahou Shoujo", "Martial Arts", "Mecha", "Medical", "Military", "Music", "Mystery",
  "Mythology", "Organized Crime", "Otaku Culture", "Parody", "Performing Arts", "Pets", "Psychological", "Racing", "Reincarnation",
  "Reverse Harem", "Romance", "Romantic Subtext", "Samurai", "School", "Sci-Fi", "Seinen", "Shoujo", "Shounen", "Showbiz", "Slice of Life",
  "Space", "Sports", "Strategy Game", "Super Power", "Supernatural", "Survival", "Suspense", "Team Sports", "Time Travel", "Urban Fantasy",
  "Vampire", "Video Game", "Villainess", "Visual Arts", "Workplace",
]; // prettier-ignore

const YEAR = (): [string, string][] => {
  const currentYear = new Date().getFullYear();
  const years: [string, string][] = [["All", ""]];
  for (let y = currentYear; y >= 1967; y--) years.push([String(y), String(y)]);
  return years;
};

const STATUS: [string, string][] = [
  ["All", ""],
  ["Finished Airing", '"finished"'],
  ["Currently Airing", '"airing"'],
];

const TYPE: [string, string][] = [
  ["All", ""],
  ["TV", '"tv"'],
  ["Movie", '"movie"'],
  ["ONA", '"ona"'],
  ["OVA", '"ova"'],
  ["SPECIAL", '"special"'],
  ["TV_SPECIAL", '"tv_special"'],
];

const SUBPAGE: [string, string][] = [
  ["<Select>", ""],
  ["Trending", "show/trending"],
  ["Anime", "anime"],
  ["Recently Added", "show/recent"],
  ["Popular Shows", "show/popular"],
];
