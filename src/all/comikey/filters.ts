// Port of keiyoushi/extensions-source src/all/comikey/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";
import type { HttpUrlBuilder } from "../../../sdk/httpurl.ts";

export function getComikeyFilters(intl: Intl): FilterList {
  return FilterList(new Filter.Header(intl.get("search_use_two_characters")), new Filter.Separator(), new SortFilter(intl.get("sort_by"), getSortOptions(intl)), new TypeFilter(intl.get("filter_by"), getTypeOptions(intl)));
}

export const getSortOptions = (intl: Intl) => [intl.get("sort_last_updated"), intl.get("sort_name"), intl.get("sort_popularity"), intl.get("sort_chapter_count")];

export const getTypeOptions = (intl: Intl) => [intl.get("all"), intl.get("manga"), intl.get("webtoon"), intl.get("new"), intl.get("complete"), intl.get("exclusive"), intl.get("simulpub")];

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}

export const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as Partial<UriFilter>).addToUri === "function";

export class SortFilter extends Filter.Sort implements UriFilter {
  constructor(name: string, values: string[]) {
    super(name, values, { index: 2, ascending: false });
  }
  addToUri(builder: HttpUrlBuilder): void {
    const state = this.state;
    if (!state) return;
    let value = "";
    if (!state.ascending) value += "-";

    switch (state.index) {
      case 0:
        value += "updated";
        break;
      case 1:
        value += "name";
        break;
      case 2:
        value += "views";
        break;
      case 3:
        value += "chapters";
        break;
    }

    builder.addQueryParameter("order", value);
  }
}

export class TypeFilter extends Filter.Select<string> implements UriFilter {
  addToUri(builder: HttpUrlBuilder): void {
    if (this.state === 0) return;

    builder.addQueryParameter("filter", this.values[this.state].toLowerCase());
  }
}
