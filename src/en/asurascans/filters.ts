// Port of keiyoushi/extensions-source src/en/asurascans/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";
import type { GenreDto } from "./dto.ts";

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
export const isUriFilter = (f: unknown): f is Filter & UriFilter => typeof (f as UriFilter)?.addToUri === "function";

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: [string, string][],
    defaultValue: string | null = null,
  ) {
    const i = vals.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      vals.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const value = this.vals[this.state][1];
    if (value.trim()) builder.addQueryParameter(this.param, value);
  }
}

export class UriSortFilter extends Filter.Sort implements UriFilter {
  constructor(
    name: string,
    private readonly sortParam: string,
    private readonly orderParam: string,
    private readonly vals: [string, string][],
    defaultValue: string | null,
    private readonly ascendingValue: string,
    private readonly descendingValue: string,
  ) {
    const i = vals.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      vals.map((it) => it[0]),
      { index: i !== -1 ? i : 0, ascending: false },
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const state = this.state;
    if (!state) return;
    const selected = this.vals[state.index][1];
    const order = state.ascending ? this.ascendingValue : this.descendingValue;
    builder.addQueryParameter(this.sortParam, selected);
    builder.addQueryParameter(this.orderParam, order);
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
    super(
      name,
      vals.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state).map((it) => it.value);
    if (checked.length) builder.addQueryParameter(this.param, checked.join(","));
  }
}

export class SortFilter extends UriSortFilter {
  constructor(defaultSort: string | null = null) {
    super(
      "Sort By",
      "sort",
      "order",
      [
        ["Latest Update", "latest"],
        ["Popular", "popular"],
        ["Rating", "rating"],
        ["A-Z", "title"],
        ["Newest", "update"],
      ],
      defaultSort,
      "asc",
      "desc",
    );
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", "status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Dropped", "dropped"],
      ["Axed", "axed"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", "type", [
      ["All", ""],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Mangatoon", "manga"],
    ]);
  }
}

export class GenresFilter extends UriMultiSelectFilter {
  constructor(genres: GenreDto[]) {
    super(
      "Genres",
      "genres",
      genres.map((it) => [it.name, it.slug]),
    );
  }
}

export class CreatorFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    private readonly authors: string[],
    private readonly artists: string[],
  ) {
    // upstream lists the artists twice (listOf("") + artists + artists); kept as is
    super("Creators", ["", ...artists, ...artists]);
  }
  addToUri(builder: HttpUrlBuilder) {
    const state = this.state;
    let parm: string | null = null;
    let selected: string | null = null;
    if (state === 0) {
      /* none */
    } else if (state >= 1 && state <= this.artists.length) {
      parm = "artist";
      selected = this.artists[state - 1];
    } else {
      parm = "author";
      selected = this.authors[state - 1 - this.artists.length];
    }
    if (parm != null) builder.addQueryParameter(parm, selected);
  }
}

export class MinChaptersFilter extends Filter.Text implements UriFilter {
  constructor() {
    super("Min Chapters");
  }
  addToUri(builder: HttpUrlBuilder) {
    if (this.state.trim()) builder.addQueryParameter("min_chapters", this.state);
  }
}
