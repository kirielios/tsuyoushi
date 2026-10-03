// Port of keiyoushi/extensions-source src/en/hentairead/HentaiReadFilters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getFilters = (): FilterList =>
  FilterList(
    new SortFilter("Sort by", { index: 0, ascending: false }, getSortsList),
    new TypeFilter("Types"),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude [ Only for 'Tags' ]"),
    new TextFilter("Tags", "manga_tag"),
    new Filter.Separator(),
    new TextFilter("Artists", "artist"),
    new TextFilter("Circles", "circle"),
    new TextFilter("Characters", "character"),
    new TextFilter("Collections", "collection"),
    new TextFilter("Scanlators", "scanlator"),
    new TextFilter("Conventions", "convention"),
    new Filter.Separator(),
    new Filter.Header("Filter by year uploaded, for example: (>2024)"),
    new UploadedFilter("Uploaded"),
    new Filter.Separator(),
    new Filter.Header("Filter by pages, for example: (>20)"),
    new PageFilter("Pages"),
  );

export class UploadedFilter extends Filter.Text {}

export class PageFilter extends Filter.Text {}

export class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly type: string,
  ) {
    super(name);
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
    state: boolean,
  ) {
    super(name, state);
  }
}

export class TypeFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string) {
    super(
      name,
      [
        ["Doujinshi", "4"],
        ["Manga", "52"],
        ["Artist CG", "4798"],
        ["Western", "36278"],
      ].map(([n, v]) => new CheckBoxFilter(n, v, true)),
    );
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

const getSortsList: [string, string][] = [
  ["Latest", "new"],
  ["A-Z", "alphabet"],
  ["Rating", "rating"],
  ["Views", "views"],
];
