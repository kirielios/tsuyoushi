// Port of keiyoushi/extensions-source src/en/newmanhwa/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["All", "Ongoing", "Completed", "Hiatus"]);
  }
}

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Sort by", ["Updated", "Popular", "Most Chapters", "Newest", "A-Z", "Z-A"], 0);
  }
}

export class Genre {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {}
  toString(): string {
    return this.name;
  }
}

export class GenreFilter extends Filter.Select<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", [new Genre("All", ""), ...genres]);
  }
}

export interface GenreDto {
  name: string;
  slug: string;
}

export interface GenreResponseDto {
  genres?: GenreDto[];
}

export function getGenreList(data: unknown = null): Genre[] {
  let items: GenreDto[] = [];
  try {
    items = (data as GenreResponseDto | null)?.genres ?? [];
  } catch {
    // runCatching { parseAs }.getOrNull()
  }
  return items.map((item) => new Genre(item.name, item.slug));
}
