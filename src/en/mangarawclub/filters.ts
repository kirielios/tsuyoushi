// Port of keiyoushi/extensions-source src/en/mangarawclub/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getFilters = (): FilterList =>
  FilterList(
    new SortFilter("Sort by", getSortsList),
    new StatusFilter("Status", getStatusList),
    new TypeFilter("Types", getTypeList),
    new GenreFilter("Genre", getGenres),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new TextFilter("Tags"),
    new Filter.Separator(),
    new ChapterMinFilter("Minimum Chapter"),
    new ChapterMaxFilter("Maximum Chapter"),
    new Filter.Separator(),
    new Filter.Header("Minimum Rating (e.g.: 1.1, 5.0)"),
    new RatingFilter("Minimum Rating"),
    new Filter.Separator(),
    new ExtraFilter("Extras"),
  );

export function isDefault(filter: Filter): boolean {
  if (filter instanceof SortFilter) return filter.state === 1;
  if (filter instanceof Filter.Select) return filter.state === 0;
  if (filter instanceof Filter.Text) return filter.state.length === 0;
  if (filter instanceof Filter.CheckBox) return !filter.state;
  if (filter instanceof Filter.TriState) return filter.state === 0;
  if (filter instanceof Filter.Group) {
    return (filter.state as Filter[]).every((it) => {
      if (it instanceof Filter.CheckBox) return !it.state;
      if (it instanceof Filter.TriState) return it.state === 0;
      return true;
    });
  }
  return true;
}

export class ExtraFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string) {
    super(name, [new CheckBoxFilter("Only completed series", "only_completed"), new CheckBoxFilter("At least 50+ chapters translated", "only_translated"), new CheckBoxFilter("Hide long hiatus (> 6 months)", "hide_on_break")]);
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class StatusFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: string[],
    state = 0,
  ) {
    super(name, vals, state);
  }
  get selected() {
    return this.vals[this.state].replace("Any", "");
  }
}

export class TypeFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: string[],
    state = 0,
  ) {
    super(name, vals, state);
  }
  get selected() {
    return this.vals[this.state].replace("Any", "");
  }
}

export class GenreFilter extends Filter.Group<TriFilter> {
  constructor(name: string, genreList: string[]) {
    super(
      name,
      genreList.map((it) => new TriFilter(it)),
    );
  }
}

export class TriFilter extends Filter.TriState {}
export class ChapterMinFilter extends Filter.Text {}
export class ChapterMaxFilter extends Filter.Text {}
export class RatingFilter extends Filter.Text {}
export class TextFilter extends Filter.Text {}

export class SortFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: [string, string][],
    state = 1,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      state,
    );
  }
  get selected(): string | null {
    return this.vals[this.state][1] || null;
  }
}

const getGenres = [
  "Action", "Adventure", "Comedy", "Cooking", "Manga", "Drama", "Fantasy",
  "Gender bender", "Harem", "Historical", "Horror", "Isekai", "Josei",
  "Manhua", "Manhwa", "Martial arts", "Mature", "Mecha", "Medical",
  "Mystery", "One shot", "Psychological", "Romance", "School life",
  "Sci fi", "Seinen", "Shoujo", "Shounen", "Slice of life", "Sports",
  "Supernatural", "Tragedy", "Webtoons", "Ladies",
]; // prettier-ignore

const getStatusList = ["Any", "Ongoing", "Completed", "Hiatus"];
const getTypeList = ["Any", "Manga", "Manhwa", "Manhua", "Webtoon"];

const getSortsList: [string, string][] = [
  ["New", "recently_added"],
  ["Updated", "latest"],
  ["Popular (Daily)", "popular_daily"],
  ["Popular (Weekly)", "popular_weekly"],
  ["Popular (Monthly)", "popular_monthly"],
  ["Popular (All Time)", "popular_all_time"],
  ["Rating", "rating"],
  ["Title (A-Z)", "az"],
  ["Title (Z-A)", "za"],
];
