// Port of keiyoushi/extensions-source src/en/mangalix/Filters.kt
import { Filter } from "../../../sdk/index.ts";

const STATUS_OPTIONS: [string, string][] = [
  ["All", ""],
  ["Ongoing", "ongoing"],
  ["Completed", "completed"],
  ["Hiatus", "hiatus"],
];

export class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", STATUS_OPTIONS.map((it) => it[0]));
  }
  get selected(): string | null {
    return STATUS_OPTIONS[this.state][1] || null;
  }
  matches(status: string): boolean {
    const s = this.selected;
    return s != null ? normalizedStatus(status) === s : true;
  }
}

const SORT_OPTIONS: [string, string][] = [
  ["Default", "default"],
  ["Latest Update", "latest"],
  ["Release Year", "release_year"],
  ["Rating", "rating"],
  ["Title", "title"],
];

export class SortFilter extends Filter.Sort {
  static readonly DEFAULT = "default";
  static readonly LATEST = "latest";
  static readonly RATING = "rating";
  static readonly TITLE = "title";
  static readonly RELEASE_YEAR = "release_year";

  constructor(selection: { index: number; ascending: boolean } = { index: 0, ascending: false }) {
    super("Sort By", SORT_OPTIONS.map((it) => it[0]), selection);
  }
  get selected(): string {
    return SORT_OPTIONS[this.state?.index ?? 0][1];
  }
  get ascending(): boolean {
    return this.state?.ascending ?? false;
  }
}

const GENRES = [
      "4-Koma",
      "Action",
      "Adventure",
      "Comedy",
      "Dark Fantasy",
      "Drama",
      "Ecchi",
      "Family",
      "Fantasy",
      "Harem",
      "Historical",
      "Horror",
      "Isekai",
      "Magic",
      "Manhwa",
      "Martial Arts",
      "Mature",
      "Mecha",
      "Military",
      "Murim",
      "Mystery",
      "Parody",
      "Psychological",
      "Regression",
      "Reincarnation",
      "Romance",
      "School Life",
      "Sci-Fi",
      "Seinen",
      "Shoujo",
      "Shounen",
      "Slice of Life",
      "Sports",
      "Supernatural",
      "Survival",
      "System",
      "Thriller",
      "Tragedy",
      "Vampire",
      "Webtoon",
];

export class GenreOption extends Filter.CheckBox {}

export class GenreFilter extends Filter.Group<GenreOption> {
  constructor() {
    super("Genres", GENRES.map((it) => new GenreOption(it)));
  }
  get selectedGenres(): Set<string> {
    return new Set(this.state.filter((it) => it.state).map((it) => it.name));
  }
  matches(genres: string[]): boolean {
    const selected = new Set([...this.selectedGenres].map(normalizedGenre));
    if (selected.size === 0) return true;

    const available = new Set(genres.map(normalizedGenre));
    return [...selected].every((it) => available.has(it));
  }
}

function normalizedStatus(s: string): string {
  switch (normalizedKey(s)) {
    case "ongoing":
    case "publishing":
    case "releasing":
    case "active":
      return "ongoing";
    case "completed":
    case "complete":
    case "finished":
      return "completed";
    case "hiatus":
    case "onhiatus":
    case "paused":
      return "hiatus";
    default:
      return normalizedKey(s);
  }
}

function normalizedGenre(s: string): string {
  const value = normalizedKey(s);
  switch (value) {
    case "school":
      return "schoollife";
    case "shojo":
      return "shoujo";
    case "shonen":
      return "shounen";
    case "webtoons":
      return "webtoon";
    default:
      return value;
  }
}

const normalizedKey = (s: string): string => [...s.toLowerCase()].filter((c) => /[\p{L}\p{Nd}]/u.test(c)).join("");
