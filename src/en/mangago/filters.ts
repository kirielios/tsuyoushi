// Port of keiyoushi/extensions-source src/en/mangago/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export interface UriFilter {
  addToUrl(builder: URL): void;
}

export const isUriFilter = (f: unknown): f is UriFilter => typeof (f as UriFilter)?.addToUrl === "function";

export class StatusFilter extends Filter.CheckBox implements UriFilter {
  constructor(
    name: string,
    readonly query: string,
    state: boolean,
  ) {
    super(name, state);
  }
  addToUrl(builder: URL): void {
    builder.searchParams.append(this.query, this.state ? "1" : "0");
  }
}

export class StatusFilterGroup extends Filter.Group<StatusFilter> implements UriFilter {
  constructor() {
    super("Status", [new StatusFilter("Completed", "f", true), new StatusFilter("Ongoing", "o", true)]);
  }
  addToUrl(builder: URL): void {
    this.state.forEach((it) => it.addToUrl(builder));
  }
}

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly query: string,
    private readonly vals: [string, string][],
    private readonly firstIsUnspecified = true,
    state = 0,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      state,
    );
  }
  addToUrl(builder: URL): void {
    if (this.state !== 0 || !this.firstIsUnspecified) builder.searchParams.append(this.query, this.vals[this.state][1]);
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super(
      "Sort",
      "sortby",
      [
        ["Random", "random"],
        ["Views", "view"],
        ["Comment Count", "comment_count"],
        ["Creation Date", "create_date"],
        ["Update Date", "update_date"],
      ],
      true,
      1,
    );
  }
}

export class GenreFilter extends Filter.TriState {}

export class GenreFilterGroup extends Filter.Group<GenreFilter> {
  constructor(genres: string[]) {
    super("Genres", genres.map((it) => new GenreFilter(it)));
  }
}
