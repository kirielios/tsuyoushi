// Port of keiyoushi/extensions-source src/en/spyfakku/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export function getFilters(): FilterList {
  return FilterList(
    new SortFilter("Sort by", { index: 3, ascending: false }, getSortsList),
    new SelectFilter("Per page", getLimits),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new TextFilter("Tags", "tag"),
    new TextFilter("Artists", "artist"),
    new TextFilter("Magazines", "magazine"),
    new TextFilter("Publishers", "publisher"),
    new TextFilter("Parodies", "parody"),
    new TextFilter("Circles", "circle"),
    new TextFilter("Events", "event"),
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
export class SortFilter extends Filter.Sort {
  constructor(
    name: string,
    selection: { index: number; ascending: boolean },
    private readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      selection,
    );
  }
  getValue() {
    return this.vals[this.state!.index][1];
  }
}
export class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: string[],
    state = 2,
  ) {
    super(name, [...vals], state);
  }
}

const getLimits = ["6", "12", "24", "36", "48"];
const getSortsList: [string, string][] = [
  ["Title", "title"],
  ["Relevance", "relevance"],
  ["Date Added", "created_at"],
  ["Date Released", "released_at"],
  ["Pages", "pages"],
  ["Random", "random"],
];
