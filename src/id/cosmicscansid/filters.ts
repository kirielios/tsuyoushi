// Port of keiyoushi/extensions-source src/id/cosmicscansid/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getCosmicScansIDFilterList = () => FilterList(new OrderFilter(), new StatusFilter(), new TypeFilter(), new ProjectFilter(), new GenreFilter(getGenres()));

export class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get value(): string {
    return this.options[this.state][1];
  }
}

export class OrderFilter extends SelectFilter {
  constructor() {
    super("Urutkan", [
      ["Update", "update"],
      ["A–Z", "az"],
      ["Z–A", "za"],
      ["Baru Ditambahkan", "added"],
      ["Popular", "popular"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["Semua", ""],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
      ["Hiatus", "Hiatus"],
      ["Dropped", "Dropped"],
    ]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Tipe", [
      ["Semua", ""],
      ["Manga", "Manga"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
      ["Webtoon", "Webtoon"],
    ]);
  }
}

export class ProjectFilter extends SelectFilter {
  constructor() {
    super("Project", [
      ["Semua", ""],
      ["Project Only", "true"],
    ]);
  }
}

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", genres);
  }
}

// Upstream shares one GENRES list; fresh boxes per filter list keep states apart.
const getGenres = () => GENRES.map(([name, slug]) => new Genre(name, slug));
const GENRES: [string, string][] = [
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Cultivation", "cultivation"],
  ["Delinquent", "delinquent"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Martial Arts", "martial-arts"],
  ["Murim", "murim"],
  ["Mystery", "mystery"],
  ["Psychological", "psychological"],
  ["Reincarnation", "reincarnation"],
  ["Returner", "returner"],
  ["Revenge", "revenge"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shounen", "shounen"],
  ["Slice of Life", "slice-of-life"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["System", "system"],
  ["Thriller", "thriller"],
  ["Tragedy", "tragedy"],
];
