// Port of keiyoushi/extensions-source src/id/riztranslation/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class HasChapterFilter extends Filter.CheckBox {
  constructor() {
    super("Hanya yang memiliki chapter", false);
  }
}

export class TypeFilter extends Filter.Select<string> {
  constructor() {
    super("Tipe", ["Semua", "Manga", "Web Manga"]);
  }
}

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["Semua", "Ongoing", "Completed", "Oneshot"]);
  }
}

export class SortFilter extends Filter.Sort {
  constructor() {
    super("Urutkan", ["Update Terakhir", "Ditambahkan", "A-Z"], { index: 0, ascending: false });
  }
}

const genres: [string, string][] = [
  ["Action", "10"],
  ["Adventure", "11"],
  ["Comedy", "12"],
  ["Drama", "1"],
  ["Fantasy", "9"],
  ["Isekai", "3"],
  ["Lucid Dream", "13"],
  ["Mysteri", "4"],
  ["Romance", "2"],
  ["School Life", "8"],
  ["Sci-Fi", "14"],
  ["Slice of Life", "6"],
  ["Supernatural", "24"],
  ["Time Travel", "19"],
  ["Tragedy", "5"],
];

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<GenreCheckBox> {
  constructor() {
    super(
      "Genre",
      genres.map((it) => new GenreCheckBox(it[0], it[1])),
    );
  }
}
