// Port of keiyoushi/extensions-source lib-multisrc/hwalumi/Filters.kt
import { Filter } from "../../sdk/index.ts";

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Urutkan", ["Terbaru", "Populer", "Rating", "A - Z"]);
  }
  getValue(): string {
    return ["latest", "popular", "rating", "az"][this.state] ?? "latest";
  }
}

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["Semua", "Ongoing", "Completed", "Hiatus"]);
  }
  getValue(): string {
    return ["", "ongoing", "completed", "hiatus"][this.state] ?? "";
  }
}

export class TypeFilter extends Filter.Select<string> {
  constructor() {
    super("Tipe", ["Semua", "Manga", "Manhwa", "Manhua"]);
  }
  getValue(): string {
    return ["", "manga", "manhwa", "manhua"][this.state] ?? "";
  }
}

export class Genre {
  constructor(
    readonly name: string,
    readonly id: string,
  ) {}
}
export class GenreCheckBox extends Filter.CheckBox {
  constructor(readonly genre: Genre) {
    super(genre.name);
  }
}
export class GenreListFilter extends Filter.Group<GenreCheckBox> {
  constructor(genres: Genre[]) {
    super(
      "Genre",
      genres.map((it) => new GenreCheckBox(it)),
    );
  }
  getIncluded(): string {
    return this.state
      .filter((it) => it.state)
      .map((it) => it.genre.id)
      .join(",");
  }
}
