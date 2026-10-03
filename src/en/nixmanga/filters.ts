// Port of keiyoushi/extensions-source src/en/nixmanga/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart = () => this.vals[this.state][1];
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["Any", ""],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Webtoons", "webtoon"],
      ["Pornhwa", "pornhwa"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["Any", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Cancelled", "cancelled"],
    ]);
  }
}

export class DemographicFilter extends UriPartFilter {
  constructor() {
    super("Demographic", [
      ["Any", ""],
      ["Shounen", "shounen"],
      ["Shoujo", "shoujo"],
      ["Seinen", "seinen"],
      ["Josei", "josei"],
    ]);
  }
}

export class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort", ["Latest Upload", "Most Popular", "Top Rated", "Alphabetical", "Most Chapters", "Oldest"], { index: 0, ascending: false });
  }
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year");
  }
}

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export const getGenreList = () => [
  new Genre("Action", "action"),
  new Genre("Adult", "adult"),
  new Genre("Adventure", "adventure"),
  new Genre("Aliens", "aliens"),
  new Genre("Animals", "animals"),
  new Genre("Boys Love", "boys-love"),
  new Genre("Comedy", "comedy"),
  new Genre("Cooking", "cooking"),
  new Genre("Crime", "crime"),
  new Genre("Crossdressing", "crossdressing"),
  new Genre("Delinquents", "delinquents"),
  new Genre("Demons", "demons"),
  new Genre("Drama", "drama"),
  new Genre("Ecchi", "ecchi"),
  new Genre("Fantasy", "fantasy"),
  new Genre("Genderswap", "genderswap"),
  new Genre("Ghosts", "ghosts"),
  new Genre("Girls Love", "girls-love"),
  new Genre("Gyaru", "gyaru"),
  new Genre("Harem", "harem"),
  new Genre("Hentai", "hentai"),
  new Genre("Historical", "historical"),
  new Genre("Horror", "horror"),
  new Genre("Incest", "incest"),
  new Genre("Isekai", "isekai"),
  new Genre("Josei", "josei"),
  new Genre("Loli", "loli"),
  new Genre("Mafia", "mafia"),
  new Genre("Magic", "magic"),
  new Genre("Magical Girls", "magical-girls"),
  new Genre("Martial Arts", "martial-arts"),
  new Genre("Mature", "mature"),
  new Genre("Mecha", "mecha"),
  new Genre("Medical", "medical"),
  new Genre("Military", "military"),
  new Genre("Monster Girls", "monster-girls"),
  new Genre("Monsters", "monsters"),
  new Genre("Music", "music"),
  new Genre("Mystery", "mystery"),
  new Genre("Ninja", "ninja"),
  new Genre("Office Workers", "office-workers"),
  new Genre("Philosophical", "philosophical"),
  new Genre("Police", "police"),
  new Genre("Post-Apocalyptic", "post-apocalyptic"),
  new Genre("Psychological", "psychological"),
  new Genre("Reincarnation", "reincarnation"),
  new Genre("Reverse Harem", "reverse-harem"),
  new Genre("Romance", "romance"),
  new Genre("Samurai", "samurai"),
  new Genre("School Life", "school-life"),
  new Genre("Sci-Fi", "sci-fi"),
  new Genre("Seinen", "seinen"),
  new Genre("Shota", "shota"),
  new Genre("Shoujo", "shoujo"),
  new Genre("Shounen", "shounen"),
  new Genre("Slice of Life", "slice-of-life"),
  new Genre("Smut", "smut"),
  new Genre("Sports", "sports"),
  new Genre("Superhero", "superhero"),
  new Genre("Supernatural", "supernatural"),
  new Genre("Survival", "survival"),
  new Genre("Thriller", "thriller"),
  new Genre("Time Travel", "time-travel"),
  new Genre("Traditional Games", "traditional-games"),
  new Genre("Tragedy", "tragedy"),
  new Genre("Vampires", "vampires"),
  new Genre("Video Games", "video-games"),
  new Genre("Villainess", "villainess"),
  new Genre("Virtual Reality", "virtual-reality"),
  new Genre("Wuxia", "wuxia"),
  new Genre("Zombies", "zombies"),
];
