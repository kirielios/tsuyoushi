// Port of keiyoushi/extensions-source src/all/mangadotnet/Filters.kt
import { Filter } from "../../../sdk/index.ts";

const browseOptions: [string, string][] = [
  ["None", ""],
  ["Most Tracked", "most-tracked"],
  ["Top Rated", "top-rated"],
  ["Latest Updates", "latest-updates"],
  ["Recently Added", "recently-added"],
  ["Bookmarks", "bookmarks"],
];

export class BrowseFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Browse",
      browseOptions.map((it) => it[0]),
    );
  }
  get selected() {
    return browseOptions[this.state][1];
  }
}

const sortOrders: [string, string][] = [
  ["Relevance", ""],
  ["Latest Update", "latest"],
  ["Alphabetical", "alphabetical"],
  ["Total Chapters", "chapters"],
  ["Most Viewed", "views"],
  ["Most Tracked", "tracked"],
  ["Top Rated", "rating"],
];

export class SortFilter extends Filter.Sort {
  constructor() {
    super(
      "Sort",
      sortOrders.map((it) => it[0]),
      { index: 0, ascending: false },
    );
  }
  get sort() {
    return sortOrders[this.state?.index ?? 0][1];
  }
  get ascending() {
    return this.state?.ascending ?? false;
  }
}

abstract class OptionSelect<V> extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, V][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected(): V {
    return this.options[this.state][1];
  }
}

export class StatusFilter extends OptionSelect<string | null> {
  constructor() {
    super("Status", [
      ["Any Status", null],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
      ["Hiatus", "Hiatus"],
    ]);
  }
}

export class VolumesFilter extends OptionSelect<string> {
  constructor() {
    super("Volumes", [
      ["Any", ""],
      ["Has Volumes", "1"],
      ["No Volumes", "0"],
    ]);
  }
}

export class ScanlatorFilter extends OptionSelect<string> {
  constructor() {
    super("Scanlator Group", [
      ["Any", ""],
      ["Scanlator Group", "1"],
      ["No Scanlator Group", "0"],
    ]);
  }
}

export class LibraryFilter extends OptionSelect<string> {
  constructor() {
    super("Library", [
      ["Any", ""],
      ["In Library", "in"],
      ["Not In Library", "out"],
    ]);
  }
}

export class MinRatingFilter extends OptionSelect<string> {
  constructor() {
    super("Minimum Rating", [["Any", ""], ...Array.from({ length: 9 }, (_, i): [string, string] => [`★ ${i + 1}+`, String(i + 1)])]);
  }
}

export class TypeCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

const types: [string, string][] = [
  ["Manga", "JP"],
  ["Manhwa", "KR"],
  ["Manhua", "CN"],
  ["OEL", "EN"],
  ["One Shot", "ONESHOT"],
];

export class TypeFilter extends Filter.Group<TypeCheckBox> {
  constructor() {
    super(
      "Types",
      types.map(([n, v]) => new TypeCheckBox(n, v)),
    );
  }
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export const contentRatings: [string, string][] = [
  ["Safe", "safe"],
  ["Suggestive", "suggestive"],
  ["Erotica", "erotica"],
  ["Pornographic", "pornographic"],
];

export class TriStateFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string = name,
    state: number = Filter.TriState.STATE_IGNORE,
  ) {
    super(name, state);
  }
}

abstract class TriStateGroup extends Filter.Group<TriStateFilter> {
  get included() {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded() {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

const stateFor = (value: string, excluded: string[]) => (excluded.includes(value) ? Filter.TriState.STATE_EXCLUDE : Filter.TriState.STATE_IGNORE);

export class ContentRatingFilter extends TriStateGroup {
  constructor(excluded: string[] = []) {
    super(
      "Content Rating",
      contentRatings.map(([name, value]) => new TriStateFilter(name, value, stateFor(value, excluded))),
    );
  }
}

const demographics = ["Josei", "Seinen", "Shoujo", "Shounen"];

export class DemographicFilter extends TriStateGroup {
  constructor(excluded: string[] = []) {
    super(
      "Demographics",
      demographics.map((demo) => new TriStateFilter(demo, demo, stateFor(demo, excluded))),
    );
  }
}

export class GenreFilter extends TriStateGroup {
  constructor(genreValues: string[], excluded: string[]) {
    super(
      "Genres",
      genreValues.map((genre) => new TriStateFilter(genre, genre, stateFor(genre, excluded))),
    );
  }
}

export class TagFilter extends TriStateGroup {
  constructor(name: string, tagValues: string[], excluded: string[] = []) {
    super(
      name,
      tagValues.map((tag) => new TriStateFilter(tag, tag, stateFor(tag, excluded))),
    );
  }
}

export class TagsGroupFilter extends Filter.Group<TagFilter> {
  constructor(state: TagFilter[]) {
    super("Tags", state);
  }
}

export class MinChaptersFilter extends Filter.Text {
  constructor() {
    super("Minimum Chapters");
  }
}

export class MinYearFilter extends Filter.Text {
  constructor() {
    super("Minimum Year");
  }
}

export class MaxYearFilter extends Filter.Text {
  constructor() {
    super("Maximum Year");
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
