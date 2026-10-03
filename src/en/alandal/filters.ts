// Port of keiyoushi/extensions-source src/en/alandal/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
export const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as unknown as UriFilter).addToUri === "function";

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: [string, string][],
    defaultValue: string | null = null,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      Math.max(
        vals.findIndex((it) => it[1] === defaultValue),
        0,
      ),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    builder.addQueryParameter(this.param, this.vals[this.state][1]);
  }
}

export class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    vals: [string, string][],
  ) {
    super(name, vals.map((it) => new UriMultiSelectOption(it[0], it[1])));
  }
  addToUri(builder: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state);

    if (checked.length === 0) builder.addQueryParameter(this.param, "-1");
    else checked.forEach((it) => builder.addQueryParameter(this.param, it.value));
  }
}

export class GenreFilter extends UriMultiSelectFilter {
  constructor() {
    super("Genre", "genres", [
      ["Action", "1"],
      ["Fantasy", "2"],
      ["Regression", "3"],
      ["Overpowered", "4"],
      ["Ascension", "5"],
      ["Revenge", "6"],
      ["Martial Arts", "7"],
      ["Magic", "8"],
      ["Necromancer", "9"],
      ["Adventure", "10"],
      ["Tower", "11"],
      ["Dungeons", "12"],
      ["Psychological", "13"],
      ["Isekai", "14"],
    ]);
  }
}

export class SortFilter extends UriPartFilter {
  constructor(defaultSort: string | null = null) {
    super(
      "Sort By",
      "sort",
      [
        ["Popularity", "popular"],
        ["Name", "name"],
        ["Chapters", "chapters"],
        ["Rating", "Rating"],
        ["New", "new"],
      ],
      defaultSort,
    );
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", "status", [
      ["Any", "-1"],
      ["Ongoing", "1"],
      ["Coming Soon", "5"],
      ["Completed", "6"],
    ]);
  }
}
