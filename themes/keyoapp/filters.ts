// Port of keiyoushi/extensions-source lib-multisrc/keyoapp/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../sdk/index.ts";

export class Selection extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export abstract class MultiSelectFilter extends Filter.Group<Selection> {
  constructor(
    name: string,
    private readonly param: string,
    vals: Record<string, string>,
  ) {
    super(
      name,
      Object.entries(vals).map(([k, v]) => new Selection(k, v)),
    );
  }

  addToUri(builder: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state);
    checked.forEach((it) => builder.addQueryParameter(this.param, it.value));
  }
}

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name);
  }
}

export class GenreFilter extends MultiSelectFilter {
  constructor(genres: Record<string, string>) {
    super("Genres", "genre", genres);
  }
}

export class TypeFilter extends MultiSelectFilter {
  constructor(types: Record<string, string>) {
    super("Type", "type", types);
  }
}

export class StatusFilter extends MultiSelectFilter {
  constructor(statuses: Record<string, string>) {
    super("Status", "status", statuses);
  }
}
