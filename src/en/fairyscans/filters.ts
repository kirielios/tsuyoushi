// Port of keiyoushi/extensions-source src/en/fairyscans/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort", ["Latest update", "Popularity", "Rating", "A-Z", "Newest"], { index: 0, ascending: false });
  }
}

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["All", "Ongoing", "Completed", "Hiatus", "Dropped"]);
  }
}

export class TypeFilter extends Filter.Select<string> {
  constructor() {
    super("Type", ["All", "Novel", "Manga", "Manhwa", "Manhua", "Mangatoon"]);
  }
}

export class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genre", ["All genres", "Action", "Adaptation", "Adventure", "Bloody", "Comedy", "Comic", "Demons", "Drama", "Fantasy", "Historical", "Horror", "Isekai", "Josei", "Kids", "Magic", "Manga", "Manhua", "Manhwa", "Mystery", "Novel", "Office workers", "One shot", "Psychological", "Reincarnation", "Revenge", "Romance", "Royal family", "School Life", "Shoujo", "Shounen", "Slice of Life", "Superhero", "Supernatural", "Time travel", "Tragedy", "Transmigration", "Villainess", "Webtoons"]);
  }
}

export const SORT_VALUES = ["latest", "popular", "rating", "az", "newest"];
export const STATUS_VALUES = ["all", "ongoing", "completed", "hiatus", "dropped"];
export const TYPE_VALUES = ["all", "novel", "manga", "manhwa", "manhua", "mangatoon"];
export const GENRE_VALUES = ["", "action", "adaptation", "adventure", "bloody", "comedy", "comic", "demons", "drama", "fantasy", "historical", "horror", "isekai", "josei", "kids", "magic", "manga", "manhua", "manhwa", "mystery", "novel", "office-workers", "one-shot", "psychological", "reincarnation", "revenge", "romance", "royal-family", "school-life", "shoujo", "shounen", "slice-of-life", "superhero", "supernatural", "time-travel", "tragedy", "transmigration", "villainess", "webtoons"];
