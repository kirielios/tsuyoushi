// Port of keiyoushi/extensions-source src/all/lunaranime/LunarAnimeFilters.kt
import { Filter } from "../../../sdk/index.ts";

type Option = [string, string | null];

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Status",
      STATUS_OPTIONS.map((it) => it[0]),
    );
  }
  toValue = (): string | null => STATUS_OPTIONS[this.state][1];
}

export class TypeFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Type",
      TYPE_OPTIONS.map((it) => it[0]),
    );
  }
  toValue = (): string | null => TYPE_OPTIONS[this.state][1];
}

export class LanguageFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Language",
      LANG_OPTIONS.map((it) => it[0]),
    );
  }
  toValue = (): string | null => LANG_OPTIONS[this.state][1];
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year");
  }
}

export class GenreOption extends Filter.CheckBox {}

export class GenreFilter extends Filter.Group<GenreOption> {
  constructor() {
    super(
      "Genres",
      GENRE_OPTIONS.map((it) => new GenreOption(it)),
    );
  }
  toGenres = (): string[] =>
    this.state.filter((it) => it.state).map((it) => it.name);
}

const STATUS_OPTIONS: Option[] = [
  ["Any", null],
  ["Ongoing", "ongoing"],
  ["Completed", "completed"],
  ["Upcoming", "upcoming"],
  ["Hiatus", "hiatus"],
  ["Cancelled", "cancelled"],
];

const TYPE_OPTIONS: Option[] = [
  ["Any", null],
  ["Manga", "JP"],
  ["Manhwa", "KR"],
  ["Manhua", "CN"],
];

const LANG_OPTIONS: Option[] = [
  ["Any", null],
  ["English", "en"],
  ["Arabic", "ar"],
  ["Spanish", "es"],
  ["Spanish (Latin America)", "es-419"],
  ["French", "fr"],
  ["Italian", "it"],
  ["Polish", "pl"],
  ["Portuguese (Brazil)", "pt-br"],
  ["German", "de"],
  ["Japanese", "ja"],
  ["Korean", "ko"],
  ["Chinese", "zh"],
  ["Russian", "ru"],
  ["Turkish", "tr"],
  ["Thai", "th"],
  ["Vietnamese", "vi"],
  ["Indonesian", "id"],
  ["Malay", "ms"],
  ["Tagalog", "tl"],
  ["Hindi", "hi"],
  ["Bengali", "bn"],
  ["Urdu", "ur"],
  ["Persian", "fa"],
  ["Hebrew", "he"],
  ["Dutch", "nl"],
  ["Swedish", "sv"],
  ["Norwegian", "no"],
  ["Danish", "da"],
  ["Finnish", "fi"],
  ["Portuguese (Portugal)", "pt"],
  ["Bulgarian", "bg"],
];

const GENRE_OPTIONS: string[] = [
  "Action",
  "Adventure",
  "Boys' Love",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Girls' Love",
  "Horror",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Supernatural",
  "Thriller",
  "Mystery",
  "Psychological",
  "Sports",
  "Music",
  "Josei",
  "Seinen",
  "Shoujo",
  "Shounen",
];
