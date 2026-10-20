// Port of yuzono/anime-extensions src/all/animeworldindia/AnimeWorldIndiaFilters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

type StringQuery = [name: string, query: string];

class QueryList extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: StringQuery[],
    readonly param: string,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
    );
  }
}

class GenreList extends Filter.Group<Filter.CheckBox> {
  constructor() {
    super(
      "Genres",
      GENRES.map((g) => new Filter.CheckBox(g)),
    );
  }
}

const TYPES: StringQuery[] = [
  ["Any", "all"],
  ["TV", "tv"],
  ["Movie", "movie"],
];
const STATUSES: StringQuery[] = [
  ["Any", "all"],
  ["Currently Airing", "airing"],
  ["Finished Airing", "completed"],
];
const STYLES: StringQuery[] = [
  ["Any", "all"],
  ["Anime", "anime"],
  ["Cartoon", "cartoon"],
];
const YEARS: StringQuery[] = [["Any", "all"], ...Array.from({ length: 36 }, (_, i): StringQuery => [`${2025 - i}`, `${2025 - i}`])];
const SORTS: StringQuery[] = [
  ["Default", "default"],
  ["Ascending", "title_a_z"],
  ["Descending", "title_z_a"],
  ["Updated", "update"],
  ["Published", "date"],
  ["Most Viewed", "viewed"],
  ["Favourite", "favorite"],
];
const GENRES = [
  "Action", "Adult Cast", "Adventure", "Animation", "Comedy", "Detective", "Drama", "Ecchi", "Family", "Fantasy", "Isekai", "Kids",
  "Martial Arts", "Mecha", "Military", "Mystery", "Otaku Culture", "Reality", "Romance", "School", "Sci-Fi", "Seinen", "Shounen",
  "Slice of Life", "Sports", "Super Power", "SuperHero", "Supernatural", "TV Movie",
];

export const getFilterList = (): FilterList =>
  FilterList(
    new QueryList("Type", TYPES, "s_type"),
    new QueryList("Status", STATUSES, "s_status"),
    new QueryList("Style", STYLES, "s_sub_type"),
    new QueryList("Year", YEARS, "s_year"),
    new QueryList("Sort", SORTS, "s_orderby"),
    new GenreList(),
  );

export function getSearchParams(filters: FilterList): string {
  return (
    "&" +
    filters
      .flatMap((filter) => {
        if (filter instanceof QueryList) return [`${filter.param}=${filter.vals[filter.state][1]}`];
        if (filter instanceof GenreList)
          return [
            "s_genre=" +
              filter.state
                .filter((it) => it.state)
                .map((it) => `${it.name.replace(/ /g, "-")}%2C`)
                .join("%2C"),
          ];
        return [];
      })
      .join("&")
  );
}
