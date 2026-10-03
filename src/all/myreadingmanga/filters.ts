// Port of keiyoushi/extensions-source src/all/myreadingmanga/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

/** Represents a filter that is able to modify a URI. */
export interface UriFilter {
  addToUri(uri: HttpUrlBuilder): void;
}
export const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as Partial<UriFilter>).addToUri === "function";

export class EnforceLanguageFilter extends Filter.CheckBox implements UriFilter {
  constructor(readonly siteLang: string) {
    super("Enforce language", true);
  }
  addToUri(uri: HttpUrlBuilder): void {
    if (this.state) uri.addQueryParameter("ep_filter_lang", this.siteLang);
  }
}

/**
 * Class that creates a select filter. Each entry in the dropdown has a name and a display name.
 * If an entry is selected it is appended as a query parameter onto the end of the URI.
 * If `firstIsUnspecified` is set to true, if the first entry is selected, nothing will be appended on the URI.
 */
export class UriSelectFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    displayName: string,
    readonly uriParam: string,
    readonly vals: [string, string][],
    readonly firstIsUnspecified = true,
    defaultValue = 0,
  ) {
    super(displayName, vals.map((it) => it[0]), defaultValue);
  }
  addToUri(uri: HttpUrlBuilder): void {
    if (this.state !== 0 || !this.firstIsUnspecified) uri.addQueryParameter(this.uriParam, this.vals[this.state][1]);
  }
}

export class GenreFilter extends UriSelectFilter {
  constructor(genres: [string, string][]) {
    super("Genre", "ep_filter_genre", [["Any", ""], ...genres]);
  }
}
export class TagFilter extends UriSelectFilter {
  constructor(popTags: [string, string][]) {
    super("Popular Tags", "ep_filter_post_tag", [["Any", ""], ...popTags]);
  }
}
export class CatFilter extends UriSelectFilter {
  constructor(catIds: [string, string][]) {
    super("Categories", "ep_filter_category", [["Any", ""], ...catIds]);
  }
}
export class PairingFilter extends UriSelectFilter {
  constructor(pairs: [string, string][]) {
    super("Pairing", "ep_filter_pairing", [["Any", ""], ...pairs]);
  }
}
export class ScanGroupFilter extends UriSelectFilter {
  constructor(groups: [string, string][]) {
    super("Scanlation Group", "ep_filter_group", [["Any", ""], ...groups]);
  }
}
export class SearchSortTypeList extends Filter.Select<string> {
  constructor() {
    super("Sort by", ["Newest", "Oldest", "Random", "More relevant"]);
  }
}
