// Port of keiyoushi/extensions-source src/en/duskscans/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Sort by", ["Latest Update", "New Releases", "Most Popular", "Top Rated", "A-Z"]);
  }
}

export class CheckBoxItem extends Filter.CheckBox {}

export class CheckBoxGroup extends Filter.Group<CheckBoxItem> {
  constructor(name: string, options: string[]) {
    super(name, options.map((it) => new CheckBoxItem(it)));
  }
  get checked(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.name);
  }
}

export class StatusFilter extends CheckBoxGroup {
  constructor(options: string[]) {
    super("Status", options);
  }
}

export class TypeFilter extends CheckBoxGroup {
  constructor(options: string[]) {
    super("Type", options);
  }
}

export class TriStateItem extends Filter.TriState {}

export class GenreFilter extends Filter.Group<TriStateItem> {
  constructor(genres: string[]) {
    super("Genre", genres.map((it) => new TriStateItem(it)));
  }
  get included(): string[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.name);
  }
  get excluded(): string[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.name);
  }
}
