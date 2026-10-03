// Port of keiyoushi/extensions-source src/en/allanime/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  getValue(): string | undefined {
    return this.options[this.state][1] || undefined;
  }
}

export class SortFilter extends SelectFilter {}

export class CountryFilter extends SelectFilter {}

export class Genre extends Filter.TriState {}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(title: string, genres: string[]) {
    super(
      title,
      genres.map((it) => new Genre(it)),
    );
  }
  get included(): string[] | undefined {
    const l = this.state.filter((it) => it.isIncluded()).map((it) => it.name);
    return l.length ? l : undefined;
  }
  get excluded(): string[] | undefined {
    const l = this.state.filter((it) => it.isExcluded()).map((it) => it.name);
    return l.length ? l : undefined;
  }
}

const sortList: [string, string][] = [
  ["Update", ""],
  ["Name Ascending", "Name_ASC"],
  ["Name Descending", "Name_DESC"],
];

const countryList: [string, string][] = [
  ["All", "ALL"],
  ["Japan", "JP"],
  ["China", "CN"],
  ["Korea", "KR"],
];

export const genreList: string[] = [
  "4 Koma",
  "Action",
  "Adult",
  "Adventure",
  "Cars",
  "Comedy",
  "Cooking",
  "Crossdressing",
  "Dementia",
  "Demons",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Gyaru",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Kids",
  "Loli",
  "Magic",
  "Manhua",
  "Manhwa",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Medical",
  "Military",
  "Monster Girls",
  "Music",
  "Mystery",
  "One Shot",
  "Parody",
  "Police",
  "Post Apocalyptic",
  "Psychological",
  "Reincarnation",
  "Reverse Harem",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shota",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Space",
  "Sports",
  "Super Power",
  "Supernatural",
  "Suspense",
  "Thriller",
  "Tragedy",
  "Unknown",
  "Vampire",
  "Webtoons",
  "Yaoi",
  "Youkai",
  "Yuri",
  "Zombies",
];

export const getFilters = () =>
  FilterList(
    new SortFilter("Sort", sortList),
    new CountryFilter("Countries", countryList),
    new GenreFilter("Genres", genreList),
  );
