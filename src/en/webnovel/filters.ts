// Port of keiyoushi/extensions-source src/en/webnovel/WebNovelFilter.kt
import { Filter } from "../../../sdk/index.ts";

export interface FilterOption {
  displayName: string;
  value: string;
}

export class EnhancedSelect extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly _values: FilterOption[],
    state = 0,
  ) {
    super(
      name,
      _values.map((it) => it.displayName),
      state,
    );
  }

  get selectedValue(): string | undefined {
    return this._values[this.state]?.value;
  }
}

export class SortByFilter extends EnhancedSelect {
  constructor(def = 1) {
    super(
      "Sort By",
      [
        { displayName: "Popular", value: "1" },
        { displayName: "Recommended", value: "2" },
        { displayName: "Most collections", value: "3" },
        { displayName: "Rating", value: "4" },
        { displayName: "Time updated", value: "5" },
      ],
      def - 1,
    );
  }
}

export class ContentStatusFilter extends EnhancedSelect {
  constructor() {
    super("Content status", [
      { displayName: "All", value: "0" },
      { displayName: "Ongoing", value: "1" },
      { displayName: "Completed", value: "2" },
    ]);
  }
}

export class GenreFilter extends EnhancedSelect {
  constructor() {
    super(
      "Genre",
      (
        [
          ["All", "0"],
          ["Action", "60002"],
          ["Adventure", "60014"],
          ["Comedy", "60011"],
          ["Cooking", "60009"],
          ["Diabolical", "60027"],
          ["Drama", "60024"],
          ["Eastern", "60006"],
          ["Fantasy", "60022"],
          ["Harem", "60017"],
          ["History", "60018"],
          ["Horror", "60015"],
          ["Inspiring", "60013"],
          ["LGBT+", "60029"],
          ["Magic", "60016"],
          ["Mystery", "60008"],
          ["Romance", "60003"],
          ["School", "60007"],
          ["Sci-fi", "60004"],
          ["Slice of Life", "60019"],
          ["Sports", "60023"],
          ["Transmigration", "60012"],
          ["Urban", "60005"],
          ["Wuxia", "60010"],
        ] as const
      ).map(([displayName, value]) => ({ displayName, value })),
    );
  }
}
