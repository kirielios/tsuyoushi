// Port of keiyoushi/extensions-source src/en/mangakatana/Filters.kt
import { Filter } from "../../../sdk/index.ts";

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
  toUriPart = () => this.vals[this.state][1];
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Text search by", [
      ["Title", "book_name"],
      ["Author", "author"],
    ]);
  }
}

export class Genre extends Filter.TriState {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(name);
  }
}
export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export class GenreInclusionMode extends UriPartFilter {
  constructor() {
    super("Genre inclusion mode", [
      ["And", "and"],
      ["Or", "or"],
    ]);
  }
}

export class ChaptersFilter extends Filter.Text {
  constructor() {
    super("Minimum Chapters");
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort by", [
      ["Latest update", "latest"],
      ["New manga", "new"],
      ["A-Z", "az"],
      ["Number of chapters", "numc"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Cancelled", "0"],
      ["Ongoing", "1"],
      ["Completed", "2"],
    ]);
  }
}

export const genres = [
  new Genre("4-koma", "4 koma"),
  new Genre("action", "Action"),
  new Genre("adult", "Adult"),
  new Genre("adventure", "Adventure"),
  new Genre("artbook", "Artbook"),
  new Genre("award-winning", "Award winning"),
  new Genre("comedy", "Comedy"),
  new Genre("cooking", "Cooking"),
  new Genre("doujinshi", "Doujinshi"),
  new Genre("drama", "Drama"),
  new Genre("ecchi", "Ecchi"),
  new Genre("erotica", "Erotica"),
  new Genre("fantasy", "Fantasy"),
  new Genre("gender-bender", "Gender Bender"),
  new Genre("gore", "Gore"),
  new Genre("harem", "Harem"),
  new Genre("historical", "Historical"),
  new Genre("horror", "Horror"),
  new Genre("isekai", "Isekai"),
  new Genre("josei", "Josei"),
  new Genre("loli", "Loli"),
  new Genre("manhua", "Manhua"),
  new Genre("manhwa", "Manhwa"),
  new Genre("martial-arts", "Martial Arts"),
  new Genre("mecha", "Mecha"),
  new Genre("medical", "Medical"),
  new Genre("music", "Music"),
  new Genre("mystery", "Mystery"),
  new Genre("one-shot", "One shot"),
  new Genre("overpowered-mc", "Overpowered MC"),
  new Genre("psychological", "Psychological"),
  new Genre("reincarnation", "Reincarnation"),
  new Genre("romance", "Romance"),
  new Genre("school-life", "School Life"),
  new Genre("sci-fi", "Sci-fi"),
  new Genre("seinen", "Seinen"),
  new Genre("sexual-violence", "Sexual violence"),
  new Genre("shota", "Shota"),
  new Genre("shoujo", "Shoujo"),
  new Genre("shoujo-ai", "Shoujo Ai"),
  new Genre("shounen", "Shounen"),
  new Genre("shounen-ai", "Shounen Ai"),
  new Genre("slice-of-life", "Slice of Life"),
  new Genre("sports", "Sports"),
  new Genre("super-power", "Super power"),
  new Genre("supernatural", "Supernatural"),
  new Genre("survival", "Survival"),
  new Genre("time-travel", "Time Travel"),
  new Genre("tragedy", "Tragedy"),
  new Genre("webtoon", "Webtoon"),
  new Genre("yaoi", "Yaoi"),
  new Genre("yuri", "Yuri"),
];
