// Port of keiyoushi/extensions-source src/all/luscious/LusciousFilters.kt
import { Filter as MFilter, FilterList } from "../../../sdk/index.ts";

export const FILTER_VALUE_IGNORE = "<ignore>";

/** The GraphQL `Filter` DTO (LusciousDTO.kt). */
export interface Filter {
  name: string;
  value: string;
}

export function toLusLang(lang: string): string {
  switch (lang) {
    case "all":
      return FILTER_VALUE_IGNORE;
    case "en":
      return "1";
    case "ja":
      return "2";
    case "es":
      return "3";
    case "it":
      return "4";
    case "de":
      return "5";
    case "fr":
      return "6";
    case "zh":
      return "8";
    case "ko":
      return "9";
    case "pt-BR":
      return "100";
    case "th":
      return "101";
    default:
      return "99";
  }
}

export class TriStateFilterOption extends MFilter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}
export abstract class TriStateGroupFilter extends MFilter.Group<TriStateFilterOption> {
  private get included(): string[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  private get excluded(): string[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
  anyNotIgnored(): boolean {
    return this.state.some((it) => !it.isIgnored());
  }
  override toString(): string {
    return [...this.included.map((it) => `+${it}`), ...this.excluded.map((it) => `-${it}`)].join("");
  }
}

/** Filter<*>.toJsonObject(key) */
export const toJsonObject = (filter: MFilter, key: string): Filter => ({ name: key, value: filter.toString() });

export class TextFilter extends MFilter.Text {}

export class GenreGroupFilter extends TriStateGroupFilter {
  constructor(filters: TriStateFilterOption[]) {
    super("Genres", filters);
  }
}

export class CheckboxFilterOption extends MFilter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
    def = true,
  ) {
    super(name, def);
  }
}

