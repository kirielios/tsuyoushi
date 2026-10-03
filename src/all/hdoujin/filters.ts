// Port of keiyoushi/extensions-source src/all/hdoujin/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

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
        ] as [string, number][]
      ).map((it) => new CheckBoxFilter(it[0], it[1], true)),
    );
  }
}

export class TagType extends Filter.Select<string> {
  constructor(
    title: string,
    readonly type: string,
  ) {
    super(title, ["AND", "OR"]);
  }
}

export class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly type: string,
  ) {
    super(name);
  }
}

export class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: [string, string][],
    state = 2,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      state,
    );
  }
  get selected(): string | null {
    return this.vals[this.state][1] || null;
  }
}

const getSortsList: [string, string][] = [
  ["Title", "2"],
  ["Pages", "3"],
  ["Date", ""],
  ["Views", "8"],
  ["Favourites", "9"],
  ["Popular This Week", "popular"],
];

export const getFilters = (): FilterList =>
  FilterList(
    new SelectFilter("Sort by", getSortsList),
    new CategoryFilter("Categories"),
    new Filter.Separator(),
    new TagType("Tags Include Type", "i"),
    new TagType("Tags Exclude Type", "e"),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new TextFilter("Tags", "tag"),
    new TextFilter("Male Tags", "male"),
    new TextFilter("Female Tags", "female"),
    new TextFilter("Mixed Tags", "mixed"),
    new TextFilter("Other Tags", "other"),
    new Filter.Separator(),
    new TextFilter("Artists", "artist"),
    new TextFilter("Parodies", "parody"),
    new TextFilter("Characters", "character"),
    new Filter.Separator(),
    new TextFilter("Uploader", "reason"),
    new TextFilter("Circles", "circle"),
    new TextFilter("Languages", "language"),
    new Filter.Separator(),
    new Filter.Header("Filter by pages, for example: (>20)"),
    new TextFilter("Pages", "pages"),
  );
