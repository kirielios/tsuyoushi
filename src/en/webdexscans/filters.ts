// Port of keiyoushi/extensions-source src/en/webdexscans/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected(): string | null {
    const v = this.options[this.state][1];
    return v.length > 0 ? v : null;
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genre", [
      ["All Genres", ""],
      ["Action", "action"],
      ["Adventure", "adventure"],
      ["Comedy", "comedy"],
      ["Drama", "drama"],
      ["Fantasy", "fantasy"],
      ["Isekai", "isekai"],
      ["Martial Arts", "martial-arts"],
      ["Mystery", "mystery"],
      ["Romance", "romance"],
      ["Sci-Fi", "sci-fi"],
      ["Seinen", "seinen"],
      ["Shounen", "shounen"],
      ["Slice of Life", "slice-of-life"],
      ["Supernatural", "supernatural"],
    ]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["All Types", ""],
      ["Manhwa", "manhwa"],
      ["Manga", "manga"],
      ["Manhua", "manhua"],
      ["Webtoon", "webtoon"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All Status", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
    ]);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Latest Update", "latest"],
      ["Most Popular", "popular"],
      ["Highest Rating", "rating"],
      ["Alphabetical", "a-z"],
    ]);
  }
}
