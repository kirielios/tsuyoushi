// Port of keiyoushi/extensions-source src/en/emaqi/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class GenreModeFilter extends Filter.Select<string> {
  constructor() {
    super("Genre mode", ["AND", "OR"]);
  }
  get isOr(): boolean {
    return this.state === 1;
  }
}

export class GenreFilter extends Filter.Group<CheckBoxFilter> {
  constructor() {
    super(
      "Genres",
      (
        [
          ["Death Game", "death-game"],
          ["Psychological", "psychological"],
          ["Boys Love", "boys-love"],
          ["Suspense", "suspense"],
          ["Military", "military"],
          ["Rom-Com", "rom-com"],
          ["Mystery", "mystery"],
          ["Adventure", "adventure"],
          ["Drama", "drama"],
          ["Slice of Life", "slice-of-life"],
          ["Girls Love", "girls-love"],
          ["Sports", "sports"],
          ["Dark Drama", "dark-drama"],
          ["Sci-Fi", "sci-fi"],
          ["Isekai", "isekai"],
          ["Action", "action"],
          ["Fantasy", "fantasy"],
          ["Horror", "horror"],
          ["Romance", "romance"],
          ["Comedy", "comedy"],
        ] as const
      ).map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  get checked(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.value);
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
