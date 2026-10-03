// Port of keiyoushi/extensions-source src/en/mangade/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
    state = 0,
  ) {
    super(displayName, vals.map((it) => it[0]), state);
  }
  toUriPart = () => this.vals[this.state][1];
}

export class SortFilter extends UriPartFilter {
  static readonly LATEST = 0;
  static readonly POPULAR = 2;
  constructor(defaultState = SortFilter.LATEST) {
    super(
      "Sort by",
      [
        ["Newest", "newest"],
        ["Oldest", "oldest"],
        ["Most viewed", "most-viewed"],
        ["Highly rate", "rating"],
        ["Name A-Z", "a-z"],
        ["Name Z-A", "z-a"],
      ],
      defaultState,
    );
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Completed", "1"],
      ["Releasing", "2"],
      ["On Hiatus", "3"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "manga"],
      ["One-Shot", "one-shot"],
      ["Dounjinshi", "dounjinshi"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
    ]);
  }
}

export class YearFilter extends UriPartFilter {
  constructor() {
    const years: [string, string][] = [];
    for (let y = 2026; y >= 2019; y--) years.push([String(y), String(y)]);
    super("Year", [["All", ""], ...years]);
  }
}

export class ChapterCountFilter extends UriPartFilter {
  constructor() {
    super("Chapters", [
      [">=0", "0"],
      [">=50", "50"],
      [">=100", "100"],
      [">=150", "150"],
      [">=200", "200"],
      [">=250", "250"],
    ]);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
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
