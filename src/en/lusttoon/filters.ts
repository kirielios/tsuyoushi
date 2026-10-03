// Port of keiyoushi/extensions-source src/en/lusttoon/Filters.kt
import { Filter } from "../../../sdk/index.ts";

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
  get selected(): string {
    return this.options[this.state][1];
  }
}

export class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort by", ["Views", "Name", "Updated", "Added", "Chapters", "Followers"], { index: 2, ascending: false }); // Default: Updated, descending
  }
  get selected(): string {
    switch (this.state?.index) {
      case 0:
        return "1";
      case 1:
        return "2";
      case 2:
        return "3";
      case 3:
        return "4";
      case 4:
        return "5";
      case 5:
        return "6";
      default:
        return "3";
    }
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Webtoon", "1"],
      ["Manhwa", "2"],
      ["Manhua", "3"],
      ["Manga", "4"],
      ["Manhwa +19", "5"],
      ["+19 Uncensored", "6"],
      ["BL Uncensored", "7"],
      ["Manhwa BL", "8"],
      ["Novel", "9"],
      ["Manhua BL", "10"],
      ["Visual novel", "11"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "1"],
      ["Paused", "2"],
      ["Abandoned", "3"],
      ["Completed", "4"],
      ["Cancelled", "5"],
    ]);
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genre", [
      ["All", ""],
      ["Action", "1"],
      ["Adventure", "2"],
      ["Animation", "3"],
      ["Apocalyptic", "4"],
      ["Boys Love", "5"],
      ["Comedy", "6"],
      ["Crime", "7"],
      ["Cyberpunk", "8"],
      ["Demons", "9"],
      ["Drama", "10"],
      ["Ecchi", "11"],
      ["Family", "12"],
      ["Fantasy", "13"],
      ["Foreign", "14"],
      ["Gender Bender", "15"],
      ["Girls Love", "16"],
      ["Gore", "17"],
      ["Harem", "18"],
      ["History", "19"],
      ["Horror", "20"],
      ["Kids", "21"],
      ["Magic", "22"],
      ["Martial Arts", "23"],
      ["Mecha", "24"],
      ["Military", "25"],
      ["Mystery", "26"],
      ["Music", "27"],
      ["Parody", "28"],
      ["Police", "29"],
      ["Psychological", "30"],
      ["Reality", "31"],
      ["Reincarnation", "32"],
      ["Romance", "33"],
      ["Samurai", "34"],
      ["School Life", "35"],
      ["Sci-Fi", "36"],
      ["Slice of Life", "37"],
      ["Soap Opera", "38"],
      ["Sports", "39"],
      ["Supernatural", "40"],
      ["Super Power", "41"],
      ["Survival", "42"],
      ["Thriller", "43"],
      ["Tragedy", "44"],
      ["Vampires", "45"],
      ["Virtual Reality", "46"],
      ["War", "47"],
      ["Western", "48"],
      ["Dungeon", "49"],
      ["Systems", "50"],
      ["Revenge", "51"],
      ["Regression", "52"],
      ["Isekai", "53"],
      ["Video Games", "54"],
      ["Villainess", "55"],
      ["Adult", "56"],
      ["Smut", "57"],
      ["Transmigration", "58"],
      ["Ghosts", "59"],
      ["Dragons", "60"],
      ["Beasts", "61"],
      ["Aliens", "62"],
      ["Omegaverse", "63"],
    ]);
  }
}
