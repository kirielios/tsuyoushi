// Port of keiyoushi/extensions-source src/en/atsumaru/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export interface Genre {
  name: string;
  id: string;
}
export type Tag = Genre;
export type Type = Genre;
export type Status = Genre;

export class GenreFilter extends Filter.Group<Filter.TriState> {
  readonly genreIds: string[];
  constructor(genres: Genre[], excludedIds: string[] = []) {
    super(
      "Genres",
      genres.map((genre) => new Filter.TriState(genre.name, excludedIds.includes(genre.id) ? Filter.TriState.STATE_EXCLUDE : Filter.TriState.STATE_IGNORE)),
    );
    this.genreIds = genres.map((it) => it.id);
  }
}

// Split large list separate Groups.
export class TagFilters extends Filter.Group<TagFilter> {
  constructor(tags: Tag[]) {
    const groups = new Map<string, Tag[]>();
    // Kotlin's sortedBy compares Strings by UTF-16 code units
    for (const tag of [...tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const c = tag.name.length ? Array.from(tag.name)[0].toUpperCase() : null;
      const key = c === null || !(c >= "A" && c <= "Z") ? "0-9" : c;
      groups.set(key, [...(groups.get(key) ?? []), tag]);
    }
    super("Tags", [...groups].map(([letters, chunk]) => new TagFilter(letters, chunk)));
  }
}

export class TagFilter extends Filter.Group<Filter.TriState> {
  readonly tagIds: string[];
  constructor(letters: string, tags: Tag[]) {
    super(
      letters,
      tags.map((tag) => new Filter.TriState(tag.name)),
    );
    this.tagIds = tags.map((it) => it.id);
  }
}

export class TypeFilter extends Filter.Group<Filter.CheckBox> {
  readonly ids: string[];
  constructor(types: Type[]) {
    super(
      "Manga Type",
      types.map((type) => new Filter.CheckBox(type.name, false)),
    );
    this.ids = types.map((it) => it.id);
  }
}

export class StatusFilter extends Filter.Group<Filter.CheckBox> {
  readonly ids: string[];
  constructor(statuses: Status[]) {
    super(
      "Publishing Status",
      statuses.map((status) => new Filter.CheckBox(status.name, false)),
    );
    this.ids = statuses.map((it) => it.id);
  }
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year (e.g., 2024)");
  }
}

export class MinChaptersFilter extends Filter.Text {
  constructor() {
    super("Minimum Chapters");
  }
}

export class SortFilter extends Filter.Sort {
  static readonly VALUES = ["views", "trending", "dateAdded", "released", "mbRating", "title"];
  constructor() {
    super("Sort By", ["Popularity", "Trending", "Date Added", "Release Date", "Top Rated", "Title"], { index: 0, ascending: false });
  }
}

export class AdultFilter extends Filter.CheckBox {
  constructor(state: boolean) {
    super("Show Adult Content", state);
  }
}

export class OfficialFilter extends Filter.CheckBox {
  constructor() {
    super("Only Official Translations", false);
  }
}
