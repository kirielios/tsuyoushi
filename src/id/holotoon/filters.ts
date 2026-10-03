// Port of keiyoushi/extensions-source src/id/holotoon/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Urutkan", ["Terbaru", "Populer", "Rating", "A-Z"]);
  }
  get value() {
    return ["latest", "popular", "rating", "az"][this.state];
  }
}

export class TypeFilter extends Filter.Select<string> {
  constructor() {
    super("Tipe", ["Semua", "Manga", "Manhwa", "Manhua", "Comic", "Webtoon"]);
  }
  get value() {
    return ["", "manga", "manhwa", "manhua", "comic", "webtoon"][this.state];
  }
}

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["Semua", "Ongoing", "Completed", "Hiatus"]);
  }
  get value() {
    return ["", "ongoing", "completed", "hiatus"][this.state];
  }
}

export class GenreFilter extends Filter.Select<string> {
  constructor(private readonly genres: [string, string][]) {
    super("Genre", ["Semua", ...genres.map((it) => it[0])]);
  }
  get value() {
    return this.state === 0 ? "" : this.genres[this.state - 1][1];
  }
}
