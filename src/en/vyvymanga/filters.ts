// Port of keiyoushi/extensions-source src/en/vyvymanga/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly options: [string, string][],
  ) {
    super(displayName, options.map((it) => it[0]));
  }
  get selected(): string | null {
    const v = this.options[this.state][1];
    return v === "" ? null : v;
  }
}

export class SearchType extends SelectFilter {
  constructor() {
    super("Title should contain/begin/end with typed text", [
      ["Contain", "0"],
      ["Begin", "1"],
      ["End", "2"],
    ]);
  }
}

export class SearchDescription extends Filter.CheckBox {
  constructor() {
    super("Search In Description");
  }
}

export class AuthorSearchType extends SelectFilter {
  constructor() {
    super("Author should contain/begin/end with typed text", [
      ["Contain", "0"],
      ["Begin", "1"],
      ["End", "2"],
    ]);
  }
}

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", "2"],
      ["Ongoing", "0"],
      ["Completed", "1"],
    ]);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", [
      ["Viewed", "viewed"],
      ["Scored", "scored"],
      ["Newest", "created_at"],
      ["Latest Update", "updated_at"],
    ]);
  }
}

export class SortType extends SelectFilter {
  constructor() {
    super("Sort order", [
      ["Descending", "desc"],
      ["Ascending", "asc"],
    ]);
  }
}

export interface GenreData {
  name: string;
  id: string;
}

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", genres);
  }
}
