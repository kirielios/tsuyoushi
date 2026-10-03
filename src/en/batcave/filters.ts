// Port of keiyoushi/extensions-source src/en/batcave/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export interface UrlPartFilter {
  addFilterToUrl(url: { value: string }): boolean;
}

export class CheckBoxItem extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: number,
  ) {
    super(name);
  }
}

export class CheckBoxFilter extends Filter.Group<CheckBoxItem> implements UrlPartFilter {
  constructor(
    name: string,
    private readonly queryParameter: string,
    values: [string, number][],
  ) {
    super(
      name,
      values.map((it) => new CheckBoxItem(it[0], it[1])),
    );
  }

  addFilterToUrl(url: { value: string }): boolean {
    const checked = this.state.filter((it) => it.state);
    if (checked.length === 0) return false;

    const checkedStr = checked.map((it) => String(it.value)).join(",");
    url.value += `${this.queryParameter}=${checkedStr}/`;
    return true;
  }
}

export class PublisherFilter extends Filter.Group<CheckBoxFilter> implements UrlPartFilter {
  constructor(values: [string, number][]) {
    const groups = new Map<string, [string, number][]>();
    for (const v of values) {
      const c = v[0].length > 0 ? String.fromCodePoint(v[0].codePointAt(0)!).toUpperCase() : null;
      const letter = c === null || !(c >= "A" && c <= "Z") ? "0-9" : c;
      const chunk = groups.get(letter);
      if (chunk) chunk.push(v);
      else groups.set(letter, [v]);
    }
    super(
      "Publisher",
      [...groups].map(([letter, chunk]) => new CheckBoxFilter(letter, "", chunk)),
    );
  }

  addFilterToUrl(url: { value: string }): boolean {
    const selected = this.state.flatMap((child) => child.state.filter((it) => it.state).map((it) => it.value));
    if (selected.length === 0) return false;
    url.value += `p=${selected.join(",")}/`;
    return true;
  }
}

export class GenreFilter extends CheckBoxFilter {
  constructor(values: [string, number][]) {
    super("Genre", "g", values);
  }
}

export class TextBox extends Filter.Text {}

const toIntOrNull = (s: string): number | null => (/^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

export class YearFilter extends Filter.Group<TextBox> implements UrlPartFilter {
  constructor() {
    super("Year of Issue", [new TextBox("from"), new TextBox("to")]);
  }

  addFilterToUrl(url: { value: string }): boolean {
    let applied = false;
    const currentYear = new Date().getFullYear();

    const fromStr = this.state[0].state;
    if (fromStr.trim()) {
      const from = toIntOrNull(fromStr);
      if (from === null) throw new Error("year must be number");
      if (!(from >= 1929 && from <= currentYear)) throw new Error(`invalid start year (must be between 1929 and ${currentYear})`);
      url.value += `y[from]=${from}/`;
      applied = true;
    }

    const toStr = this.state[1].state;
    if (toStr.trim()) {
      const to = toIntOrNull(toStr);
      if (to === null) throw new Error("year must be number");
      if (!(to >= 1929 && to <= currentYear)) throw new Error(`invalid end year (must be between 1929 and ${currentYear})`);
      url.value += `y[to]=${to}/`;
      applied = true;
    }

    return applied;
  }
}

const sorts: [string, string][] = [
  ["Date", "date"],
  ["Date of change", "editdate"],
  ["Rating", "rating"],
  ["Read", "news_read"],
  ["Comments", "comm_num"],
  ["Title", "title"],
];

export class SortFilter extends Filter.Sort {
  constructor(select: { index: number; ascending: boolean } = { index: 2, ascending: false }) {
    super(
      "Sort",
      sorts.map((it) => it[0]),
      select,
    );
  }
  getSort() {
    return sorts[this.state?.index ?? 0][1];
  }
  getDirection() {
    return this.state?.ascending !== false ? "asc" : "desc";
  }
}
