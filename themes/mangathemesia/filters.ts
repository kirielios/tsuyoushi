// The filter classes nested in keiyoushi/extensions-source lib-multisrc/mangathemesia/MangaThemesia.kt
import { Filter } from "../../sdk/index.ts";

export class AuthorFilter extends Filter.Text {}
export class YearFilter extends Filter.Text {}

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    defaultValue: string | null = null,
  ) {
    const i = vals.findIndex((it) => it[1] === defaultValue);
    super(
      displayName,
      vals.map((it) => it[0]),
      i === -1 ? 0 : i,
    );
  }
  selectedValue() {
    return this.vals[this.state][1];
  }
}

export class StatusFilter extends SelectFilter {}
export class TypeFilter extends SelectFilter {}
export class OrderByFilter extends SelectFilter {}
export class ProjectFilter extends SelectFilter {}

export interface GenreData {
  name: string;
  value: string;
  state?: number;
}

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
    state: number,
  ) {
    super(name, state);
  }
}

export class GenreListFilter extends Filter.Group<Genre> {}
