// Port of keiyoushi/extensions-source src/en/likemanga/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
    defaultValue: string | null = null,
  ) {
    const i = options.findIndex((it) => it[1] === defaultValue);
    super(name, options.map((it) => it[0]), i !== -1 ? i : 0);
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

export class GenreFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string, genres: [string, string][]) {
    super(name, genres.map((it) => new CheckBoxFilter(it[0], it[1])));
  }
  get checked(): string[] | null {
    const l = this.state.filter((it) => it.state).map((it) => it.value);
    return l.length === 0 ? null : l;
  }
}

export class SortFilter extends SelectFilter {
  constructor(defaultValue: string | null = null) {
    super(
      "Sort By",
      [
        ["", ""],
        ["Lasted update", "lastest-chap"],
        ["Lasted manga", "lastest-manga"],
        ["Top all", "top-manga"],
        ["Top month", "top-month"],
        ["Top week", "top-week"],
        ["Top day", "top-day"],
        ["Follow", "follow"],
        ["Comments", "comment"],
        ["Number of Chapters", "num-chap"],
      ],
      defaultValue,
    );
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Complete", "Complete"],
      ["In process", "In process"],
      ["Pause", "Pause"],
    ]);
  }
}

export class ChapterCountFilter extends SelectFilter {
  constructor() {
    super("Number of Chapters", [
      ["", ""],
      [">= 0 chapter", "1"],
      [">= 50 chapter", "50"],
      [">= 100 chapter", "100"],
      [">= 200 chapter", "200"],
      [">= 300 chapter", "300"],
      [">= 400 chapter", "400"],
      [">= 500 chapter", "500"],
    ]);
  }
}
