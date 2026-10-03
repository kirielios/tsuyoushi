// Port of keiyoushi/extensions-source src/id/ryukomik/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class TypeFilter extends Filter.Select<string> {
  constructor(values: string[]) {
    super("Tipe Komik", values);
  }
}
export class StatusFilter extends Filter.Select<string> {
  constructor(values: string[]) {
    super("Status", values);
  }
}
export class OrderByFilter extends Filter.Select<string> {
  constructor(values: string[]) {
    super("Urutkan Berdasarkan", values);
  }
}
export class LetterFilter extends Filter.Select<string> {
  constructor(values: string[]) {
    super("Huruf Awalan", values);
  }
}
export class GenreFilter extends Filter.Select<string> {
  constructor(values: string[]) {
    super("Genre", values);
  }
}

export const TYPE_OPTIONS: [string, string][] = [
  ["Semua", ""],
  ["Manga", "manga"],
  ["Manhwa", "manhwa"],
  ["Manhua", "manhua"],
];

export const STATUS_OPTIONS: [string, string][] = [
  ["Semua", ""],
  ["Ongoing (Berjalan)", "ongoing"],
  ["Completed (Tamat)", "end"],
];

export const ORDER_OPTIONS: [string, string][] = [
  ["Default", ""],
  ["Chapter Terbaru", "modified"],
  ["Komik Terbaru", "date"],
  ["Acak", "rand"],
];

export const LETTER_OPTIONS: [string, string][] = [
  ["Semua", ""],
  ["#", "%23"],
  ["A", "A"],
  ["B", "B"],
  ["C", "C"],
  ["D", "D"],
  ["E", "E"],
  ["F", "F"],
  ["G", "G"],
  ["H", "H"],
  ["I", "I"],
  ["J", "J"],
  ["K", "K"],
  ["L", "L"],
  ["M", "M"],
  ["N", "N"],
  ["O", "O"],
  ["P", "P"],
  ["Q", "Q"],
  ["R", "R"],
  ["S", "S"],
  ["T", "T"],
  ["U", "U"],
  ["V", "V"],
  ["W", "W"],
  ["X", "X"],
  ["Y", "Y"],
  ["Z", "Z"],
];

export const GENRE_OPTIONS: [string, string][] = [
  ["Semua", ""],
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Boys' Love", "boys'-love"],
  ["Comedy", "comedy"],
  ["Crime", "crime"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Girls' Love", "girls'-love"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Magical Girls", "magical-girls"],
  ["Martial Arts", "martial-arts"],
  ["Mecha", "mecha"],
  ["Medical", "medical"],
  ["Music", "music"],
  ["Mystery", "mystery"],
  ["Philosophical", "philosophical"],
  ["Psychological", "psychological"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shoujo Ai", "shoujo-ai"],
  ["Shounen", "shounen"],
  ["Shounen Ai", "shounen-ai"],
  ["Slice of Life", "slice-of-life"],
  ["Sports", "sports"],
  ["Superhero", "superhero"],
  ["Supernatural", "supernatural"],
  ["Thriller", "thriller"],
  ["Tragedy", "tragedy"],
  ["Wuxia", "wuxia"],
  ["Yuri", "yuri"],
];
