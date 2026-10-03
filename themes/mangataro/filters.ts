// Port of keiyoushi/extensions-source lib-multisrc/mangataro/Filters.kt
import { Filter, FilterList } from "../../sdk/index.ts";

export abstract class SelectFilter<T> extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, T][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected(): T {
    return this.options[this.state][1];
  }
}

export class CheckBoxFilter<T> extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: T,
  ) {
    super(name);
  }
}

export abstract class CheckBoxGroup<T> extends Filter.Group<CheckBoxFilter<T>> {
  constructor(name: string, options: [string, T][]) {
    super(
      name,
      options.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  get checked(): T[] {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export class SearchWithFilters extends Filter.CheckBox {
  constructor() {
    super("Apply filters to Text Search", false);
  }
}

export class TypeFilter extends SelectFilter<string | null> {
  constructor() {
    super("Type", [
      ["All", null],
      ["Manga", "Manga"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
    ]);
  }
}

export class StatusFilter extends SelectFilter<string | null> {
  constructor() {
    super("Status", [
      ["All", null],
      ["Completed", "Completed"],
      ["Ongoing", "Ongoing"],
    ]);
  }
}

export class YearFilter extends SelectFilter<number | null> {
  constructor() {
    const options: [string, number | null][] = [["All", null]];
    const current = new Date().getFullYear();
    for (let y = current; y >= 1949; y--) options.push([String(y), y]);
    super("Year", options);
  }
}

export class TagFilter extends CheckBoxGroup<number> {
  constructor(options: [string, number][] = []) {
    super("Tags", options);
  }
}

export class TagFilterMatch extends SelectFilter<string> {
  constructor() {
    super("Tag Match", [
      ["Any", "any"],
      ["All", "all"],
    ]);
  }
}

const sort: [string, string][] = [
  ["Latest Updates", "post"],
  ["Release Date", "release"],
  ["Title A-Z", "title"],
  ["Popular", "popular"],
];

export class SortFilter extends Filter.Sort {
  constructor(state: { index: number; ascending: boolean } = { index: 0, ascending: false }) {
    super(
      "Sort",
      sort.map((it) => it[0]),
      state,
    );
  }
  private get sortDirection() {
    return this.state?.ascending === true ? "asc" : "desc";
  }
  get selected() {
    return `${sort[this.state?.index ?? 0][1]}_${this.sortDirection}`;
  }

  static get popular(): FilterList {
    return FilterList(new SortFilter({ index: 3, ascending: false }), new TagFilterMatch());
  }
  static get latest(): FilterList {
    return FilterList(new SortFilter({ index: 0, ascending: false }), new TagFilterMatch());
  }
}
