// Port of keiyoushi/extensions-source src/en/alphamanga/Filters.kt
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

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Progress", [
      ["All", ""],
      ["Ongoing", "2"],
      ["Completed", "1"],
      ["Suspended", "3"],
    ]);
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genres", [
      ["All", ""],
      ["Shonen", "1001"],
      ["Shojo", "1002"],
      ["Romance", "1033"],
      ["Action", "1003"],
      ["Villainess", "1037"],
      ["Reincarnation", "1005"],
      ["Slice of Life", "1057"],
      ["Anime", "1041"],
    ]);
  }
}
