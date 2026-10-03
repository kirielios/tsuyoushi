// Port of keiyoushi/extensions-source src/en/mangahere/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly id: number,
  ) {
    super(name);
  }
}

export class TypeList extends Filter.Select<string> {
  constructor(types: string[]) {
    super("Type", types, 1);
  }
}
export class CompletionList extends Filter.Select<string> {
  constructor(completions: string[]) {
    super("Completed series", completions, 0);
  }
}
export class RatingList extends Filter.Select<string> {
  constructor(ratings: string[]) {
    super("Minimum rating", ratings, 0);
  }
}
export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export class ArtistFilter extends Filter.Text {}
export class AuthorFilter extends Filter.Text {}
export class YearFilter extends Filter.Text {}

export const types = new Map<string, number>([
  ["Japanese Manga", 1],
  ["Korean Manhwa", 2],
  ["Chinese Manhua", 3],
  ["European Manga", 4],
  ["American Manga", 5],
  ["Hong Kong Manga", 6],
  ["Other Manga", 7],
  ["Any", 0],
]);

export const completions = ["Either", "No", "Yes"];
export const ratings = ["No Stars", "1 Star", "2 Stars", "3 Stars", "4 Stars", "5 Stars"];

export const genres = () =>
  (
    [
      ["Action", 1],
      ["Adventure", 2],
      ["Comedy", 3],
      ["Fantasy", 4],
      ["Historical", 5],
      ["Horror", 6],
      ["Martial Arts", 7],
      ["Mystery", 8],
      ["Romance", 9],
      ["Shounen Ai", 10],
      ["Supernatural", 11],
      ["Drama", 12],
      ["Shounen", 13],
      ["School Life", 14],
      ["Shoujo", 15],
      ["Gender Bender", 16],
      ["Josei", 17],
      ["Psychological", 18],
      ["Seinen", 19],
      ["Slice of Life", 20],
      ["Sci-fi", 21],
      ["Ecchi", 22],
      ["Harem", 23],
      ["Shoujo Ai", 24],
      ["Yuri", 25],
      ["Mature", 26],
      ["Tragedy", 27],
      ["Yaoi", 28],
      ["Doujinshi", 29],
      ["Sports", 30],
      ["Adult", 31],
      ["One Shot", 32],
      ["Smut", 33],
      ["Mecha", 34],
      ["Shotacon", 35],
      ["Lolicon", 36],
      ["Webtoons", 37],
    ] as [string, number][]
  ).map(([name, id]) => new Genre(name, id));
