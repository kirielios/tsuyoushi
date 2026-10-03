// Port of keiyoushi/extensions-source src/en/kappabeast/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genre", [
      ["All", ""],
      ["Fantasy", "Fantasy"],
      ["Romance", "Romance"],
      ["Comedy", "Comedy"],
      ["Drama", "Drama"],
      ["Thriller", "Thriller"],
      ["Action", "Action"],
      ["Psychological", "Psychological"],
      ["Isekai", "Isekai"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
      ["Hiatus", "Hiatus"],
    ]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "Manga"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
    ]);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Popularity", ""],
      ["Latest Updates", "updatedAt:desc"],
      ["Newest", "createdAt:desc"],
      ["A-Z Name", "title:asc"],
    ]);
  }
}
