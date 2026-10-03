// Port of keiyoushi/extensions-source src/en/comickfan/ComicKFanFilters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

const formatGenres = () => [
  new Genre("Award Winning", "award-winning"),
  new Genre("Long Strip", "long-strip"),
  new Genre("Official Colored", "official-colored"),
  new Genre("Fan Colored", "fan-colored"),
  new Genre("Anthology", "anthology"),
  new Genre("Full Color", "full-color"),
  new Genre("4-Koma", "4-koma"),
  new Genre("User Created", "user-created"),
  new Genre("Adaptation", "adaptation"),
  new Genre("Web Comic", "web-comic"),
  new Genre("Oneshot", "oneshot"),
  new Genre("Doujinshi", "doujinshi"),
];
const contentGenres = () => [
  new Genre("Sexual Violence", "sexual-violence"),
  new Genre("Gore", "gore"),
  new Genre("Smut", "smut"),
  new Genre("Ecchi", "ecchi"),
];

const themeGenres = () => [
  new Genre("Ninja", "ninja"),
  new Genre("Virtual Reality", "virtual-reality"),
  new Genre("Police", "police"),
  new Genre("Magic", "magic"),
  new Genre("Villainess", "villainess"),
  new Genre("Traditional Games", "traditional-games"),
  new Genre("Reincarnation", "reincarnation"),
  new Genre("Zombies", "zombies"),
  new Genre("Loli", "loli"),
  new Genre("Time Travel", "time-travel"),
  new Genre("Mafia", "mafia"),
  new Genre("Music", "music"),
  new Genre("Monsters", "monsters"),
  new Genre("Post-Apocalyptic", "post-apocalyptic"),
  new Genre("Office Workers", "office-workers"),
  new Genre("Monster Girls", "monster-girls"),
  new Genre("Cooking", "cooking"),
  new Genre("Video Games", "video-games"),
  new Genre("Reverse Harem", "reverse-harem"),
  new Genre("Demons", "demons"),
  new Genre("Harem", "harem"),
  new Genre("Vampires", "vampires"),
  new Genre("Shota", "shota"),
  new Genre("Incest", "incest"),
  new Genre("Delinquents", "delinquents"),
  new Genre("Gyaru", "gyaru"),
  new Genre("Animals", "animals"),
  new Genre("Military", "military"),
  new Genre("Aliens", "aliens"),
  new Genre("Survival", "survival"),
  new Genre("Ghosts", "ghosts"),
  new Genre("Crossdressing", "crossdressing"),
  new Genre("School Life", "school-life"),
  new Genre("Martial Arts", "martial-arts"),
  new Genre("Samurai", "samurai"),
  new Genre("Genderswap", "genderswap"),
  new Genre("Supernatural", "supernatural"),
];

const genreGenres = () => [
  new Genre("Fantasy", "fantasy"),
  new Genre("Wuxia", "wuxia"),
  new Genre("Drama", "drama"),
  new Genre("Sports", "sports"),
  new Genre("Psychological", "psychological"),
  new Genre("Medical", "medical"),
  new Genre("Superhero", "superhero"),
  new Genre("Gender Bender", "gender-bender"),
  new Genre("Romance", "romance"),
  new Genre("Shoujo Ai", "shoujo-ai"),
  new Genre("Tragedy", "tragedy"),
  new Genre("Slice of Life", "slice-of-life"),
  new Genre("Shounen Ai", "shounen-ai"),
  new Genre("Isekai", "isekai"),
  new Genre("Mecha", "mecha"),
  new Genre("Adult", "adult"),
  new Genre("Magical Girls", "magical-girls"),
  new Genre("Philosophical", "philosophical"),
  new Genre("Sci-Fi", "sci-fi"),
  new Genre("Thriller", "thriller"),
  new Genre("Historical", "historical"),
  new Genre("Yaoi", "yaoi"),
  new Genre("Mature", "mature"),
  new Genre("Mystery", "mystery"),
  new Genre("Adventure", "adventure"),
  new Genre("Yuri", "yuri"),
  new Genre("Comedy", "comedy"),
  new Genre("Horror", "horror"),
  new Genre("Others", "others"),
  new Genre("Crime", "crime"),
  new Genre("Action", "action"),
];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
    state = 0,
  ) {
    super(
      name,
      options.map((it) => it[0]),
      state,
    );
  }
  toUriPart() {
    return this.options[this.state][1];
  }
}

class GenreGroup extends Filter.Group<Genre> {
  get selected() {
    return this.state
      .filter((it) => it.state)
      .map((it) => it.value)
      .join("_");
  }
}

export class FormatGenreFilter extends GenreGroup {
  constructor() {
    super("Format", formatGenres());
  }
}
export class ContentGenreFilter extends GenreGroup {
  constructor() {
    super("Content", contentGenres());
  }
}
export class ThemeGenreFilter extends GenreGroup {
  constructor() {
    super("Theme", themeGenres());
  }
}
export class GenreGenreFilter extends GenreGroup {
  constructor() {
    super("Genre", genreGenres());
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "1"],
      ["Completed", "2"],
      ["Cancelled", "3"],
      ["Hiatus", "4"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "jp"],
      ["Manhwa", "kr"],
      ["Manhua", "cn"],
    ]);
  }
}

export class SortFilter extends UriPartFilter {
  constructor(state = 0) {
    super(
      "Order By",
      [
        ["All", ""],
        ["Last Updated", "latest"],
        ["Rating", "rating"],
        ["Bookmark Count", "bookmark"],
        ["Name (A-Z)", "name_asc"],
        ["Name (Z-A)", "name_desc"],
      ],
      state,
    );
  }

  static get POPULAR() {
    return FilterList(new SortFilter(2));
  }
  static get LATEST() {
    return FilterList(new SortFilter(1));
  }
}
