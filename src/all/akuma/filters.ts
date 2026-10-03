// Port of keiyoushi/extensions-source src/all/akuma/Filters.kt
import { Filter, type FilterList } from "../../../sdk/index.ts";

export function getFilters(): FilterList {
  return [
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new TextFilter("Female Tags", "female"),
    new TextFilter("Male Tags", "male"),
    new TextFilter("Other Tags", "other"),
    new CategoryFilter(),
    new TextFilter("Groups", "group"),
    new TextFilter("Artists", "artist"),
    new TextFilter("Parody", "parody"),
    new TextFilter("Characters", "character"),
    new Filter.Separator(),
    new Filter.Header("Search in favorites, read, or commented"),
    new OptionFilter(),
  ];
}

export class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly tag: string,
  ) {
    super(name);
  }
}
export class OptionFilter extends Filter.Select<string> {
  constructor(readonly value: [string, string][] = options) {
    super(
      "Options",
      options.map((it) => it[0]),
    );
  }
  getValue() {
    return options[this.state][1];
  }
}

export class TagTriState extends Filter.TriState {}
export class CategoryFilter extends Filter.Group<Filter.TriState> {
  constructor() {
    super(
      "Categories",
      categoryList.map((it) => new TagTriState(it)),
    );
  }
}

const categoryList = ["Doujinshi", "Manga", "Image Set", "Artist CG", "Game CG", "Western", "Non-H", "Cosplay", "Misc"];
const options: [string, string][] = [
  ["None", ""],
  ["Favorited only", "favorited"],
  ["Read only", "read"],
  ["Commented only", "commented"],
];
