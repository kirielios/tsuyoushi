// Port of keiyoushi/extensions-source lib-multisrc/colorlibanime/Filters.kt
import { Filter } from "../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      state,
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class OrderFilter extends UriPartFilter {
  constructor(state = 0) {
    super(
      "Order By",
      [
        ["A-Z", "default"],
        ["Updated", "updated"],
        ["New", "published"],
        ["Views", "view"],
      ],
      state,
    );
  }
}
