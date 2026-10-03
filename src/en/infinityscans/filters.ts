// Port of keiyoushi/extensions-source src/en/infinityscans/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  private readonly options: [string, string][];
  constructor(name: string, options: [string, string][], defaultValue: string | null = null) {
    const i = options.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      options.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
    this.options = options;
  }
  get selected(): string | null {
    const v = this.options[this.state][1];
    return v === "" ? null : v;
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

const checkedOf = (state: CheckBoxFilter[]): string[] | null => {
  const l = state.filter((it) => it.state).map((it) => it.value);
  return l.length ? l : null;
};

export class GenreFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string, genres: [string, string][]) {
    super(
      name,
      genres.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  get checked() {
    return checkedOf(this.state);
  }
}

export class AuthorFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string, authors: [string, string][]) {
    super(
      name,
      authors.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  get checked() {
    return checkedOf(this.state);
  }
}

export class StatusFilter extends Filter.Group<CheckBoxFilter> {
  constructor() {
    super("Status", [new CheckBoxFilter("Ongoing", "1"), new CheckBoxFilter("Completed", "4"), new CheckBoxFilter("Hiatus", "2"), new CheckBoxFilter("Cancelled", "3")]);
  }
  /** all checked values (upstream takes the first) */
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export const SortType = {
  Title: "",
  Latest: "1",
  Popularity: "2",
} as const;

export class SortFilter extends SelectFilter {
  constructor(defaultSort: string | null = null) {
    super("Sort By", Object.entries(SortType), defaultSort);
  }
}
