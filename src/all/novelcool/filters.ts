// Port of keiyoushi/extensions-source src/all/novelcool/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class AuthorFilter extends Filter.Text {}

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(title: string, genres: [string, string][]) {
    super(
      title,
      genres.map((it) => new Genre(it[0], it[1])),
    );
  }
  get included(): string[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.id);
  }
  get excluded(): string[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.id);
  }
}

export const getStatusList = (): [string, string][] => [
  ["All", ""],
  ["Completed", "YES"],
  ["Ongoing", "NO"],
];

export class StatusFilter extends Filter.Select<string> {
  constructor(
    title: string,
    private readonly status: [string, string][],
  ) {
    super(
      title,
      status.map((it) => it[0]),
    );
  }
  getValue() {
    return this.status[this.state][1];
  }
}

export const getRatingList = (): [string, string][] => [
  ["All", ""],
  ["5 Star", "5"],
  ["4 Star", "4"],
  ["3 Star", "3"],
  ["2 Star", "2"],
];

export class RatingFilter extends Filter.Select<string> {
  constructor(
    title: string,
    private readonly ratings: [string, string][],
  ) {
    super(
      title,
      ratings.map((it) => it[0]),
    );
  }
  getValue() {
    return this.ratings[this.state][1];
  }
}
