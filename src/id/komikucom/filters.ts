// Port of keiyoushi/extensions-source src/id/komikucom/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UriQueryFilter {
  addToQuery(builder: HttpUrlBuilder): void;
}

export const isUriQueryFilter = (it: Filter): it is Filter & UriQueryFilter => typeof (it as Partial<UriQueryFilter>).addToQuery === "function";

export class UriPartFilter extends Filter.Select<string> implements UriQueryFilter {
  constructor(
    name: string,
    private readonly field: string,
    private readonly vals: [string, string][],
    defaultValue = "",
  ) {
    const i = vals.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      vals.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  addToQuery(builder: HttpUrlBuilder) {
    if (!this.vals.length) return;
    const selected = this.vals[this.state][1];
    if (selected) builder.addQueryParameter(this.field, selected);
  }
}

export class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> implements UriQueryFilter {
  constructor(
    name: string,
    private readonly field: string,
    options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToQuery(builder: HttpUrlBuilder) {
    this.state.filter((it) => it.state).forEach((it) => builder.addQueryParameter(this.field, it.value));
  }
}

export class SortFilter extends UriPartFilter {
  constructor(sorts: [string, string][]) {
    super("Sort", "sort", sorts, "update");
  }
}

export class GenreFilter extends UriMultiSelectFilter {
  constructor(genres: [string, string][]) {
    super("Genre", "genres", genres);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor(statuses: [string, string][]) {
    super("Status", "status", statuses);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor(types: [string, string][]) {
    super("Type", "type", types);
  }
}
