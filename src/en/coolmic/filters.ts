// Port of keiyoushi/extensions-source src/en/coolmic/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", [
      ["Relevance", "relevance"],
      ["Recently Added", "newest"],
      ["Oldest", "oldest"],
      ["Popular", "like_vote"],
      ["Explicitness", "erotic_rating"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Content Rating", [
      ["All", ""],
      ["All Ages", "is_mature:0"],
      ["Mature (18+)", "is_mature:1"],
      ["Uncensored", "is_uncensored:1"],
    ]);
  }
}
