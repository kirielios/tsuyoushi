// Port of keiyoushi/extensions-source lib-multisrc/loneseal/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../sdk/index.ts";

export interface UriQueryFilter {
  addToQuery(builder: HttpUrlBuilder): void;
}
export const isUriQueryFilter = (f: Filter): f is Filter & UriQueryFilter => typeof (f as Partial<UriQueryFilter>).addToQuery === "function";

type Vals = [string, string | null][];

export class SelectFilter extends Filter.Select<string> implements UriQueryFilter {
  constructor(
    displayName: string,
    private readonly field: string,
    private readonly vals: Vals,
    defaultState = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      defaultState,
    );
  }
  selectedValue(): string | null {
    return this.vals[this.state][1];
  }
  addToQuery(builder: HttpUrlBuilder) {
    const v = this.selectedValue();
    if (v != null) builder.addQueryParameter(this.field, v);
  }
}

export class SortFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Sort", "sort", vals, 2);
  }
}
export class OrderFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Order", "order", vals);
  }
}
export class StatusFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Status", "status", vals);
  }
}
export class GenreFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Genre", "genre", vals);
  }
}
export class TypeFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Type", "comic_type", vals);
  }
}
export class ColorFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Color", "color_format", vals);
  }
}
export class ReadingFilter extends SelectFilter {
  constructor(vals: Vals) {
    super("Reading", "reading_format", vals);
  }
}

export class TextFilter extends Filter.Text implements UriQueryFilter {
  constructor(
    name: string,
    private readonly queryKey: string,
  ) {
    super(name);
  }
  addToQuery(builder: HttpUrlBuilder) {
    if (this.state.trim()) builder.addQueryParameter(this.queryKey, this.state);
  }
}

export class CheckBoxFilter extends Filter.CheckBox implements UriQueryFilter {
  constructor(
    name: string,
    private readonly queryKey: string,
    private readonly checkedValue = "1",
  ) {
    super(name);
  }
  addToQuery(builder: HttpUrlBuilder) {
    if (this.state) builder.addQueryParameter(this.queryKey, this.checkedValue);
  }
}

export const sortOptions: Vals = [
  ["Latest", "latest"],
  ["New", "new"],
  ["Top Views", "views"],
  ["Top Rate", "rate"],
  ["Top Bookmark", "bookmark"],
  ["Title A-Z", "az"],
  ["Title Z-A", "za"],
];

export const orderOptions: Vals = [
  ["Descending", "desc"],
  ["Ascending", "asc"],
];

export const statusOptions: Vals = [
  ["All", null],
  ["Ongoing", "ONGOING"],
  ["Completed", "COMPLETED"],
  ["Hiatus", "HIATUS"],
];

export const typeOptions: Vals = [
  ["All", null],
  ["Manga", "MANGA"],
  ["Manhwa", "MANHWA"],
  ["Manhua", "MANHUA"],
];

export const colorOptions: Vals = [
  ["All", null],
  ["Full Color", "FULL_COLOR"],
  ["B&W", "BW"],
];

export const readingOptions: Vals = [
  ["All", null],
  ["Vertical Scroll", "VERTICAL_SCROLL"],
  ["Page", "PAGE"],
];

export const seriesTagOptions: Vals = [
  ["All", null],
  ["ST8", "ST8"],
  ["BL", "BL"],
];

const fallbackGenres: [string, string][] = [
  ["Action", "action"],
  ["Adult", "adult"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Gender Bender", "gender-bender"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Martial Arts", "martial-arts"],
  ["Mature", "mature"],
  ["Mystery", "mystery"],
  ["Psychological", "psychological"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Slice Of Life", "slice-of-life"],
  ["Smut", "smut"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Thriller", "thriller"],
  ["Tragedy", "tragedy"],
];

export function genreOptions(data: unknown, overloadedGenres: Set<string>): Vals {
  const fetched = (data as { name: string; slug: string }[] | null)?.map((it): [string, string] => [it.name, it.slug]);
  const genres = fetched?.length ? fetched : fallbackGenres;
  return [["All", null], ...genres.filter((it) => !(it[1] === "" || overloadedGenres.has(it[1])))];
}
