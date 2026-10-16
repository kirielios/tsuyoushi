// Port of yuzono/anime-extensions src/id/samehadaku/SamehadakuFilters.kt
import { Filter, FilterList, firstInstanceOrNull } from "../../../sdk/index.ts";

class QueryPartFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
    );
  }
  toQueryPart(param: string) {
    return `&${param}=${encodeURIComponent(this.vals[this.state][1])}`;
  }
}

class GenreFilter extends Filter.Group<Filter.CheckBox> {
  constructor() {
    super(
      "Genre",
      GENRE.map(([name]) => new Filter.CheckBox(name)),
    );
  }
}
class TypeFilter extends QueryPartFilter {
  constructor() {
    super("Type", TYPE);
  }
}
class StatusFilter extends QueryPartFilter {
  constructor() {
    super("Status", STATUS);
  }
}
class OrderFilter extends QueryPartFilter {
  constructor() {
    super("Sort By", ORDER);
  }
}

export const getFilterList = (): FilterList => FilterList(new Filter.Header("Ignored With Text Search!!"), new GenreFilter(), new TypeFilter(), new StatusFilter(), new OrderFilter());

export function getSearchParameters(filters: FilterList): string {
  if (!filters.length) return "";
  const genres = (firstInstanceOrNull(filters, GenreFilter)?.state ?? [])
    .filter((it) => it.state)
    .map((it) => `&genre[]=${GENRE.find((g) => g[0] === it.name)![1]}`)
    .join("");
  const part = (cls: typeof TypeFilter, param: string) => firstInstanceOrNull(filters, cls)?.toQueryPart(param) ?? "";
  return genres + part(TypeFilter, "type") + part(StatusFilter, "status") + part(OrderFilter, "order");
}

const ORDER: [string, string][] = [
  ["A-Z", "title"],
  ["Z-A", "titlereverse"],
  ["Latest Update", "update"],
  ["Latest Added", "latest"],
  ["Popular", "popular"],
];

const STATUS: [string, string][] = [
  ["All", ""],
  ["Currently Airing", "Currently Airing"],
  ["Finished Airing", "Finished Airing"],
];

const TYPE: [string, string][] = [
  ["All", ""],
  ["TV", "TV"],
  ["OVA", "OVA"],
  ["ONA", "ONA"],
  ["Special", "Special"],
  ["Movie", "Movie"],
];

const GENRE: [string, string][] = [
  ["Fantasy", "fantasy"],
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Shounen", "shounen"],
  ["School", "school"],
  ["Romance", "romance"],
  ["Drama", "drama"],
  ["Supernatural", "supernatural"],
  ["Isekai", "isekai"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Reincarnation", "reincarnation"],
  ["Historical", "historical"],
  ["Mystery", "mystery"],
  ["Super Power", "super-power"],
  ["Harem", "harem"],
  ["Slice of Life", "slice-of-life"],
  ["Ecchi", "ecchi"],
  ["Sports", "sports"],
];
