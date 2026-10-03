// Port of keiyoushi/extensions-source src/en/bbato/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getFilters = (): FilterList => FilterList(new TypeFilter(), new GenreFilter(), new StatusFilter(), new YearFilter(), new MinChapterFilter(), new SortFilter());

export class CheckBoxVal extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class TypeFilter extends Filter.Group<CheckBoxVal> {
  constructor() {
    super("Type", typeList());
  }
}
export class GenreFilter extends Filter.Group<CheckBoxVal> {
  constructor() {
    super("Genre", genreList());
  }
}
export class StatusFilter extends Filter.Group<CheckBoxVal> {
  constructor() {
    super("Status", statusList());
  }
}
export class YearFilter extends Filter.Group<CheckBoxVal> {
  constructor() {
    super("Year", yearList());
  }
}

export class MinChapterFilter extends Filter.Select<string> {
  constructor() {
    super("Length", minChapNames);
  }
  get selectedValue() {
    return minChapValues[this.state];
  }
}

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Sort by", sortNames);
  }
  get selectedValue() {
    return sortValues[this.state];
  }
}

// Fresh checkbox instances per filter list: Kotlin shares them, but here a list's state lives on its instances.
const typeList = () => [
  new CheckBoxVal("Manga", "manga"),
  new CheckBoxVal("One Shot", "one-shot"),
  new CheckBoxVal("Doujinshi", "doujinshi"),
  new CheckBoxVal("Novel", "novel"),
  new CheckBoxVal("Manhwa", "manhwa"),
  new CheckBoxVal("Manhua", "manhua"),
];

const genreList = () => [
  new CheckBoxVal("Action", "action"),
  new CheckBoxVal("Adventure", "adventure"),
  new CheckBoxVal("Avant Garde", "avant-garde"),
  new CheckBoxVal("Boys Love", "boys-love"),
  new CheckBoxVal("Comedy", "comedy"),
  new CheckBoxVal("Demons", "demons"),
  new CheckBoxVal("Drama", "drama"),
  new CheckBoxVal("Ecchi", "ecchi"),
  new CheckBoxVal("Fantasy", "fantasy"),
  new CheckBoxVal("Girls Love", "girls-love"),
  new CheckBoxVal("Gourmet", "gourmet"),
  new CheckBoxVal("Harem", "harem"),
  new CheckBoxVal("Horror", "horror"),
  new CheckBoxVal("Isekai", "isekai"),
  new CheckBoxVal("Iyashikei", "iyashikei"),
  new CheckBoxVal("Josei", "josei"),
  new CheckBoxVal("Kids", "kids"),
  new CheckBoxVal("Magic", "magic"),
  new CheckBoxVal("Mahou Shoujo", "mahou-shoujo"),
  new CheckBoxVal("Martial Arts", "martial-arts"),
  new CheckBoxVal("Mecha", "mecha"),
  new CheckBoxVal("Military", "military"),
  new CheckBoxVal("Music", "music"),
  new CheckBoxVal("Mystery", "mystery"),
  new CheckBoxVal("Parody", "parody"),
  new CheckBoxVal("Psychological", "psychological"),
  new CheckBoxVal("Reverse Harem", "reverse-harem"),
  new CheckBoxVal("Romance", "romance"),
  new CheckBoxVal("School", "school"),
  new CheckBoxVal("Sci-Fi", "sci-fi"),
  new CheckBoxVal("Seinen", "seinen"),
  new CheckBoxVal("Shoujo", "shoujo"),
  new CheckBoxVal("Shounen", "shounen"),
  new CheckBoxVal("Slice of Life", "slice-of-life"),
  new CheckBoxVal("Space", "space"),
  new CheckBoxVal("Sports", "sports"),
  new CheckBoxVal("Super Power", "super-power"),
  new CheckBoxVal("Supernatural", "supernatural"),
  new CheckBoxVal("Suspense", "suspense"),
  new CheckBoxVal("Thriller", "thriller"),
  new CheckBoxVal("Vampire", "vampire"),
];

const statusList = () => [
  new CheckBoxVal("Completed", "completed"),
  new CheckBoxVal("Releasing", "releasing"),
  new CheckBoxVal("On Hiatus", "on_hiatus"),
  new CheckBoxVal("Discontinued", "discontinued"),
  new CheckBoxVal("Not Yet Published", "info"),
];

const currentYear = new Date().getFullYear();

const yearList = () => [
  ...Array.from({ length: currentYear - 2005 + 1 }, (_, i) => String(currentYear - i)).map((it) => new CheckBoxVal(it, it)),
  new CheckBoxVal("2000s", "2000s"),
  new CheckBoxVal("1990s", "1990s"),
  new CheckBoxVal("1980s", "1980s"),
  new CheckBoxVal("1970s", "1970s"),
  new CheckBoxVal("1960s", "1960s"),
  new CheckBoxVal("1950s", "1950s"),
  new CheckBoxVal("1940s", "1940s"),
  new CheckBoxVal("1930s", "1930s"),
];

const minChapNames = ["Any", ">= 1 chapters", ">= 3 chapters", ">= 5 chapters", ">= 10 chapters", ">= 20 chapters", ">= 30 chapters", ">= 50 chapters"];
const minChapValues = ["", "1", "3", "5", "10", "20", "30", "50"];

const sortNames = ["Recently updated", "Recently added", "Release date", "Name A-Z"];
const sortValues = ["recently_updated", "recently_added", "release_date", "title_az"];
