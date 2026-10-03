// Port of keiyoushi/extensions-source src/en/reimanga/Filters.kt
import { Filter } from "../../../sdk/index.ts";

const sortValues: [string, string][] = [
  ["Latest Update", "latest"],
  ["Newest", "newest"],
  ["Most Viewed", "viewed"],
  ["Top Rated", "scored"],
  ["Title A-Z", "title"],
];

export class SortFilter extends Filter.Sort {
  constructor() {
    super(
      "Sort",
      sortValues.map((it) => it[0]),
      { index: 0, ascending: false },
    );
  }
  get sort() {
    return sortValues[this.state?.index ?? 0][1];
  }
  get direction() {
    return this.state?.ascending ?? false ? "asc" : "desc";
  }
}

const statusValues: [string, string | null][] = [
  ["All", null],
  ["Ongoing", "ongoing"],
  ["Completed", "completed"],
];

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Status",
      statusValues.map((it) => it[0]),
    );
  }
  get status() {
    return statusValues[this.state][1];
  }
}

export class TriStateOption extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
    state: number,
  ) {
    super(name, state);
  }
}

export class TriStateFilter extends Filter.Group<TriStateOption> {
  constructor(name: string, options: TriStateOption[]) {
    super(name, options);
  }
  get included() {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded() {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

export class GenreFilter extends TriStateFilter {
  constructor(options: TriStateOption[]) {
    super("Genres", options);
  }
}

export class TagFilter extends TriStateFilter {
  constructor(options: TriStateOption[]) {
    super("Tags", options);
  }
}
