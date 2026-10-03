// Port of keiyoushi/extensions-source src/en/mangafox/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly query: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(name, vals.map((it) => it[0]), state);
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class TextSearchMethodFilter extends UriPartFilter {
  constructor(name: string, query: string) {
    super(name, query, [
      ["contain", "cw"],
      ["begin", "bw"],
      ["end", "ew"],
    ]);
  }
}

export class TextSearchFilter extends Filter.Text {
  constructor(
    name: string,
    readonly query: string,
  ) {
    super(name);
  }
}

export class FilterWithMethodAndText extends Filter.Group<Filter> {}

export class NameFilter extends TextSearchFilter {
  constructor() {
    super("Name", "name");
  }
}

export class EntryTypeFilter extends UriPartFilter {
  constructor() {
    super("Type", "type", [
      ["Any", "0"],
      ["Japanese Manga", "1"],
      ["Korean Manhwa", "2"],
      ["Chinese Manhua", "3"],
      ["European Manga", "4"],
      ["American Manga", "5"],
      ["HongKong Manga", "6"],
      ["Other Manga", "7"],
    ]);
  }
}

export class AuthorMethodFilter extends TextSearchMethodFilter {
  constructor() {
    super("Method", "author_method");
  }
}

export class AuthorTextFilter extends TextSearchFilter {
  constructor() {
    super("Author", "author");
  }
}

export class AuthorFilter extends FilterWithMethodAndText {
  constructor() {
    super("Author", [new AuthorMethodFilter(), new AuthorTextFilter()]);
  }
}

export class ArtistMethodFilter extends TextSearchMethodFilter {
  constructor() {
    super("Method", "artist_method");
  }
}

export class ArtistTextFilter extends TextSearchFilter {
  constructor() {
    super("Artist", "artist");
  }
}

export class ArtistFilter extends FilterWithMethodAndText {
  constructor() {
    super("Artist", [new ArtistMethodFilter(), new ArtistTextFilter()]);
  }
}

export class RatingMethodFilter extends UriPartFilter {
  constructor() {
    super("Method", "rating_method", [
      ["is", "eq"],
      ["less than", "lt"],
      ["more than", "gt"],
    ]);
  }
}

export class RatingValueFilter extends UriPartFilter {
  constructor() {
    super("Rating", "rating", [
      ["any star", ""],
      ["no star", "0"],
      ["1 star", "1"],
      ["2 stars", "2"],
      ["3 stars", "3"],
      ["4 stars", "4"],
      ["5 stars", "5"],
    ]);
  }
}

export class RatingFilter extends Filter.Group<UriPartFilter> {
  constructor() {
    super("Rating", [new RatingMethodFilter(), new RatingValueFilter()]);
  }
}

export class YearMethodFilter extends UriPartFilter {
  constructor() {
    super("Method", "released_method", [
      ["on", "eq"],
      ["before", "lt"],
      ["after", "gt"],
    ]);
  }
}

export class YearTextFilter extends TextSearchFilter {
  constructor() {
    super("Release year", "released");
  }
}

export class YearFilter extends FilterWithMethodAndText {
  constructor() {
    super("Release year", [new YearMethodFilter(), new YearTextFilter()]);
  }
}

export class CompletedFilter extends UriPartFilter {
  constructor() {
    super("Completed Series", "st", [
      ["Either", "0"],
      ["Yes", "2"],
      ["No", "1"],
    ]);
  }
}

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly id: number,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", genres);
  }
}

export const getGenreList = () => [
  new Genre("Action", 1),
  new Genre("Adventure", 2),
  new Genre("Comedy", 3),
  new Genre("Drama", 4),
  new Genre("Fantasy", 5),
  new Genre("Martial Arts", 6),
  new Genre("Shounen", 7),
  new Genre("Horror", 8),
  new Genre("Supernatural", 9),
  new Genre("Harem", 10),
  new Genre("Psychological", 11),
  new Genre("Romance", 12),
  new Genre("School Life", 13),
  new Genre("Shoujo", 14),
  new Genre("Mystery", 15),
  new Genre("Sci-fi", 16),
  new Genre("Seinen", 17),
  new Genre("Tragedy", 18),
  new Genre("Ecchi", 19),
  new Genre("Sports", 20),
  new Genre("Slice of Life", 21),
  new Genre("Mature", 22),
  new Genre("Shoujo Ai", 23),
  new Genre("Webtoons", 24),
  new Genre("Doujinshi", 25),
  new Genre("One Shot", 26),
  new Genre("Smut", 27),
  new Genre("Yaoi", 28),
  new Genre("Josei", 29),
  new Genre("Historical", 30),
  new Genre("Shounen Ai", 31),
  new Genre("Gender Bender", 32),
  new Genre("Adult", 33),
  new Genre("Yuri", 34),
  new Genre("Mecha", 35),
  new Genre("Lolicon", 36),
  new Genre("Shotacon", 37),
];
