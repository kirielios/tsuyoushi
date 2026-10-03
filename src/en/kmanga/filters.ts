// Port of keiyoushi/extensions-source src/en/kmanga/Filters.kt
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

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genres", [
      ["Romance･Romcom", "1"],
      ["Horror･Mystery･Suspense", "2"],
      ["Gag･Comedy･Slice-of-Life", "3"],
      ["SF･Fantasy", "4"],
      ["Sports", "5"],
      ["Drama", "6"],
      ["Outlaws･Underworld･Punks", "7"],
      ["Action･Battle", "8"],
      ["Isekai･Super Powers", "9"],
      ["One-off Books", "10"],
      ["Shojo/josei", "11"],
      ["Yaoi/BL", "12"],
      ["LGBTQ", "13"],
      ["Yuri/GL", "14"],
      ["Anime", "15"],
      ["Award Winner", "16"],
    ]);
  }
}
