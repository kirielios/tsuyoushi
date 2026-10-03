// Port of keiyoushi/extensions-source src/id/voratoon/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

/** StringBuilder -> a string[] holder, so filters can append to it */
export interface UriFilter {
  addToFilter(builder: string[]): void;
}

export interface UriQueryFilter {
  addToQuery(builder: HttpUrlBuilder): void;
}

export const isUriFilter = (it: Filter): it is Filter & UriFilter => typeof (it as Partial<UriFilter>).addToFilter === "function";
export const isUriQueryFilter = (it: Filter): it is Filter & UriQueryFilter => typeof (it as Partial<UriQueryFilter>).addToQuery === "function";

export class UriPartFilter extends Filter.Select<string> implements UriQueryFilter {
  constructor(
    name: string,
    private readonly field: string,
    private readonly vals: [string, string][],
    defaultValue = "",
  ) {
    const i = vals.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      vals.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  addToQuery(builder: HttpUrlBuilder) {
    const selected = this.vals[this.state][1];
    if (selected) builder.addQueryParameter(this.field, selected);
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
    private readonly field: string,
    options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToFilter(builder: string[]) {
    this.state.filter((it) => it.state).forEach((it) => appendFilter(builder, `${this.field}==${it.value}`));
  }
}

function appendFilter(builder: string[], filter: string) {
  if (builder.length) builder.push(";");
  builder.push(filter);
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort", "sort", [
      ["Popular", "popularity"],
      ["Terbaru", "latest"],
      ["Rating", "rating"],
      ["A-Z", "title"],
    ]);
  }
}

export class SortOrderFilter extends UriPartFilter {
  constructor() {
    super(
      "Sort Order",
      "sortOrder",
      [
        ["Desc", "desc"],
        ["Asc", "asc"],
      ],
      "desc",
    );
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", "status", [
      ["Any", ""],
      ["On Going", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Cancelled", "cancelled"],
    ]);
  }
}

export class FormatFilter extends UriPartFilter {
  constructor() {
    super("Format", "format", [
      ["Any", ""],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Webtoon", "webtoon"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", "type", [
      ["Any", ""],
      ["Project", "project"],
      ["Mirror", "mirror"],
    ]);
  }
}

export class GenreFilter extends UriMultiSelectFilter {
  constructor(genres: [string, string][]) {
    super("Genre", "genreIds", genres);
  }
}
