// Port of keiyoushi/extensions-source src/en/mgreadio/Filters.kt
import { Filter, type FilterList, type HttpUrlBuilder } from "../../../sdk/index.ts";

export function addFilters(builder: HttpUrlBuilder, filters: FilterList) {
  for (const filter of filters) {
    if (isUriFilter(filter)) filter.addToUri(builder);
  }
}

interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as unknown as UriFilter).addToUri === "function";

class UriSelectFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly queryName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    builder.addQueryParameter(this.queryName, this.vals[this.state][1]);
  }
}

export class TypeFilter extends UriSelectFilter {
  constructor() {
    super("Type", "type", TYPE_OPTIONS);
  }
}
export class StatusFilter extends UriSelectFilter {
  constructor() {
    super("Status", "status", STATUS_OPTIONS);
  }
}
export class AgeRatingFilter extends UriSelectFilter {
  constructor() {
    super("Age Rating", "age_rating", AGE_RATING_OPTIONS);
  }
}
export class RatingMinFilter extends UriSelectFilter {
  constructor() {
    super("Minimum Rating", "rating_min", RATING_MIN_OPTIONS);
  }
}
export class RatingMaxFilter extends UriSelectFilter {
  constructor() {
    super("Maximum Rating", "rating_max", RATING_MAX_OPTIONS);
  }
}
export class SortFilter extends UriSelectFilter {
  constructor() {
    super("Sort By", "sort", SORT_OPTIONS);
  }
}

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export interface GenreOption {
  name: string;
  id: string;
}

export class GenreFilter extends Filter.Group<Genre> implements UriFilter {
  constructor(genres: GenreOption[]) {
    super(
      "Genres",
      genres.map((it) => new Genre(it.name, it.id)),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    for (const genre of this.state.filter((it) => it.state)) builder.addQueryParameter("genre[]", genre.id);
  }
}

const TYPE_OPTIONS: [string, string][] = [
  ["All Types", ""],
  ["Comic", "comic"],
  ["Novel", "novel"],
  ["Oneshot", "oneshot"],
];

const STATUS_OPTIONS: [string, string][] = [
  ["All Status", ""],
  ["Ongoing", "ongoing"],
  ["Season End", "season_end"],
  ["Completed", "completed"],
  ["Source Hiatus", "source_hiatus"],
  ["Caught Up", "caught_up"],
  ["Dropped", "dropped"],
];

const AGE_RATING_OPTIONS: [string, string][] = [
  ["All Ages", ""],
  ["All ages", "all"],
  ["13+", "13+"],
  ["16+", "16+"],
  ["18+", "18+"],
];

const RATING_MIN_OPTIONS: [string, string][] = [
  ["Min", "0"],
  ["1 star", "1"],
  ["2 stars", "2"],
  ["3 stars", "3"],
  ["4 stars", "4"],
  ["5 stars", "5"],
];

const RATING_MAX_OPTIONS: [string, string][] = [
  ["Max", "6"],
  ["1 star", "1"],
  ["2 stars", "2"],
  ["3 stars", "3"],
  ["4 stars", "4"],
  ["5 stars", "5"],
];

const SORT_OPTIONS: [string, string][] = [
  ["Latest Updated", "updated"],
  ["Newest", "new"],
  ["Oldest", "old"],
  ["Most Views", "views"],
  ["Daily Views", "views_day"],
  ["Weekly Views", "views_week"],
  ["Monthly Views", "views_month"],
  ["Highest Rating", "rating"],
  ["Most Power Stone", "power"],
  ["Most Followers", "follow"],
];
