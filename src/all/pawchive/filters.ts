// Port of keiyoushi/extensions-source src/all/pawchive/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getTypes = ["Patreon", "Pixiv Fanbox"];

export const getSortsList: [string, string][] = [
  ["Popularity", "pop"],
  ["Date Indexed", "new"],
  ["Date Updated", "lat"],
  ["Alphabetical Order", "tit"],
  ["Service", "serv"],
  ["Date Favorited", "fav"],
];

export class TriFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class TypeFilter extends Filter.Group<TriFilter> {
  constructor(name: string, vals: string[]) {
    super(
      name,
      vals.map((it) => new TriFilter(it, it.toLowerCase())),
    );
  }
}

export class FavoritesFilter extends Filter.Group<TriFilter> {
  constructor() {
    super("Favorites", [new TriFilter("Favorites Only", "fav")]);
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
  getValue = () => this.vals[this.state!.index][1];
}

export const getLatestUpdatesFilterList = (): FilterList =>
  FilterList(new SortFilter("Sort by", { index: 2, ascending: false }, getSortsList), new TypeFilter("Types", getTypes), new FavoritesFilter());

export const getDefaultFilterList = (): FilterList =>
  FilterList(new SortFilter("Sort by", { index: 0, ascending: false }, getSortsList), new TypeFilter("Types", getTypes), new FavoritesFilter());
