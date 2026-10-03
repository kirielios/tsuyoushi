// Port of keiyoushi/extensions-source src/en/philiascans/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

export class CheckBoxVal extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class CheckBoxGroup extends Filter.Group<CheckBoxVal> {
  constructor(displayName: string, options: [string, string][]) {
    super(displayName, options.map((it) => new CheckBoxVal(it[0], it[1])));
  }
  get checked(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

/** Builder.addFilter(param, filter) for both filter shapes. */
export function addFilter(url: { addQueryParameter(name: string, value: string): unknown }, param: string, filter: SelectFilter | CheckBoxGroup | null): void {
  if (filter instanceof SelectFilter) {
    if (filter.value.trim()) url.addQueryParameter(param, filter.value);
  } else if (filter) {
    for (const it of filter.checked) url.addQueryParameter(param, it);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", [
      ["Recently Updated", ""],
      ["Trending", "trending"],
      ["Most Viewed", "views"],
      ["Highest Rating", "rating"],
      ["Alphabetical", "title"],
      ["New Manga", "added"],
    ]);
  }
}

export class OrderFilter extends SelectFilter {
  constructor() {
    super("Order by", [
      ["Descending", "desc"],
      ["Ascending", "asc"],
    ]);
  }
}

export class TypeFilter extends CheckBoxGroup {
  constructor() {
    super("Types", [
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Webtoon", "webtoon"],
      ["Comic", "comic"],
    ]);
  }
}

export class StatusFilter extends CheckBoxGroup {
  constructor() {
    super("Status", [
      ["On Going", "on_going"],
      ["Completed", "completed"],
      ["On Hold", "on_hold"],
      ["Canceled", "canceled"],
    ]);
  }
}

export class GenreFilter extends CheckBoxGroup {
  constructor() {
    super("Genre", [
      ["Action", "action"],
      ["Adventure", "adventure"],
      ["Comedy", "comedy"],
      ["Drama", "drama"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Gourmet", "gourmet"],
      ["Harem", "harem"],
      ["Historical", "historical"],
      ["Isekai", "isekai"],
      ["Josei", "josei"],
      ["Magic", "magic"],
      ["Martial Arts", "martial-arts"],
      ["Monsters", "monsters"],
      ["Music", "music"],
      ["Mystery", "mystery"],
      ["Psychological", "psychological"],
      ["Regression", "regression"],
      ["Romance", "romance"],
      ["School Life", "school-life"],
      ["Sci-Fi", "sci-fi"],
      ["Seinen", "seinen"],
      ["Shoujo", "shoujo"],
      ["Shounen", "shounen"],
      ["Slice of Life", "slice-of-life"],
      ["Supernatural", "supernatural"],
      ["Survival", "survival"],
      ["Tragedy", "tragedy"],
      ["Villainess", "villainess"],
      ["War", "war"],
    ]);
  }
}
