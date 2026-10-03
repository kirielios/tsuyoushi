// Port of keiyoushi/extensions-source src/en/mangauno/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Webtoon", "webtoon"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Cancelled", "cancelled"],
    ]);
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort", [
      ["Popularity", "popularity"],
      ["Score", "score"],
      ["Latest chapter", "latest"],
      ["A–Z", "az"],
      ["Newest added", "newest"],
      ["Oldest added", "oldest"],
    ]);
  }
}

export class YearFilter extends Filter.Text {}

export class YearGroup extends Filter.Group<YearFilter> {
  constructor() {
    super(`Year (1900-${new Date().getFullYear()})`, [new YearFilter("Min"), new YearFilter("Max")]);
  }
}

export class AdultFilter extends Filter.CheckBox {
  constructor() {
    super("Include adult (18+)", false);
  }
}

export class CheckBoxFilter extends Filter.CheckBox {}
export class GenreGroup extends Filter.Group<CheckBoxFilter> {
  constructor(genres: CheckBoxFilter[]) {
    super("Genres", genres);
  }
}
export class TagGroup extends Filter.Group<CheckBoxFilter> {
  constructor(tags: CheckBoxFilter[]) {
    super("Tags", tags);
  }
}