export abstract class CheckboxGroupFilter extends MFilter.Group<CheckboxFilterOption> {
  get selected(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
  override toString(): string {
    return this.selected.map((it) => `+${it}`).join("");
  }
}

export class InterestGroupFilter extends CheckboxGroupFilter {
  constructor(options: CheckboxFilterOption[]) {
    super("Interests", options);
  }
}
export class LanguageGroupFilter extends CheckboxGroupFilter {
  constructor(options: CheckboxFilterOption[]) {
    super("Languages", options);
  }
}

export class SelectFilterOption {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {}
}

export abstract class SelectFilter extends MFilter.Select {
  constructor(
    name: string,
    private readonly options: SelectFilterOption[],
    def = 0,
  ) {
    super(
      name,
      options.map((it) => it.name),
      def,
    );
  }
  get selected(): string {
    return this.options[this.state].value;
  }
  override toString(): string {
    return this.selected;
  }
}

export class SortBySelectFilter extends SelectFilter {
  constructor(options: SelectFilterOption[], def: number) {
    super("Sort By", options, def);
  }
}
export class AlbumTypeSelectFilter extends SelectFilter {
  constructor(options: SelectFilterOption[]) {
    super("Album Type", options);
  }
}
export class ContentTypeSelectFilter extends SelectFilter {
  constructor(options: SelectFilterOption[]) {
    super("Content Type", options);
  }
}
export class RestrictGenresSelectFilter extends SelectFilter {
  constructor(options: SelectFilterOption[]) {
    super("Restrict Genres", options);
  }
}
export class SelectionSelectFilter extends SelectFilter {
  constructor(options: SelectFilterOption[]) {
    super("Selection", options);
  }
}
export class AlbumSizeSelectFilter extends SelectFilter {
  constructor(options: SelectFilterOption[]) {
    super("Album Size", options);
  }
}
export class TagTextFilters extends TextFilter {
  constructor() {
    super("Tags");
  }
}
export class CreatorTextFilters extends TextFilter {
  constructor() {
    super("Uploader");
  }
}
export class FavoriteTextFilters extends TextFilter {
  constructor() {
    super("Favorite by User");
  }
}

export const getSortFilters = (sortState: number, lusLang: string) =>
  FilterList(
    new SortBySelectFilter(getSortOptions(), sortState),
    new AlbumTypeSelectFilter(getAlbumTypeFilters()),
    new ContentTypeSelectFilter(getContentTypeFilters()),
    new AlbumSizeSelectFilter(getAlbumSizeFilters()),
    new SelectionSelectFilter(getSelectionFilters()),
    new RestrictGenresSelectFilter(getRestrictGenresFilters()),
    new InterestGroupFilter(getInterestFilters()),
    new LanguageGroupFilter(getLanguageFilters(lusLang)),
    new GenreGroupFilter(getGenreFilters()),
    new MFilter.Header("Separate tags with commas (,)"),
    new MFilter.Header("Prepend with dash (-) to exclude"),
    new TagTextFilters(),
    new MFilter.Header("The following require username or ID"),
    new CreatorTextFilters(),
    new FavoriteTextFilters(),
  );

/** Kotlin's no-arg getSortFilters() overload. */
function getSortOptions(): SelectFilterOption[] {
  const sortOptions = [
    new SelectFilterOption("Rating - All Time", "rating_all_time"),
    new SelectFilterOption("Rating - Last 7 Days", "rating_7_days"),
    new SelectFilterOption("Rating - Last 14 Days", "rating_14_days"),
    new SelectFilterOption("Rating - Last 30 Days", "rating_30_days"),
    new SelectFilterOption("Rating - Last 90 Days", "rating_90_days"),
    new SelectFilterOption("Rating - Last Year", "rating_1_year"),
    new SelectFilterOption("Date - Newest First", "date_newest"),
    new SelectFilterOption("Date - Oldest First", "date_oldest"),
    new SelectFilterOption("Date - Upcoming", "date_upcoming"),
    new SelectFilterOption("Date - Trending", "date_trending"),
    new SelectFilterOption("Date - Featured", "date_featured"),
    new SelectFilterOption("Date - Last Viewed", "date_last_interaction"),
    new SelectFilterOption("Other - Search Score", "search_score"),
  ];
  for (const it of validYears()) sortOptions.push(new SelectFilterOption(`Date - ${it}`, `date_${it}`));
  sortOptions.push(new SelectFilterOption("First Letter - Any", "alpha_any"));
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") sortOptions.push(new SelectFilterOption(`First Letter - ${c}`, `alpha_${c.toLowerCase()}`));
  return sortOptions;
}

const getAlbumTypeFilters = () => [new SelectFilterOption("All", FILTER_VALUE_IGNORE), new SelectFilterOption("Manga", "manga"), new SelectFilterOption("Pictures", "pictures")];

const getRestrictGenresFilters = () => [new SelectFilterOption("None", FILTER_VALUE_IGNORE), new SelectFilterOption("Loose", "loose"), new SelectFilterOption("Strict", "strict")];

const getSelectionFilters = () => [
  new SelectFilterOption("All", "all"),
  new SelectFilterOption("No Votes", "not_voted"),
  new SelectFilterOption("Downvoted", "downvoted"),
  new SelectFilterOption("Animated", "animated"),
  new SelectFilterOption("Banned", "banned"),
  new SelectFilterOption("Made by People You Follow", "made_by_following"),
  new SelectFilterOption("Faved by People You Follow", "faved_by_following"),
];

const getContentTypeFilters = () => [
  new SelectFilterOption("All", FILTER_VALUE_IGNORE),
  new SelectFilterOption("Hentai", "2"),
  new SelectFilterOption("Non-Erotic", "5"),
  new SelectFilterOption("Real People", "6"),
];

const getAlbumSizeFilters = () => [
  new SelectFilterOption("All", FILTER_VALUE_IGNORE),
  new SelectFilterOption("0-25", "0"),
  new SelectFilterOption("0-50", "1"),
  new SelectFilterOption("50-100", "2"),
  new SelectFilterOption("100-200", "3"),
  new SelectFilterOption("200-800", "4"),
  new SelectFilterOption("800-3200", "5"),
  new SelectFilterOption("3200-12800", "6"),
];

const getInterestFilters = () => [
  new CheckboxFilterOption("Straight Sex", "1"),
  new CheckboxFilterOption("Trans x Girl", "10"),
  new CheckboxFilterOption("Gay / Yaoi", "2"),
  new CheckboxFilterOption("Lesbian / Yuri", "3"),
  new CheckboxFilterOption("Trans", "5"),
  new CheckboxFilterOption("Solo Girl", "6"),
  new CheckboxFilterOption("Trans x Trans", "8"),
  new CheckboxFilterOption("Trans x Guy", "9"),
];

const getLanguageFilters = (lusLang: string) =>
  [
    new CheckboxFilterOption("English", toLusLang("en"), false),
    new CheckboxFilterOption("Japanese", toLusLang("ja"), false),
    new CheckboxFilterOption("Spanish", toLusLang("es"), false),
    new CheckboxFilterOption("Italian", toLusLang("it"), false),
    new CheckboxFilterOption("German", toLusLang("de"), false),
    new CheckboxFilterOption("French", toLusLang("fr"), false),
    new CheckboxFilterOption("Chinese", toLusLang("zh"), false),
    new CheckboxFilterOption("Korean", toLusLang("ko"), false),
    new CheckboxFilterOption("Others", toLusLang("other"), false),
    new CheckboxFilterOption("Portuguese", toLusLang("pt-BR"), false),
    new CheckboxFilterOption("Thai", toLusLang("th"), false),
  ].filter((it) => it.value !== lusLang);

const getGenreFilters = () => [
  new TriStateFilterOption("3D / Digital Art", "25"),
  new TriStateFilterOption("Amateurs", "20"),
  new TriStateFilterOption("Artist Collection", "19"),
  new TriStateFilterOption("Asian Girls", "12"),
  new TriStateFilterOption("BDSM", "27"),
  new TriStateFilterOption("Bestiality Hentai", "5"),
  new TriStateFilterOption("Casting", "44"),
  new TriStateFilterOption("Celebrity Fakes", "16"),
  new TriStateFilterOption("Cosplay", "22"),
  new TriStateFilterOption("Cross-Dressing", "30"),
  new TriStateFilterOption("Cumshot", "26"),
  new TriStateFilterOption("Defloration / First Time", "59"),
  new TriStateFilterOption("Ebony Girls", "32"),
  new TriStateFilterOption("European Girls", "46"),
  new TriStateFilterOption("Extreme Gore", "60"),
  new TriStateFilterOption("Extreme Scat", "61"),
  new TriStateFilterOption("Fantasy / Monster Girls", "10"),
  new TriStateFilterOption("Fetish", "2"),
  new TriStateFilterOption("Furries", "8"),
  new TriStateFilterOption("Futanari", "31"),
  new TriStateFilterOption("Group Sex", "36"),
  new TriStateFilterOption("Harem", "56"),
  new TriStateFilterOption("Humor", "41"),
  new TriStateFilterOption("Incest", "24"),
  new TriStateFilterOption("Interracial", "28"),
  new TriStateFilterOption("Kemonomimi / Animal Ears", "39"),
  new TriStateFilterOption("Latina Girls", "33"),
  new TriStateFilterOption("Lolicon", "3"),
  new TriStateFilterOption("Mature", "13"),
  new TriStateFilterOption("Members: Original Art", "18"),
  new TriStateFilterOption("Members: Verified Selfies", "21"),
  new TriStateFilterOption("Military", "48"),
  new TriStateFilterOption("Mind Control", "34"),
  new TriStateFilterOption("Monsters & Tentacles", "38"),
  new TriStateFilterOption("Music", "45"),
  new TriStateFilterOption("Netorare / Cheating", "40"),
  new TriStateFilterOption("No Genre Given", "1"),
  new TriStateFilterOption("Nonconsent / Reluctance", "37"),
  new TriStateFilterOption("Other Ethnicity Girls", "57"),
  new TriStateFilterOption("Private to Luscious", "55"),
  new TriStateFilterOption("Public Sex", "43"),
  new TriStateFilterOption("Romance", "42"),
  new TriStateFilterOption("School / College", "35"),
  new TriStateFilterOption("Sex Workers", "47"),
  new TriStateFilterOption("SFW", "23"),
  new TriStateFilterOption("Shotacon", "4"),
  new TriStateFilterOption("Softcore / Ecchi", "9"),
  new TriStateFilterOption("Superheroes", "17"),
  new TriStateFilterOption("Swimsuit", "49"),
  new TriStateFilterOption("Tankōbon", "45"),
  new TriStateFilterOption("Trans", "14"),
  new TriStateFilterOption("TV / Movies", "51"),
  new TriStateFilterOption("Video Games", "15"),
  new TriStateFilterOption("Vintage", "58"),
  new TriStateFilterOption("Western", "11"),
  new TriStateFilterOption("Workplace Sex", "50"),
];

/** findInstance<T>() */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const findInstance = <T>(filters: MFilter[], cls: abstract new (...args: any[]) => T): T | null => (filters.find((it) => it instanceof cls) as T | undefined) ?? null;

function validYears(): number[] {
  const years: number[] = [];
  const currentYear = new Date().getFullYear();
  for (let firstYear = 2013; currentYear !== firstYear - 1; firstYear++) years.push(firstYear);
  return years.reverse();
}
