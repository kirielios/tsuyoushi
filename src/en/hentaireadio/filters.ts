// Port of keiyoushi/extensions-source src/en/hentaireadio/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const getFilters = (): FilterList => [new StatusFilter(), new SortFilter(), new Filter.Separator(), new GenreFilter()];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart = () => this.vals[this.state][1];
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", "all"],
      ["Completed", "complete"],
      ["Ongoing", "in-process"],
      ["Hiatus", "pause"],
    ]);
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["Latest update", "lastest-chap"],
      ["Top all", "top-manga"],
      ["Hot", "hot"],
      ["New", "lastest-manga"],
      ["Top month", "top-month"],
      ["Top week", "top-week"],
      ["Top day", "top-day"],
      ["Follow", "follow"],
      ["Comment", "comment"],
      ["Num. Chapter", "num-chap"],
    ]);
  }
}

export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      ["All genres", ""],
      ["Adult", "adult"],
      ["Action", "action"],
      ["Adaptation", "adaptation"],
      ["Adventure", "adventure"],
      ["Anime", "anime"],
      ["Comedy", "comedy"],
      ["Completed", "completed"],
      ["Cooking", "cooking"],
      ["Crime", "crime"],
      ["Crossdressing", "crossdressin"],
      ["Delinquents", "delinquents"],
      ["Demons", "demons"],
      ["Detective", "detective"],
      ["Drama", "drama"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Game", "game"],
      ["Ghosts", "ghosts"],
      ["Hentai", "hentai"],
      ["Harem", "harem"],
      ["Historical", "historical"],
      ["Horror", "horror"],
      ["Isekai", "isekai"],
      ["Josei", "josei"],
      ["Magic", "magic"],
      ["Magical", "magical"],
      ["Manhua", "manhua"],
      ["Manhwa", "manhwa"],
      ["Martial Arts", "martial-arts"],
      ["Mature", "mature"],
      ["Mecha", "mecha"],
      ["Medical", "medical"],
      ["Military", "military"],
      ["Moder", "moder"],
      ["Monsters", "monsters"],
      ["Music", "music"],
      ["Mystery", "mystery"],
      ["Office Workers", "office-workers"],
      ["One shot", "one-shot"],
      ["Philosophical", "philosophical"],
      ["Police", "police"],
      ["Reincarnation", "reincarnation"],
      ["Reverse", "reverse"],
      ["Reverse harem", "reverse-harem"],
      ["Romance", "romance"],
      ["Royal family", "royal-family"],
      ["Smut", "smut"],
      ["School Life", "school-life"],
      ["Sci-fi", "scifi"],
      ["Seinen", "seinen"],
      ["Shoujo", "shoujo"],
      ["Shoujo Ai", "shoujo-ai"],
      ["Shounen", "shounen"],
      ["Shounen Ai", "shounen-ai"],
      ["Slice of Life", "slice-of-life"],
      ["Sports", "sports"],
      ["Super power", "super-power"],
      ["Superhero", "superhero"],
      ["Supernatural", "supernatural"],
      ["Survival", "survival"],
      ["Thriller", "thriller"],
      ["Time Travel", "time-travel"],
      ["Tragedy", "tragedy"],
      ["Vampire", "vampire"],
      ["Villainess", "villainess"],
      ["Webtoons", "webtoons"],
      ["Yaoi", "yaoi"],
      ["Yuri", "yuri"],
      ["Zombies", "zombies"],
    ]);
  }
}
