// Port of keiyoushi/extensions-source src/all/manhwa18net/Filter.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getFilters = (): FilterList => [new Filter.Header("Filters work with both search and browse"), new Filter.Separator(), new SortFilter(), new StatusFilter()];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart = () => this.vals[this.state][1];
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["Latest Updates", "update"],
      ["Most Viewed", "top"],
      ["Most Liked", "like"],
      ["Newest", "new"],
    ]);
  }
}

export class StatusCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly uriParam: string,
  ) {
    super(name);
  }
}

export class StatusFilter extends Filter.Group<StatusCheckBox> {
  constructor() {
    super("Status", [new StatusCheckBox("Ongoing", "Ongoing"), new StatusCheckBox("On Hold", "Onhold"), new StatusCheckBox("Completed", "completed")]);
  }
}
