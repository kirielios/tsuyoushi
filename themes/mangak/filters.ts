// Port of keiyoushi/extensions-source lib-multisrc/mangak/MangaKFilters.kt
import { Filter } from "../../sdk/index.ts";
import type { GenreResponseDto } from "./dto.ts";

export class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
    state: number = Filter.TriState.STATE_IGNORE,
  ) {
    super(name, state);
  }
}

export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}
export class MinChapterFilter extends Filter.Text {
  constructor() {
    super("Min Chapters");
  }
}

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    defaultValue = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      defaultValue,
    );
  }
  get selected(): string {
    return this.vals[this.state]?.[1] ?? "";
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Best Match", ""],
      ["Most Followed", "popular"],
      ["Latest Updated", "latest"],
      ["Recently Added", "newest"],
      ["Highest Rating", "rating"],
      ["Most Viewed: Today", "views_today"],
      ["Most Viewed: 7 Days", "views_7days"],
      ["Most Viewed: 30 Days", "views_30days"],
      ["Most Viewed: All Time", "views"],
      ["Most Chapters", "chapters"],
      ["A-Z", "alphabetical"],
    ]);
  }
}

export class ContentRatingFilter extends SelectFilter {
  constructor() {
    super("Content Rating", [
      ["Any", ""],
      ["Safe", "safe"],
      ["Suggestive", "suggestive"],
      ["Erotica", "erotica"],
      ["Pornographic", "pornographic"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["Any", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Cancelled", "cancelled"],
    ]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["Any", ""],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
    ]);
  }
}

export class DemographicFilter extends SelectFilter {
  constructor() {
    super("Demographics", [
      ["Any", ""],
      ["Boy (Shounen + Seinen)", "shounen,seinen"],
      ["Girl (Shoujo + Josei)", "shoujo,josei"],
      ["Shounen", "shounen"],
      ["Shoujo", "shoujo"],
      ["Seinen", "seinen"],
      ["Josei", "josei"],
    ]);
  }
}

export function getGenreList(data: unknown = null, blacklist: Set<string> = new Set()): Genre[] {
  const items = (data as GenreResponseDto | null)?.data?.items ?? [];
  return items.map((item) => new Genre(item.name, item.slug, blacklist.has(item.slug) ? Filter.TriState.STATE_EXCLUDE : Filter.TriState.STATE_IGNORE));
}
