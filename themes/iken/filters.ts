// Port of keiyoushi/extensions-source lib-multisrc/iken/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../sdk/index.ts";

export type Options = [string, string][];

export interface UrlPartFilter {
  addUrlParameter(url: HttpUrlBuilder): void;
}
export const isUrlPartFilter = (f: unknown): f is UrlPartFilter => typeof (f as UrlPartFilter)?.addUrlParameter === "function";

export abstract class SelectFilter extends Filter.Select<string> implements UrlPartFilter {
  constructor(
    name: string,
    private readonly urlParameter: string,
    private readonly options: Options,
    defaultValue: string | null = null,
  ) {
    const i = options.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      options.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  addUrlParameter(url: HttpUrlBuilder) {
    url.addQueryParameter(this.urlParameter, this.options[this.state][1]);
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export abstract class CheckBoxGroup extends Filter.Group<CheckBoxFilter> implements UrlPartFilter {
  constructor(
    name: string,
    private readonly urlParameter: string,
    options: Options,
  ) {
    super(
      name,
      options.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  addUrlParameter(url: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state).map((it) => it.value);
    if (checked.length) url.addQueryParameter(this.urlParameter, checked.join(","));
  }
}

export class StatusFilter extends SelectFilter {}
export class TypeFilter extends SelectFilter {}
export class SortFilter extends SelectFilter {}
export class GenreFilter extends CheckBoxGroup {}
