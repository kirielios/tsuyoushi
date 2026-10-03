// Port of keiyoushi/extensions-source src/en/kodansha/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class CheckBox extends Filter.CheckBox {
  constructor(
    displayName: string,
    readonly value: string,
  ) {
    super(displayName);
  }
}

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
      ["New and Popular", "0"],
      ["A-Z", "9"],
      ["Z-A", "8"],
      ["Newest", "5"],
      ["Oldest", "6"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "0"],
      ["Completed", "1"],
    ]);
  }
}

export class GenreFilter extends Filter.Group<CheckBox> {
  constructor() {
    super("Genres", [
      new CheckBox("Action & Adventure", "12"),
      new CheckBox("Arts & Entertainment", "17"),
      new CheckBox("Biography", "21"),
      new CheckBox("Comedy", "9"),
      new CheckBox("Crafts", "28"),
      new CheckBox("Drama", "1"),
      new CheckBox("Fantasy", "4"),
      new CheckBox("Fiction & Literature", "18"),
      new CheckBox("Food", "14"),
      new CheckBox("Games", "33"),
      new CheckBox("General Nonfiction", "25"),
      new CheckBox("Historical", "15"),
      new CheckBox("History & Politics", "34"),
      new CheckBox("Horror", "6"),
      new CheckBox("Isekai", "16"),
      new CheckBox("Language", "32"),
      new CheckBox("LGBTQ", "20"),
      new CheckBox("Made into Anime", "5"),
      new CheckBox("Martial Arts", "30"),
      new CheckBox("Movie/TV Tie-in", "19"),
      new CheckBox("Philosophy", "31"),
      new CheckBox("Reference", "29"),
      new CheckBox("Religion & Spirituality", "22"),
      new CheckBox("Romance", "2"),
      new CheckBox("School Life", "8"),
      new CheckBox("Science-Fiction", "7"),
      new CheckBox("Slice of Life", "10"),
      new CheckBox("Sports", "11"),
      new CheckBox("Supernatural", "35"),
      new CheckBox("Thriller", "13"),
      new CheckBox("Videogame Tie-in", "24"),
      new CheckBox("Yaoi/BL", "3"),
      new CheckBox("Yuri", "23"),
    ]);
  }
}

export class AgeRatingFilter extends Filter.Group<CheckBox> {
  constructor() {
    super("Age Rating", [new CheckBox("10+", "10"), new CheckBox("13+", "13"), new CheckBox("16+", "16"), new CheckBox("18+", "18")]);
  }
}
