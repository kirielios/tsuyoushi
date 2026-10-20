// Port of yuzono/anime-extensions src/all/movy/Filters.kt
import { Filter, type FilterList } from "../../../sdk/index.ts";

export class TypeFilter extends Filter.Select<string> {
  constructor() {
    super("Type", ["All (Movies + TV)", "Movies only", "TV Shows only", "Animes only"]);
  }
}

export const TYPE_ALL = 0;
export const TYPE_MOVIES = 1;
export const TYPE_TV = 2;
export const TYPE_ANIMES = 3;

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Sort", ["Most popular", "Most rating", "Most recent"]);
  }
}

export const SORT_POPULAR = 0;
export const SORT_RATING = 1;
export const SORT_RECENT = 2;

class GenreCheckBox extends Filter.CheckBox {}

export class GenreFilter extends Filter.Group<Filter.CheckBox> {
  constructor(name: string, genres: string[]) {
    super(name, genres.map((g) => new GenreCheckBox(g)));
  }
}

export class WatchProviderCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class WatchProviderFilter extends Filter.Group<WatchProviderCheckBox> {
  constructor() {
    super(
      "Streaming Platforms",
      (
        [
          ["Netflix", "8"],
          ["Disney+", "337"],
          ["Amazon Prime Video", "9"],
          ["Apple TV+", "350"],
          ["Hulu", "15"],
          ["HBO Max", "1899"],
          ["Paramount+", "531"],
          ["Peacock", "386"],
          ["Crunchyroll", "283"],
          ["Starz", "43"],
          ["fuboTV", "257"],
          ["YouTube", "192"],
          ["The Roku Channel", "207"],
          ["Tubi TV", "73"],
          ["Pluto TV", "300"],
          ["VIX", "457"],
          ["HiDive", "430"],
        ] as const
      ).map(([n, id]) => new WatchProviderCheckBox(n, id)),
    );
  }
}

const ALL_GENRES = [
  "Action",
  "Action & Adventure",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Kids",
  "Music",
  "Mystery",
  "News",
  "Reality",
  "Romance",
  "Sci-Fi & Fantasy",
  "Science Fiction",
  "Soap",
  "TV Movie",
  "Talk",
  "Thriller",
  "War",
  "War & Politics",
  "Western",
].sort();

export const MOVIE_GENRE_MAP: Record<string, string> = {
  Action: "28",
  Adventure: "12",
  Animation: "16",
  Comedy: "35",
  Crime: "80",
  Documentary: "99",
  Drama: "18",
  Family: "10751",
  Fantasy: "14",
  History: "36",
  Horror: "27",
  Music: "10402",
  Mystery: "9648",
  Romance: "10749",
  "Science Fiction": "878",
  "TV Movie": "10770",
  Thriller: "53",
  War: "10752",
  Western: "37",
};

export const TV_GENRE_MAP: Record<string, string> = {
  "Action & Adventure": "10759",
  Animation: "16",
  Comedy: "35",
  Crime: "80",
  Documentary: "99",
  Drama: "18",
  Family: "10751",
  Kids: "10762",
  Mystery: "9648",
  News: "10763",
  Reality: "10764",
  "Sci-Fi & Fantasy": "10765",
  Soap: "10766",
  Talk: "10767",
  "War & Politics": "10768",
  Western: "37",
};

export const getFilterList = (): FilterList => [
  new Filter.Header("Type narrows both search (with query) and browse (without)"),
  new Filter.Header("Sort, Genres and Platforms only apply when the search is empty"),
  new TypeFilter(),
  new SortFilter(),
  new GenreFilter("Genres", ALL_GENRES),
  new WatchProviderFilter(),
];
