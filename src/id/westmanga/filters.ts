// Port of keiyoushi/extensions-source src/id/westmanga/Filters.kt
import { Filter, FilterList, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UrlFilter {
  addToUrl(url: HttpUrlBuilder): void;
}

export const isUrlFilter = (it: Filter): it is Filter & UrlFilter => typeof (it as Partial<UrlFilter>).addToUrl === "function";

abstract class SelectFilter extends Filter.Select<string> implements UrlFilter {
  constructor(
    name: string,
    private readonly options: [string, string][],
    private readonly queryParameterName: string,
    defaultValue: string | null = null,
  ) {
    const i = options.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      options.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  private get selected() {
    return this.options[this.state][1];
  }
  addToUrl(url: HttpUrlBuilder) {
    url.addQueryParameter(this.queryParameterName, this.selected);
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

abstract class CheckBoxGroup extends Filter.Group<CheckBoxFilter> implements UrlFilter {
  constructor(
    name: string,
    options: [string, string][],
    private readonly queryParameterName: string,
  ) {
    super(
      name,
      options.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  private get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
  addToUrl(url: HttpUrlBuilder) {
    this.checked.forEach((it) => {
      if (it.trim()) url.addQueryParameter(this.queryParameterName, it);
    });
  }
}

export class SortFilter extends SelectFilter {
  constructor(defaultValue: string | null = null) {
    super(
      "Order",
      [
        ["Default", "Default"],
        ["A-Z", "Az"],
        ["Z-A", "Za"],
        ["Updated", "Update"],
        ["Added", "Added"],
        ["Popular", "Popular"],
      ],
      "orderBy",
      defaultValue,
    );
  }
  static get popular() {
    return FilterList(new SortFilter("Popular"));
  }
  static get latest() {
    return FilterList(new SortFilter("Update"));
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super(
      "Status",
      [
        ["All", "All"],
        ["Ongoing", "Ongoing"],
        ["Completed", "Completed"],
        ["Hiatus", "Hiatus"],
      ],
      "status",
    );
  }
}

export class CountryFilter extends SelectFilter {
  constructor() {
    super(
      "Country / Type",
      [
        ["All", "All"],
        ["Japan / Manga", "JP"],
        ["China / Manhua", "CN"],
        ["Korea / Manhwa", "KR"],
      ],
      "country",
    );
  }
}

export class ColorFilter extends SelectFilter {
  constructor() {
    super(
      "Color",
      [
        ["All", "All"],
        ["Colored", "Colored"],
        ["Uncolored", "Uncolored"],
      ],
      "color",
    );
  }
}

export class GenreFilter extends CheckBoxGroup {
  constructor(options: [string, string][]) {
    super("Genre", options, "genre[]");
  }
}
