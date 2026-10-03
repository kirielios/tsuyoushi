// Port of keiyoushi/extensions-source lib-multisrc/zmanga/Filters.kt
import { Filter } from "../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class ProjectFilter extends UriPartFilter {
  constructor() {
    super("Filter Project", [
      ["Show all manga", ""],
      ["Show only project manga", "project-filter-on"],
    ]);
  }
}

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year");
  }
}

export class StatusFilter extends Filter.TriState {
  constructor() {
    super("Completed");
  }
}

export class TypeFilter extends UriPartFilter {
  constructor(vals: [string, string][]) {
    super("Type", vals);
  }
}

export class OrderByFilter extends UriPartFilter {
  constructor() {
    super("Order By", [
      ["<select>", ""],
      ["A-Z", "title"],
      ["Z-A", "titlereverse"],
      ["Latest Update", "update"],
      ["Latest Added", "latest"],
      ["Popular", "popular"],
      ["Rating", "rating"],
    ]);
  }
}

export class Tag extends Filter.CheckBox {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(name);
  }
}

export class GenreList extends Filter.Group<Tag> {
  constructor(genres: Tag[]) {
    super("Genres", genres);
  }
}
