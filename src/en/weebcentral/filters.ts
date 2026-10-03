// Port of keiyoushi/extensions-source src/en/weebcentral/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
export const isUriFilter = <T>(f: T): f is T & UriFilter => typeof (f as UriFilter).addToUri === "function";

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: [string, string][],
    defaultValue = "",
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
    options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    this.state.filter((it) => it.state).forEach((it) => builder.addQueryParameter(this.param, it.value));
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
    private readonly includeUrlParameter: string,
    private readonly excludeUrlParameter: string,
    options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => new UriMultiTriSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    this.state.forEach((it) => {
      if (it.isIncluded()) builder.addQueryParameter(this.includeUrlParameter, it.value);
      if (it.isExcluded()) builder.addQueryParameter(this.excludeUrlParameter, it.value);
    });
  }
}

const pairs = (...v: string[]): [string, string][] => v.map((it) => [it, it]);

export class SortFilter extends UriPartFilter {
  constructor(defaultValue = "") {
    super("Sort", "sort", pairs("Best Match", "Alphabet", "Popularity", "Subscribers", "Recently Added", "Latest Updates"), defaultValue);
  }
}

export class SortOrderFilter extends UriPartFilter {
  constructor() {
    super("Sort Order", "order", pairs("Descending", "Ascending"));
  }
}

export class OfficialTranslationFilter extends UriPartFilter {
  constructor() {
    super("Official Translation", "official", pairs("Any", "True", "False"));
  }
}

export class AnimeAdaptationFilter extends UriPartFilter {
  constructor() {
    super("Anime Adaptation", "anime", pairs("Any", "True", "False"));
  }
}

export class AdultContentFilter extends UriPartFilter {
  constructor() {
    super("Adult Content", "adult", pairs("Any", "True", "False"));
  }
}

export class AuthorFilter extends Filter.Text implements UriFilter {
  constructor() {
    super("Author (Case-sensitive)");
  }
  addToUri(builder: HttpUrlBuilder) {
    if (this.state.length > 0) builder.addQueryParameter("author", this.state);
  }
}

export class StatusFilter extends UriMultiSelectFilter {
  constructor() {
    super("Series Status", "included_status", pairs("Ongoing", "Complete", "Hiatus", "Canceled"));
  }
}

export class TypeFilter extends UriMultiSelectFilter {
  constructor() {
    super("Series Type", "included_type", pairs("Manga", "Manhwa", "Manhua", "OEL"));
  }
}

export class TagFilter extends UriMultiTriSelectFilter {
  constructor() {
    super("Tags", "included_tag", "excluded_tag", [
    ["Action", "Action"],
    ["Adult", "Adult"],
    ["Adventure", "Adventure"],
    ["Comedy", "Comedy"],
    ["Doujinshi", "Doujinshi"],
    ["Drama", "Drama"],
    ["Ecchi", "Ecchi"],
    ["Fantasy", "Fantasy"],
    ["Gender Bender", "Gender Bender"],
    ["Harem", "Harem"],
    ["Hentai", "Hentai"],
    ["Historical", "Historical"],
    ["Horror", "Horror"],
    ["Isekai", "Isekai"],
    ["Josei", "Josei"],
    ["Lolicon", "Lolicon"],
    ["Martial Arts", "Martial Arts"],
    ["Mature", "Mature"],
    ["Mecha", "Mecha"],
    ["Mystery", "Mystery"],
    ["Psychological", "Psychological"],
    ["Romance", "Romance"],
    ["School Life", "School Life"],
    ["Sci-fi", "Sci-fi"],
    ["Seinen", "Seinen"],
    ["Shotacon", "Shotacon"],
    ["Shoujo", "Shoujo"],
    ["Shoujo Ai", "Shoujo Ai"],
    ["Shounen", "Shounen"],
    ["Shounen Ai", "Shounen Ai"],
    ["Slice of Life", "Slice of Life"],
    ["Smut", "Smut"],
    ["Sports", "Sports"],
    ["Supernatural", "Supernatural"],
    ["Tragedy", "Tragedy"],
    ["Yaoi", "Yaoi"],
    ["Yuri", "Yuri"],
    ["Other", "Other"],
    ]);
  }
}
