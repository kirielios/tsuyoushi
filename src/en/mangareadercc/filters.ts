// Port of keiyoushi/extensions-source src/en/mangareadercc/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

const ORDER_LIST: [string, string][] = [
  ["Views", "2"],
  ["Latest", "3"],
  ["A-Z", "1"],
];

const GENRE_LIST: [string, string][] = [
  ["4 koma", "4-koma"],
  ["Action", "action"],
  ["Adaptation", "adaptation"],
  ["Adult", "adult"],
  ["Adventure", "adventure"],
  ["Aliens", "aliens"],
  ["Animals", "animals"],
  ["Anthology", "anthology"],
  ["Award winning", "award-winning"],
  ["Comedy", "comedy"],
  ["Cooking", "cooking"],
  ["Crime", "crime"],
  ["Crossdressing", "crossdressing"],
  ["Delinquents", "delinquents"],
  ["Demons", "demons"],
  ["Doujinshi", "doujinshi"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fan colored", "fan-colored"],
  ["Fantasy", "fantasy"],
  ["Food", "food"],
  ["Full color", "full-color"],
  ["Game", "game"],
  ["Gender bender", "gender-bender"],
  ["Genderswap", "genderswap"],
  ["Ghosts", "ghosts"],
  ["Gore", "gore"],
  ["Gossip", "gossip"],
  ["Gyaru", "gyaru"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Kids", "kids"],
  ["Loli", "loli"],
  ["Lolicon", "lolicon"],
  ["Long strip", "long-strip"],
  ["Mafia", "mafia"],
  ["Magic", "magic"],
  ["Magical girls", "magical-girls"],
  ["Manhwa", "manhwa"],
  ["Martial arts", "martial-arts"],
  ["Mature", "mature"],
  ["Mecha", "mecha"],
  ["Medical", "medical"],
  ["Military", "military"],
  ["Monster girls", "monster-girls"],
  ["Monsters", "monsters"],
  ["Music", "music"],
  ["Mystery", "mystery"],
  ["Ninja", "ninja"],
  ["Office workers", "office-workers"],
  ["Official colored", "official-colored"],
  ["One shot", "one-shot"],
  ["Parody", "parody"],
  ["Philosophical", "philosophical"],
  ["Police", "police"],
  ["Post apocalyptic", "post-apocalyptic"],
  ["Psychological", "psychological"],
  ["Reincarnation", "reincarnation"],
  ["Reverse harem", "reverse-harem"],
  ["Romance", "romance"],
  ["Samurai", "samurai"],
  ["School life", "school-life"],
  ["Sci fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shota", "shota"],
  ["Shotacon", "shotacon"],
  ["Shoujo", "shoujo"],
  ["Shoujo ai", "shoujo-ai"],
  ["Shounen", "shounen"],
  ["Shounen ai", "shounen-ai"],
  ["Slice of life", "slice-of-life"],
  ["Smut", "smut"],
  ["Space", "space"],
  ["Sports", "sports"],
  ["Super power", "super-power"],
  ["Superhero", "superhero"],
  ["Supernatural", "supernatural"],
  ["Survival", "survival"],
  ["Suspense", "suspense"],
  ["Thriller", "thriller"],
  ["Time travel", "time-travel"],
  ["Toomics", "toomics"],
  ["Traditional games", "traditional-games"],
  ["Tragedy", "tragedy"],
  ["User created", "user-created"],
  ["Vampire", "vampire"],
  ["Vampires", "vampires"],
  ["Video games", "video-games"],
  ["Virtual reality", "virtual-reality"],
  ["Web comic", "web-comic"],
  ["Webtoon", "webtoon"],
  ["Wuxia", "wuxia"],
  ["Yaoi", "yaoi"],
  ["Yuri", "yuri"],
  ["Zombies", "zombies"],
];

export class OrderFilter extends UriPartFilter {
  constructor() {
    super("Order by", ORDER_LIST);
  }
}
export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", GENRE_LIST);
  }
}
