// Port of keiyoushi/extensions-source lib-multisrc/zeistmanga/ZeistMangaFilters.kt
import { Filter } from "../../sdk/index.ts";

export class Genre extends Filter.CheckBox {
  constructor(
    title: string,
    readonly value: string,
  ) {
    super(title);
  }
}

export class GenreList extends Filter.Group<Genre> {}

export class EnhancedSelect<T> extends Filter.Select<T> {
  get selected(): T {
    return this.values[this.state];
  }
}

export class TypeList extends EnhancedSelect<Type> {}
export class LanguageList extends EnhancedSelect<Language> {}
export class StatusList extends EnhancedSelect<Status> {}

class NameValue {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {}
  toString(): string {
    return this.name;
  }
}
export class Status extends NameValue {}
export class Type extends NameValue {}
export class Language extends NameValue {}
