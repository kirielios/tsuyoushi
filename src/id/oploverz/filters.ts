// Port of yuzono/anime-extensions src/id/oploverz/OploverzFilters.kt
import { Filter, firstInstanceOrNull, type FilterList } from "../../../sdk/index.ts";

const GENRE_LIST: [string, string][] = [
  ["+18", "18"],
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Cars", "cars"],
  ["Comedy", "comedy"],
  ["Crime", "crime"],
  ["Demons", "demons"],
  ["Donghua", "donghua"],
  ["Drama", "drama"],
  ["Drive", "drive"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Game", "game"],
  ["Gore", "gore"],
  ["Gourmet", "gourmet"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Live Action", "live-action"],
  ["Magic", "magic"],
  ["Martial Arts", "martial-arts"],
  ["Mecha", "mecha"],
  ["Medical", "medical"],
  ["Military", "military"],
  ["Music", "music"],
  ["Mystery", "mystery"],
  ["Mythology", "mythology"],
  ["OLM", "olm"],
  ["Parody", "parody"],
  ["Police", "police"],
  ["Psychological", "psychological"],
  ["Racing", "racing"],
  ["Reincarnation", "reincarnation"],
  ["Romance", "romance"],
  ["Samurai", "samurai"],
  ["School", "school"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shounen", "shounen"],
  ["Showbiz", "showbiz"],
  ["Slice of Life", "slice-of-life"],
  ["Space", "space"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Super Power", "super-power"],
  ["Survival", "survival"],
  ["Suspense", "suspense"],
  ["Thriller", "thriller"],
  ["Vampire", "vampire"],
  ["Zero-G", "zero-g"],
];

export class GenreFilter extends Filter.Group<Filter.CheckBox> {
  constructor() {
    super(
      "Genre",
      GENRE_LIST.map(([name]) => new Filter.CheckBox(name)),
    );
  }
}

export const FILTER_LIST = (): FilterList => [new GenreFilter()];

export const getGenreParam = (filters: FilterList): string =>
  (firstInstanceOrNull(filters, GenreFilter)?.state ?? [])
    .filter((it) => it.state)
    .flatMap((checkbox) => GENRE_LIST.find((it) => it[0] === checkbox.name)?.[1] ?? [])
    .join(",");
