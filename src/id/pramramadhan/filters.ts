// Port of keiyoushi/extensions-source src/id/pramramadhan/Filters.kt
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

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Urutkan", [
      ["Populer", "popular"],
      ["Terbaru", "newest"],
      ["Terlama", "oldest"],
      ["Judul A-Z", "title_asc"],
      ["Judul Z-A", "title_desc"],
    ]);
  }
}

export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      ["Semua", ""],
      ["Adventure", "Adventure"],
      ["Comedy", "Comedy"],
      ["Drama", "Drama"],
      ["Ecchi", "Ecchi"],
      ["Fantasy", "Fantasy"],
      ["Magic", "Magic"],
      ["Romance", "Romance"],
      ["School", "School"],
      ["Slice of Life", "Slice of Life"],
    ]);
  }
}

export class FormatFilter extends UriPartFilter {
  constructor() {
    super("Format", [
      ["Semua", ""],
      ["Light Novel", "Light Novel"],
      ["Manga", "Manga"],
      ["Web Novel", "Web Novel"],
    ]);
  }
}

export class ProjectFilter extends UriPartFilter {
  constructor() {
    super("Project", [
      ["Semua", ""],
      ["Continued", "continued"],
      ["Completed", "completed"],
      ["Dropped", "dropped"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["Semua", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}
export class ArtistFilter extends Filter.Text {
  constructor() {
    super("Artist");
  }
}
