// Port of keiyoushi/extensions-source src/id/themanga/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UrlFilter {
  addToUrl(url: HttpUrlBuilder): void;
}

export const isUrlFilter = (it: Filter): it is Filter & UrlFilter => typeof (it as Partial<UrlFilter>).addToUrl === "function";

abstract class SelectFilter extends Filter.Select<string> implements UrlFilter {
  constructor(
    name: string,
    private readonly queryName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
    );
  }
  addToUrl(url: HttpUrlBuilder) {
    const value = this.vals[this.state][1];
    if (value.trim()) url.addQueryParameter(this.queryName, value);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", "status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genre", "genre", [
      ["All", ""],
      ["4-Koma", "4-koma"],
      ["Action", "action"],
      ["Adult", "adult"],
      ["Adventure", "adventure"],
      ["Aliens", "aliens"],
      ["Animals", "animals"],
      ["Anthology", "anthology"],
      ["Comedy", "comedy"],
      ["Cooking", "cooking"],
      ["Crime", "crime"],
      ["Crossdressing", "crossdressing"],
      ["Delinquents", "delinquents"],
      ["Demon", "demon"],
      ["Demons", "demons"],
      ["Drama", "drama"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Game", "game"],
      ["Gender Bender", "gender-bender"],
      ["Genderswap", "genderswap"],
      ["Ghosts", "ghosts"],
      ["Gore", "gore"],
      ["Gyaru", "gyaru"],
      ["Harem", "harem"],
      ["Historical", "historical"],
      ["Horror", "horror"],
      ["Incest", "incest"],
      ["Isekai", "isekai"],
      ["Josei", "josei"],
      ["Loli", "loli"],
      ["Mafia", "mafia"],
      ["Magic", "magic"],
      ["Magical Girls", "magical-girls"],
      ["Martial Art", "martial-art"],
      ["Martial Arts", "martial-arts"],
      ["Mature", "mature"],
      ["Mecha", "mecha"],
      ["Medical", "medical"],
      ["Military", "military"],
      ["Monster", "monster"],
      ["Monster Girls", "monster-girls"],
      ["Monsters", "monsters"],
      ["Music", "music"],
      ["Mystery", "mystery"],
      ["Ninja", "ninja"],
      ["Office Workers", "office-workers"],
      ["Oneshot", "oneshot"],
      ["Philosophical", "philosophical"],
      ["Police", "police"],
      ["Psychological", "psychological"],
      ["Regression", "regression"],
      ["Reincarnation", "reincarnation"],
      ["Reverse Harem", "reverse-harem"],
      ["Romance", "romance"],
      ["Samurai", "samurai"],
      ["School", "school"],
      ["School Life", "school-life"],
      ["Sci-Fi", "sci-fi"],
      ["Seinen", "seinen"],
      ["Sexual Violence", "sexual-violence"],
      ["Shotacon", "shotacon"],
      ["Shoujo", "shoujo"],
      ["Shoujo Ai", "shoujo-ai"],
      ["Shounen", "shounen"],
      ["Slice of Life", "slice-of-life"],
      ["Smut", "smut"],
      ["Sports", "sports"],
      ["Super Power", "super-power"],
      ["Supernatural", "supernatural"],
      ["Survival", "survival"],
      ["Suspense", "suspense"],
      ["System", "system"],
      ["Thriller", "thriller"],
      ["Time Travel", "time-travel"],
      ["Tragedy", "tragedy"],
      ["Urban", "urban"],
      ["Vampire", "vampire"],
      ["Video Games", "video-games"],
      ["Villainess", "villainess"],
      ["Virtual Reality", "virtual-reality"],
      ["Web Comic", "web-comic"],
      ["Webtoons", "webtoons"],
      ["Yuri", "yuri"],
      ["Zombies", "zombies"],
    ]);
  }
}

export class TextFilter extends Filter.Text implements UrlFilter {
  constructor(
    name: string,
    private readonly queryName: string,
  ) {
    super(name);
  }
  addToUrl(url: HttpUrlBuilder) {
    if (this.state.trim()) url.addQueryParameter(this.queryName, this.state);
  }
}

export class OtherFilterGroup extends Filter.Group<TextFilter> implements UrlFilter {
  constructor() {
    super("Other filters", [
      new TextFilter("Minimum Rating", "rating_min"),
      new TextFilter("Year", "year"),
      new TextFilter("Author", "author"),
      new TextFilter("Artist", "artist"),
      new TextFilter("Type", "type"),
    ]);
  }
  addToUrl(url: HttpUrlBuilder) {
    this.state.forEach((it) => it.addToUrl(url));
  }
}
