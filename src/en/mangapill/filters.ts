// Port of keiyoushi/extensions-source src/en/mangapill/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
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

export class Type extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "manga"],
      ["Novel", "novel"],
      ["One-Shot", "one-shot"],
      ["Doujinshi", "doujinshi"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Oel", "oel"],
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

export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export class Status extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Publishing", "publishing"],
      ["Finished", "finished"],
      ["On Hiatus", "on hiatus"],
      ["Discontinued", "discontinued"],
      ["Not yet Published", "not yet published"],
    ]);
  }
}

export const getGenreList = () =>
  [
    "Action", "Adventure", "Cars", "Comedy", "Dementia", "Demons", "Drama", "Ecchi", "Fantasy", "Game", "Harem", "Hentai",
    "Historical", "Horror", "Josei", "Kids", "Magic", "Martial Arts", "Mecha", "Military", "Music", "Mystery", "Parody",
    "Police", "Psychological", "Romance", "Samurai", "School", "Sci-Fi", "Seinen", "Shoujo", "Shoujo Ai", "Shounen",
    "Shounen Ai", "Slice of Life", "Space", "Sports", "Super Power", "Supernatural", "Thriller", "Vampire", "Yaoi", "Yuri",
  ].map((name) => new Genre(name));
