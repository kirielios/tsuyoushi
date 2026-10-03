// Port of keiyoushi/extensions-source src/id/komiku/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}

export const isUriFilter = (it: Filter): it is Filter & UriFilter => typeof (it as Partial<UriFilter>).addToUri === "function";

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const selected = this.vals[this.state][1];
    if (selected) builder.addQueryParameter(this.param, selected);
  }
}

const typeList: [string, string][] = [
  ["Semua", ""],
  ["Manga", "manga"],
  ["Manhua", "manhua"],
  ["Manhwa", "manhwa"],
];

const orderList: [string, string][] = [
  ["Chapter Terbaru", "modified"],
  ["Komik Terbaru", "date"],
  ["Peringkat", "meta_value_num"],
  ["Acak", "rand"],
];

const genreList: [string, string][] = [
  ["Semua", ""],
  ["Academy", "academy"],
  ["Action", "action"],
  ["Adaptation", "adaptation"],
  ["Adult", "adult"],
  ["Adventure", "adventure"],
  ["apocalypse", "apocalypse"],
  ["Beasts", "beasts"],
  ["Blacksmith", "blacksmith"],
  ["Comedy", "comedy"],
  ["Comic", "comic"],
  ["Cooking", "cooking"],
  ["Crime", "crime"],
  ["Crossdressing", "crossdressing"],
  ["Dark Fantasy", "dark-fantasy"],
  ["Demons", "demons"],
  ["Doujinshi", "doujinshi"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Entertainment", "entertainment"],
  ["Fantasy", "fantasy"],
  ["Game", "game"],
  ["Gender Bender", "gender-bender"],
  ["Genderswap", "genderswap"],
  ["Genius", "genius"],
  ["Ghosts", "ghosts"],
  ["Gore", "gore"],
  ["Gyaru", "gyaru"],
  ["Harem", "harem"],
  ["Hentai", "hentai"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Knight", "knight"],
  ["Long Strip", "long-strip"],
  ["Magic", "magic"],
  ["Magical Girls", "magical-girls"],
  ["Manga", "manga"],
  ["Mangatoon", "mangatoon"],
  ["Manhwa", "manhwa"],
  ["Martial Art", "martial-art"],
  ["Martial Arts", "martial-arts"],
  ["Mature", "mature"],
  ["MC Rebirth", "mc-rebirth"],
  ["Mecha", "mecha"],
  ["Medical", "medical"],
  ["Military", "military"],
  ["Monster", "monster"],
  ["Monster girls", "monster-girls"],
  ["Monsters", "monsters"],
  ["Murim", "murim"],
  ["Music", "music"],
  ["Mystery", "mystery"],
  ["Office Workers", "office-workers"],
  ["One Shot", "one-shot"],
  ["Oneshot", "oneshot"],
  ["Police", "police"],
  ["Psychological", "psychological"],
  ["Regression", "regression"],
  ["Reincarnation", "reincarnation"],
  ["Revenge", "revenge"],
  ["Romance", "romance"],
  ["School", "school"],
  ["School life", "school-life"],
  ["Sci-fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Sexual Violence", "sexual-violence"],
  ["Shotacon", "shotacon"],
  ["Shoujo", "shoujo"],
  ["Shoujo Ai", "shoujo-ai"],
  ["Shoujo(G)", "shoujog"],
  ["Shounen", "shounen"],
  ["Shounen Ai", "shounen-ai"],
  ["Slice of Life", "slice-of-life"],
  ["Slow Life", "slow-life"],
  ["Smut", "smut"],
  ["Sport", "sport"],
  ["Sports", "sports"],
  ["Strategy", "strategy"],
  ["Super Power", "super-power"],
  ["Supernatural", "supernatural"],
  ["Survival", "survival"],
  ["Sword Fight", "sword-fight"],
  ["Sword Master", "sword-master"],
  ["Swormanship", "swormanship"],
  ["System", "system"],
  ["Thriller", "thriller"],
  ["Tragedy", "tragedy"],
  ["Trauma", "trauma"],
  ["Vampire", "vampire"],
  ["Villainess", "villainess"],
  ["Violence", "violence"],
  ["Web Comic", "web-comic"],
  ["Webtoon", "webtoon"],
  ["Webtoons", "webtoons"],
  ["Xianxia", "xianxia"],
  ["Xuanhuan", "xuanhuan"],
  ["Yuri", "yuri"],
];

const statusList: [string, string][] = [
  ["Semua", ""],
  ["Ongoing", "ongoing"],
  ["Tamat", "end"],
];

export class Type extends UriPartFilter {
  constructor() {
    super("Tipe", "tipe", typeList);
  }
}
export class Order extends UriPartFilter {
  constructor() {
    super("Order", "orderby", orderList);
  }
}
export class Genre1 extends UriPartFilter {
  constructor() {
    super("Genre 1", "genre", genreList);
  }
}
export class Genre2 extends UriPartFilter {
  constructor() {
    super("Genre 2", "genre2", genreList);
  }
}
export class Status extends UriPartFilter {
  constructor() {
    super("Status", "statusmanga", statusList);
  }
}
