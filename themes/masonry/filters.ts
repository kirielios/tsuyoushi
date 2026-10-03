// Port of keiyoushi/extensions-source lib-multisrc/masonry/Filters.kt
import { Filter } from "../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected() {
    return this.options[this.state][1];
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", sortFilterOptions);
  }
  getUriPartIfNeeded(part: string): string {
    switch (part) {
      case "search":
        return this.state === 2 ? "" : this.selected;
      case "tag":
        return this.state === 0 ? "" : this.selected;
      default:
        return "";
    }
  }
}

const sortFilterOptions: [string, string][] = [
  ["Trending", "sort/trending"],
  ["Newest", "sort/newest"],
  ["Popular", "sort/popular"],
];

export interface Tag {
  name: string;
  uriPart: string;
}

export class TagFilter extends SelectFilter {
  constructor(options: Tag[]) {
    super(
      "Tags",
      options.map((it) => [it.name, it.uriPart]),
    );
  }
}
