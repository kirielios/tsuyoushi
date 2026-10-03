// Port of keiyoushi/extensions-source src/id/bacakomik/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year");
  }
}

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["Default", ""],
      ["Manga", "Manga"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
      ["Comic", "Comic"],
    ]);
  }
}

export class SortByFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["Default", ""],
      ["A-Z", "title"],
      ["Z-A", "titlereverse"],
      ["Latest Update", "update"],
      ["Latest Added", "latest"],
      ["Popular", "popular"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name);
  }
}
export class GenreListFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", genres);
  }
}

export const getGenreList = () => [
  new Genre("4-Koma", "4-koma"),
  new Genre("4-Koma. Comedy", "4-koma-comedy"),
  new Genre("Action", "action"),
  new Genre("Action. Adventure", "action-adventure"),
  new Genre("Adult", "adult"),
  new Genre("Adventure", "adventure"),
  new Genre("Comedy", "comedy"),
  new Genre("Cooking", "cooking"),
  new Genre("Demons", "demons"),
  new Genre("Doujinshi", "doujinshi"),
  new Genre("Drama", "drama"),
  new Genre("Ecchi", "ecchi"),
  new Genre("Echi", "echi"),
  new Genre("Fantasy", "fantasy"),
  new Genre("Game", "game"),
  new Genre("Gender Bender", "gender-bender"),
  new Genre("Gore", "gore"),
  new Genre("Harem", "harem"),
  new Genre("Historical", "historical"),
  new Genre("Horror", "horror"),
  new Genre("Isekai", "isekai"),
  new Genre("Josei", "josei"),
  new Genre("Magic", "magic"),
  new Genre("Manga", "manga"),
  new Genre("Manhua", "manhua"),
  new Genre("Manhwa", "manhwa"),
  new Genre("Martial Arts", "martial-arts"),
  new Genre("Mature", "mature"),
  new Genre("Mecha", "mecha"),
  new Genre("Medical", "medical"),
  new Genre("Military", "military"),
  new Genre("Music", "music"),
  new Genre("Mystery", "mystery"),
  new Genre("One Shot", "one-shot"),
  new Genre("Oneshot", "oneshot"),
  new Genre("Parody", "parody"),
  new Genre("Police", "police"),
  new Genre("Psychological", "psychological"),
  new Genre("Romance", "romance"),
  new Genre("Samurai", "samurai"),
  new Genre("School", "school"),
  new Genre("School Life", "school-life"),
  new Genre("Sci-fi", "sci-fi"),
  new Genre("Seinen", "seinen"),
  new Genre("Shoujo", "shoujo"),
  new Genre("Shoujo Ai", "shoujo-ai"),
  new Genre("Shounen", "shounen"),
  new Genre("Shounen Ai", "shounen-ai"),
  new Genre("Slice of Life", "slice-of-life"),
  new Genre("Smut", "smut"),
  new Genre("Sports", "sports"),
  new Genre("Super Power", "super-power"),
  new Genre("Supernatural", "supernatural"),
  new Genre("Thriller", "thriller"),
  new Genre("Tragedy", "tragedy"),
  new Genre("Vampire", "vampire"),
  new Genre("Webtoon", "webtoon"),
  new Genre("Webtoons", "webtoons"),
  new Genre("Yuri", "yuri"),
];
