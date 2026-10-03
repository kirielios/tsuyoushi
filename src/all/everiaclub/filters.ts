// Port of keiyoushi/extensions-source src/all/everiaclub/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly valuePair: [string, string][],
  ) {
    super(
      displayName,
      valuePair.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.valuePair[this.state][1];
  }
}

export class CategoryFilter extends UriPartFilter {
  constructor(categories: [string, string][]) {
    super("Category", categories);
  }
}

export class TagFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly id: number,
  ) {
    super(name);
  }
}

export class TagGroup extends Filter.Group<TagFilter> {
  constructor(tags: TagFilter[]) {
    super("Tags", tags);
  }
}
