// Port of keiyoushi/extensions-source src/en/mangabay/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export class GenreItem extends Filter.TriState {
  constructor(
    name: string,
    readonly value: number,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<GenreItem> {
  constructor(values: [string, number][]) {
    super(
      "Genre",
      values.map((it) => new GenreItem(it[0], it[1])),
    );
  }
  addToUrl(builder: HttpUrlBuilder) {
    const included = this.state.filter((it) => it.isIncluded());
    const excluded = this.state.filter((it) => it.isExcluded());
    if (included.length) builder.addEncodedPathSegment("g=" + included.map((it) => String(it.value)).join(","));
    if (excluded.length) builder.addEncodedPathSegment("exc_g=" + excluded.map((it) => String(it.value)).join(","));
  }
}

const sorts: [string, string][] = [
  ["Default", ""],
  ["Date", "date"],
  ["Date of change", "editdate"],
  ["Rating", "rating"],
  ["Read", "news_read"],
  ["Comments", "comm_num"],
  ["Title", "title"],
];

export class SortFilter extends Filter.Sort {
  constructor(select: { index: number; ascending: boolean } = { index: 0, ascending: false }) {
    super(
      "Sort",
      sorts.map((it) => it[0]),
      select,
    );
  }
  getSort = () => sorts[this.state?.index ?? 0][1];
  getDirection = () => (this.state?.ascending === true ? "asc" : "desc");

  static readonly POPULAR_STATE = { index: 3, ascending: false };
  static readonly LATEST_STATE = { index: 1, ascending: false };
}
