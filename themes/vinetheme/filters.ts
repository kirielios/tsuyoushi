// Port of keiyoushi/extensions-source lib-multisrc/vinetheme/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../sdk/index.ts";

export interface UriQueryFilter {
  addToQuery(builder: HttpUrlBuilder): void;
}
export const isUriQueryFilter = (f: Filter): f is Filter & UriQueryFilter => typeof (f as Partial<UriQueryFilter>).addToQuery === "function";

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
      i === -1 ? 0 : i,
    );
  }
  addToQuery(builder: HttpUrlBuilder) {
    const selected = this.vals[this.state][1];
    if (selected) builder.addQueryParameter(this.field, selected);
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super(
      "Sort",
      "sort",
      [
        ["Latest", "updated"],
        ["Popular", "popular"],
        ["Trending", "trending"],
        ["Views", "views"],
        ["Rating", "rating"],
        ["Longest", "longest"],
        ["Newest", "newest"],
      ],
      "updated",
    );
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", "status", [
      ["All", ""],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
      ["Hiatus", "Hiatus"],
      ["Dropped", "Dropped"],
      ["Discontinued", "Discontinued"],
      ["Upcoming", "Upcoming"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", "type", [
      ["All", ""],
      ["Manhwa", "MANHWA"],
      ["Manhua", "MANHUA"],
      ["Manga", "MANGA"],
    ]);
  }
}

export class OriginFilter extends UriPartFilter {
  constructor() {
    super("Origin", "origin", [
      ["All", ""],
      ["Korean", "KOREAN"],
      ["Japanese", "JAPANESE"],
      ["Chinese", "CHINESE"],
      ["Other", "OTHER"],
    ]);
  }
}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<GenreCheckBox> implements UriQueryFilter {
  constructor(genres: [string, string][]) {
    super(
      "Genre",
      genres.map((it) => new GenreCheckBox(it[0], it[1])),
    );
  }
  addToQuery(builder: HttpUrlBuilder) {
    const selected = this.state.filter((it) => it.state).map((it) => it.value);
    if (selected.length) builder.addQueryParameter("genre", selected.join(","));
  }
}
