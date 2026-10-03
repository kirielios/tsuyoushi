// Port of keiyoushi/extensions-source src/en/ezmanga/EZmangaGenreFilter.kt
import { Filter } from "../../../sdk/index.ts";

const ENTRIES: [string, string][] = [
  ["All", ""], ["Isekai", "isekai"], ["Action", "action"], ["Adventure", "adventure"],
  ["All Ages", "all-ages"], ["Comedy", "comedy"], ["Drama", "drama"], ["Fantasy", "fantasy"],
  ["GORE", "gore"], ["Game World", "game-world"], ["Gender Bender", "gender-bender"],
  ["Historical", "historical"], ["Horror", "horror"], ["Josei", "josei"], ["Magic", "magic"],
  ["Martial Arts", "martial-arts"], ["Modern", "modern"], ["Mystery", "mystery"],
  ["Psychological", "psychological"], ["Regression", "regression"], ["Romance", "romance"],
  ["Royalty", "royalty"], ["School Life", "school-life"], ["Science Fiction", "science-fiction"],
  ["Slice of Life", "slice-of-life"], ["Sports", "sports"], ["Supernatural", "supernatural"],
  ["Thriller", "thriller"], ["Webtoon", "webtoon"], ["Another World", "another-world"],
  ["Crossdressing", "crossdressing"], ["Dr", "dr"], ["Elf", "elf"],
  ["Female Cartoon", "emale-cartoon"], ["Full Color", "full-color"],
  ["Love Affair", "love-affair"], ["Manhwa", "manhwa"], ["Pure", "pure"],
  ["Revenge", "revenge"], ["Shoujo", "shoujo"], ["White Cat", "white-cat"],
];

export class EZmangaGenreFilter extends Filter.Select<string> {
  static readonly DISPLAY = ENTRIES.map((it) => it[0]);
  static readonly VALUES = ENTRIES.map((it) => it[1]);
  constructor() {
    super("Genre", EZmangaGenreFilter.DISPLAY);
  }
  get value() {
    return EZmangaGenreFilter.VALUES[this.state];
  }
}
