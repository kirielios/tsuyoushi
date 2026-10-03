// Port of keiyoushi/extensions-source src/en/mangamob/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
    defaultValue = "",
  ) {
    super(name, options.map((it) => it[0]), Math.max(0, options.findIndex((it) => it[1] === defaultValue)));
  }
  selectedValue() {
    return this.options[this.state][1];
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genre", [
      ["All Genres", ""],
      ["Action", "Action"],
      ["Adventure", "Adventure"],
      ["Comedy", "Comedy"],
      ["Drama", "Drama"],
      ["Fantasy", "Fantasy"],
      ["Horror", "Horror"],
      ["Romance", "Romance"],
      ["Sci-Fi", "Sci-Fi"],
      ["Slice of Life", "Slice of Life"],
      ["Sports", "Sports"],
      ["Supernatural", "Supernatural"],
      ["Thriller", "Thriller"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
      ["Webtoon", "Webtoon"],
      ["Action", "Action"],
      ["Adventure", "Adventure"],
      ["Comedy", "Comedy"],
      ["Cooking", "Cooking"],
      ["Manga", "Manga"],
      ["Drama", "Drama"],
      ["Fantasy", "Fantasy"],
      ["Gender bender", "Gender bender"],
      ["Harem", "Harem"],
      ["Historical", "Historical"],
      ["Horror", "Horror"],
      ["Isekai", "Isekai"],
      ["Josei", "Josei"],
      ["Manhua", "Manhua"],
      ["Manhwa", "Manhwa"],
      ["Martial arts", "Martial arts"],
      ["Mature", "Mature"],
      ["Mecha", "Mecha"],
      ["Medical", "Medical"],
      ["Mystery", "Mystery"],
      ["One shot", "One shot"],
      ["Psychological", "Psychological"],
      ["Romance", "Romance"],
      ["School life", "School life"],
      ["Sci fi", "Sci fi"],
      ["Seinen", "Seinen"],
      ["Shoujo", "Shoujo"],
      ["Shounen", "Shounen"],
      ["Slice of life", "Slice of life"],
      ["Sports", "Sports"],
      ["Supernatural", "Supernatural"],
      ["Tragedy", "Tragedy"],
      ["Webtoons", "Webtoons"],
      ["ladies", "ladies"],
    ]);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Updated", "Updated"],
      ["New", "New"],
      ["Views", "Views"],
      ["Random", "Random"],
    ], "Views");
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
    ]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["All Types", ""],
      ["Manga", "Manga"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
    ]);
  }
}
