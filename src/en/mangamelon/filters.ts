// Port of keiyoushi/extensions-source src/en/mangamelon/Filters.kt
import { Filter } from "../../../sdk/index.ts";

const SORT_OPTIONS = ["Latest", "Hot", "Top Rated", "New"];
const SORT_VALUES = ["latest", "popular", "rating", "newest"];

export class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort", SORT_OPTIONS);
  }
  get value(): string {
    return SORT_VALUES[this.state?.index ?? 0];
  }
}

// "All" is index 0 and maps to an empty genre string; the API filters by exact
// genre only in browse mode (it is ignored when a text search query is present).
const GENRE_OPTIONS = [
  "All",
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gender Bender",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Yaoi",
  "Yuri",
  "Doujinshi",
  "Manhua",
  "Manhwa",
  "Shotacon",
  "Wuxia",
  "Gore",
];

export class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genre", GENRE_OPTIONS);
  }
  get value(): string {
    return this.state === 0 ? "" : GENRE_OPTIONS[this.state];
  }
}
