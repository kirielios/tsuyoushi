// Port of keiyoushi/extensions-source lib-multisrc/galleryadults/GalleryAdultsFilters.kt
import { Filter } from "../../sdk/index.ts";

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly uri: string,
  ) {
    super(name);
  }
}

const byName = (a: [string, string], b: [string, string]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

export class GenreGroup extends Filter.Group<Genre> {
  constructor(
    letter: string,
    readonly genres: [string, string][],
  ) {
    super(
      letter,
      genres.map((it) => new Genre(it[0], it[1])),
    );
  }
}

export class GenresFilter extends Filter.Group<GenreGroup> {
  constructor(genres: Record<string, string>) {
    const groups = new Map<string, [string, string][]>();
    for (const it of Object.entries(genres).sort(byName)) {
      const c = it[1][0]?.toUpperCase();
      const key = c != null && c >= "A" && c <= "Z" ? c : "#";
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    super(
      "Tags",
      [...groups].map(([letter, chunk]) => new GenreGroup(letter, chunk)),
    );
  }
  get selected(): Genre[] {
    return this.state.flatMap((it) => it.state.filter((g) => g.state));
  }
}

export class SortOrderFilter extends Filter.Select<string> {
  constructor(sortOrderURIs: [string, string][]) {
    super(
      "Sort By",
      sortOrderURIs.map((it) => it[0]),
    );
  }
}

export class FavoriteFilter extends Filter.CheckBox {
  constructor() {
    super("Show favorites only (login via WebView)", false);
  }
}

export class RandomEntryFilter extends Filter.CheckBox {
  constructor() {
    super("Random manga", false);
  }
}

// Speechless
export class SpeechlessFilter extends Filter.CheckBox {
  constructor() {
    super("Show speechless items only", false);
  }
}

// Intermediate search
export class SearchFlagFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly uri: string,
    state = true,
  ) {
    super(name, state);
  }
}
export class CategoryFilters extends Filter.Group<SearchFlagFilter> {
  constructor(flags: SearchFlagFilter[]) {
    super("Categories", flags);
  }
}

// Advance search
export abstract class AdvancedTextFilter extends Filter.Text {}
export class TagsFilter extends AdvancedTextFilter {
  constructor() {
    super("Tags");
  }
}
export class ParodiesFilter extends AdvancedTextFilter {
  constructor() {
    super("Parodies");
  }
}
export class ArtistsFilter extends AdvancedTextFilter {
  constructor() {
    super("Artists");
  }
}
export class CharactersFilter extends AdvancedTextFilter {
  constructor() {
    super("Characters");
  }
}
export class GroupsFilter extends AdvancedTextFilter {
  constructor() {
    super("Groups");
  }
}
