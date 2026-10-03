// Port of keiyoushi/extensions-source src/id/shinigami/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
export const isUriFilter = (it: Filter): it is Filter & UriFilter => typeof (it as Partial<UriFilter>).addToUri === "function";

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
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
  addToUri(builder: HttpUrlBuilder) {
    const selected = this.vals[this.state][1];
    if (selected.length > 0) builder.addQueryParameter(this.param, selected);
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
    options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const selected = this.state.filter((it) => it.state).map((it) => it.value);
    if (selected.length) builder.addQueryParameter(this.param, selected.join(","));
  }
}

export class UriMultiTriSelectOption extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class UriMultiTriSelectFilter extends Filter.Group<UriMultiTriSelectOption> implements UriFilter {
  constructor(
    name: string,
    private readonly includeParam: string,
    private readonly excludeParam: string,
    options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => new UriMultiTriSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const included = this.state.filter((it) => it.isIncluded()).map((it) => it.value);
    const excluded = this.state.filter((it) => it.isExcluded()).map((it) => it.value);

    if (included.length) {
      builder.addQueryParameter(this.includeParam, included.join(","));
      builder.addQueryParameter("genre_include_mode", "and");
    }
    if (excluded.length) {
      builder.addQueryParameter(this.excludeParam, excluded.join(","));
      builder.addQueryParameter("genre_exclude_mode", "and");
    }
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort", "sort", [
      ["Default", ""],
      ["Latest", "latest"],
      ["Popularity", "popularity"],
      ["Rating", "rating"],
    ]);
  }
}

export class SortOrderFilter extends UriPartFilter {
  constructor() {
    super("Sort Order", "sort_order", [
      ["Descending", "desc"],
      ["Ascending", "asc"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", "status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
    ]);
  }
}

export class FormatFilter extends UriMultiSelectFilter {
  constructor() {
    super("Format", "format", [
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
    ]);
  }
}

export class TypeFilter extends UriMultiSelectFilter {
  constructor() {
    super("Type", "type", [
      ["Project", "project"],
      ["Mirror", "mirror"],
    ]);
  }
}

export class GenreFilter extends UriMultiTriSelectFilter {
  constructor() {
    super("Genre", "genre_include", "genre_exclude", GENRES);
  }
}

const GENRES: [string, string][] = [
  ["Action", "action"],
  ["Adaptation", "adaptation"],
  ["Adult", "adult"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Cooking", "cooking"],
  ["Crime", "crime"],
  ["Demon", "demon"],
  ["Demons", "demons"],
  ["Dra", "dra-genre"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Fight", "fight"],
  ["Game", "game"],
  ["Gender Bender", "gender-bender"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei-genre"],
  ["Latest", "latest"],
  ["Love", "love"],
  ["Magic", "magic"],
  ["Martial Arts", "martial-arts"],
  ["Mature", "mature"],
  ["Mecha", "mecha"],
  ["Medical", "medical"],
  ["Murim", "murim"],
  ["Mystery", "mystery"],
  ["Philosophical", "philosophical"],
  ["Psychological", "psychological"],
  ["Regression", "regression"],
  ["Revenge", "revenge"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci-fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shounen", "shounen"],
  ["Slice of Life", "slice-of-life"],
  ["Smut", "smut"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Supranatural", "supranatural"],
  ["Thriller", "thriller"],
  ["Tragedy", "tragedy"],
  ["Violence", "violence"],
  ["Wuxia", "wuxia"],
];
