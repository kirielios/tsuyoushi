// Port of keiyoushi/extensions-source lib-multisrc/natsuid/Filter.kt
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

export class TriStateFilter<T> extends Filter.TriState {
  constructor(
    name: string,
    readonly value: T,
  ) {
    super(name);
  }
}

export abstract class TriStateGroupFilter<T> extends Filter.Group<TriStateFilter<T>> {
  constructor(name: string, options: [string, T][]) {
    super(
      name,
      options.map((it) => new TriStateFilter(it[0], it[1])),
    );
  }
  get included(): T[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded(): T[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

const sortBy: [string, string][] = [
  ["Popular", "popular"],
  ["Rating", "rating"],
  ["Updated", "updated"],
  ["Bookmarked", "bookmarked"],
  ["Title", "title"],
];

export class SortFilter extends Filter.Sort {
  constructor(selection = 0) {
    super(
      "Sort",
      sortBy.map((it) => it[0]),
      { index: selection, ascending: false },
    );
  }
  get sort(): string {
    return sortBy[this.state?.index ?? 0][1];
  }
  get isAscending(): boolean {
    return this.state?.ascending ?? false;
  }

  // companion vals upstream; built per call because filter state is mutable
  static get popular(): FilterList {
    return FilterList(new SortFilter(0));
  }
  static get latest(): FilterList {
    return FilterList(new SortFilter(2));
  }
}

export class ProjectFilter extends Filter.CheckBox {
  constructor() {
    super("Project Only");
  }
}

export class GenreFilter extends TriStateGroupFilter<string> {
  constructor(genres: [string, string][]) {
    super("Genre", genres);
  }
}

export class GenreInclusion extends SelectFilter<string> {
  constructor() {
    super("Genre Inclusion Mode", [
      ["OR", "OR"],
      ["AND", "AND"],
    ]);
  }
}

export class GenreExclusion extends SelectFilter<string> {
  constructor() {
    super("Genre Exclusion Mode", [
      ["OR", "OR"],
      ["AND", "AND"],
    ]);
  }
}

export class TypeFilter extends CheckBoxGroup<string> {
  constructor() {
    super("Type", [
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
    ]);
  }
}

export class StatusFilter extends CheckBoxGroup<string> {
  constructor() {
    super("Status", [
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Cancelled", "cancelled"],
      ["On Hiatus", "on-hiatus"],
      ["Unknown", "unknown"],
    ]);
  }
}
