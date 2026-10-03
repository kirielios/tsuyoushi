// Port of keiyoushi/extensions-source src/en/mangack/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export class TaxonomyOption {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {}
}

export interface UriFilter {
  applyTo(builder: HttpUrlBuilder): void;
}
/** filters.filterIsInstance<UriFilter>() */
export const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as unknown as UriFilter).applyTo === "function";

export class UriSelectFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly paramName: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  applyTo(builder: HttpUrlBuilder) {
    const value = this.options[this.state][1];
    if (value.length > 0) builder.addQueryParameter(this.paramName, value);
  }
}

export class TypeFilter extends UriSelectFilter {
  constructor() {
    super("Type", "comic-type", [
      ["Any", ""],
      ["Manga", "30"],
      ["Manhua", "31"],
      ["Manhwa", "32"],
      ["OEL", "1305"],
    ]);
  }
}

export class StatusFilter extends UriSelectFilter {
  constructor() {
    super("Status", "manga-status", [
      ["Any", ""],
      ["Ongoing", "34"],
      ["Completed", "35"],
      ["Hiatus", "347"],
      ["Updating", "839"],
    ]);
  }
}

export class SortFilter extends Filter.Sort implements UriFilter {
  constructor() {
    super("Sort by", ["Date posted", "Date updated", "Title", "Slug"], { index: 0, ascending: false });
  }
  applyTo(builder: HttpUrlBuilder) {
    let orderBy: string;
    switch (this.state?.index) {
      case 1:
        orderBy = "modified";
        break;
      case 2:
        orderBy = "title";
        break;
      case 3:
        orderBy = "slug";
        break;
      default:
        orderBy = "date";
    }
    const direction = this.state?.ascending === true ? "asc" : "desc";
    builder.addQueryParameter("orderby", orderBy);
    builder.addQueryParameter("order", direction);
  }
}

export class YearFilter extends Filter.Select<string> implements UriFilter {
  private readonly ids: number[];
  constructor(years: TaxonomyOption[]) {
    super("Year", ["Any", ...years.map((it) => it.name)]);
    this.ids = [-1, ...years.map((it) => it.id)];
  }
  applyTo(builder: HttpUrlBuilder) {
    const id = this.ids[this.state];
    if (id > 0) builder.addQueryParameter("realised", String(id));
  }
}

export class GenreEntry extends Filter.TriState {
  constructor(readonly term: TaxonomyOption) {
    super(term.name, Filter.TriState.STATE_IGNORE);
  }
}

export class GenreFilterGroup extends Filter.Group<GenreEntry> implements UriFilter {
  constructor(genres: TaxonomyOption[]) {
    super(
      "Genres",
      genres.map((g) => new GenreEntry(g)),
    );
  }
  applyTo(builder: HttpUrlBuilder) {
    const includes = this.state.filter((it) => it.state === Filter.TriState.STATE_INCLUDE);
    const excludes = this.state.filter((it) => it.state === Filter.TriState.STATE_EXCLUDE);
    if (includes.length > 0) builder.addQueryParameter("Genres", includes.map((it) => String(it.term.id)).join(","));
    if (excludes.length > 0) builder.addQueryParameter("Genres_exclude", excludes.map((it) => String(it.term.id)).join(","));
  }
}
