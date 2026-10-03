// Port of keiyoushi/extensions-source lib-multisrc/mangadventure/MangAdventureFilters.kt
import { Filter } from "../../sdk/index.ts";

export interface UriFilter {
  readonly param: string;
  toString(): string;
}
export const isUriFilter = (it: Filter): it is Filter & UriFilter => typeof (it as Partial<UriFilter>).param === "string";

/** Filter representing the name of an author. */
export class Author extends Filter.Text implements UriFilter {
  readonly param = "author";
  constructor() {
    super("Author");
  }
  override toString() {
    return this.state;
  }
}

/** Filter representing the name of an artist. */
export class Artist extends Filter.Text implements UriFilter {
  readonly param = "artist";
  constructor() {
    super("Artist");
  }
  override toString() {
    return this.state;
  }
}

/** The available sort order values. */
const sorts = ["title", "views", "latest_upload", "chapter_count"];

/** Filter representing the sort order. */
export class SortOrder extends Filter.Sort implements UriFilter {
  readonly param = "sort";
  constructor(labels: string[]) {
    super("Sort", labels, null);
  }
  override toString() {
    if (this.state == null) return "";
    return this.state.ascending ? sorts[this.state.index] : "-" + sorts[this.state.index];
  }
}

/** Filter representing the status of a manga. */
export class Status extends Filter.Select<string> implements UriFilter {
  readonly param = "status";
  constructor(statuses: string[]) {
    super("Status", statuses);
  }
  override toString() {
    return this.values[this.state];
  }
}

/** Filter representing a manga category. */
export class Category extends Filter.TriState {}

/** Filter representing the categories of a manga. */
export class CategoryList extends Filter.Group<Category> implements UriFilter {
  readonly param = "categories";
  constructor(categories: string[]) {
    super(
      "Categories",
      categories.map((it) => new Category(it)),
    );
  }
  override toString() {
    return this.state
      .filter((it) => !it.isIgnored())
      .map((it) => (it.isIncluded() ? it.name : "-" + it.name))
      .join(",");
  }
}
