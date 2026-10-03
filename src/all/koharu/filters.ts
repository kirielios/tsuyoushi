// Port of keiyoushi/extensions-source src/all/koharu/KoharuFilters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export class Tag {
  constructor(
    readonly id: number,
    readonly name: string,
    readonly namespace: number,
  ) {}
}
export class Genre extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 0);
  }
}
export class Artist extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 1);
  }
}
export class Circle extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 2);
  }
}
export class Parody extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 3);
  }
}
export class Male extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 8);
  }
}
export class Female extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 9);
  }
}
export class Mixed extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 10);
  }
}
export class Other extends Tag {
  constructor(id: number, name: string) {
    super(id, name, 12);
  }
}

/** KoharuFilters' genreList/femaleList/... vars: the bundled KoharuTags until fetchTags replaces them. */
export interface TagLists {
  genreList: Genre[];
  femaleList: Female[];
  maleList: Male[];
  artistList: Artist[];
  circleList: Circle[];
  parodyList: Parody[];
  mixedList: Mixed[];
  otherList: Other[];
}

export function getFilters(lists: TagLists): FilterList {
  return FilterList(
    new SortFilter("Sort by", getSortsList),
    new CategoryFilter("Category"),
    new Filter.Separator(),
    new TagFilter("Tags", lists.genreList),
    new TagFilter("Female Tags", lists.femaleList),
    new TagFilter("Male Tags", lists.maleList),
    new TagFilter("Artists", lists.artistList),
    new TagFilter("Circles", lists.circleList),
    new TagFilter("Parodies", lists.parodyList),
    new TagFilter("Mixed", lists.mixedList),
    new TagFilter("Other", lists.otherList),
    new GenreConditionFilter("Include condition", tagsConditionIncludeFilterOptions, "i"),
    new GenreConditionFilter("Exclude condition", tagsConditionExcludeFilterOptions, "e"),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new TextFilter("Magazines", "magazine"),
    new TextFilter("Publishers", "publisher"),
    new TextFilter("Characters", "character"),
    new TextFilter("Cosplayers", "cosplayer"),
    new Filter.Header("Filter by pages, for example: (>20)"),
    new TextFilter("Pages", "pages"),
  );
}

export class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly type: string,
  ) {
    super(name);
  }
}

export class SortFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      state,
    );
  }
  getValue() {
    return this.vals[this.state][1];
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: number,
    state: boolean,
  ) {
    super(name, state);
  }
}

export class CategoryFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string) {
    super(
      name,
      (
        [
          ["Manga", 2],
          ["Doujinshi", 4],
          ["Illustration", 8],
        ] as const
      ).map(([n, v]) => new CheckBoxFilter(n, v, true)),
    );
  }
}

const getSortsList: [string, string][] = [
  ["Recently Posted", "4"],
  ["Title", "2"],
  ["Pages", "3"],
  ["Most Viewed", "8"],
  ["Most Favorited", "9"],
];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      state,
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class GenreConditionFilter extends UriPartFilter {
  constructor(
    title: string,
    options: [string, string][],
    readonly param: string,
  ) {
    super(title, options);
  }
}

export class TagTriState extends Filter.TriState {
  constructor(
    name: string,
    readonly id: number,
  ) {
    super(name);
  }
}

export class TagFilter extends Filter.Group<TagTriState> {
  constructor(title: string, tags: Tag[]) {
    super(
      title,
      tags.map((it) => new TagTriState(it.name, it.id)),
    );
  }
}

// https://api.schale.network/books?include=<id>,<id>&i=1&exclude=<id>,<id>&e=1
const tagsConditionIncludeFilterOptions: [string, string][] = [
  ["AND", ""],
  ["OR", "1"],
];

const tagsConditionExcludeFilterOptions: [string, string][] = [
  ["OR", ""],
  ["AND", "1"],
];
