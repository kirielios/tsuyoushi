// Port of keiyoushi/extensions-source src/en/greedscans/Filters.kt
import { Filter, FilterList, type HttpUrlBuilder } from "../../../sdk/index.ts";

export interface UrlFilter {
  addToUrl(url: HttpUrlBuilder): void;
}

export const isUrlFilter = (f: unknown): f is UrlFilter => typeof (f as UrlFilter).addToUrl === "function";

export abstract class SelectFilter extends Filter.Select<string> implements UrlFilter {
  constructor(
    name: string,
    private readonly options: [string, string][],
    private readonly queryParam: string,
    defaultValue: string | null = null,
  ) {
    super(
      name,
      options.map((it) => it[0]),
      Math.max(
        options.findIndex((it) => it[1] === defaultValue),
        0,
      ),
    );
  }
  addToUrl(url: HttpUrlBuilder) {
    const value = this.options[this.state][1];
    if (value !== "") url.addQueryParameter(this.queryParam, value);
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export abstract class CheckBoxGroup extends Filter.Group<CheckBoxFilter> implements UrlFilter {
  constructor(
    name: string,
    options: [string, string][],
    private readonly queryParam: string,
  ) {
    super(
      name,
      options.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  addToUrl(url: HttpUrlBuilder) {
    this.state.filter((it) => it.state).forEach((it) => url.addQueryParameter(this.queryParam, it.value));
  }
}

export class SortFilter extends SelectFilter {
  constructor(defaultValue: string | null = null) {
    super(
      "Sort By",
      [
        ["Popular", "popular"],
        ["Latest Update", "latest_update"],
        ["Rating", "rating"],
        ["A-Z", "a_z"],
        ["Newest", "newest"],
      ],
      "sort_by",
      defaultValue,
    );
  }
  static get popular() {
    return FilterList(new SortFilter("popular"));
  }
  static get latest() {
    return FilterList(new SortFilter("latest_update"));
  }
}

export class StatusFilter extends CheckBoxGroup {
  constructor() {
    super(
      "Status",
      [
        ["Ongoing", "ongoing"],
        ["Completed", "completed"],
        ["Hiatus", "hiatus"],
      ],
      "status",
    );
  }
}

export class TypeFilter extends CheckBoxGroup {
  constructor() {
    super(
      "Type",
      [
        ["Free", "free"],
        ["Coin", "coin"],
        ["VIP", "vip"],
      ],
      "type",
    );
  }
}

export class MinChaptersFilter extends Filter.Text implements UrlFilter {
  constructor() {
    super("Minimum Chapters");
  }
  addToUrl(url: HttpUrlBuilder) {
    if (this.state.length > 0) url.addQueryParameter("min_chapters", this.state);
  }
}

export class GenreFilter extends CheckBoxGroup {
  constructor() {
    super(
      "Genres",
      [
        ["Action", "action"],
        ["Fantasy", "fantasy"],
        ["Adventure", "adventure"],
        ["Drama", "drama"],
        ["Comedy", "comedy"],
        ["Romance", "romance"],
        ["Shounen", "shounen"],
        ["Isekai", "isekai"],
        ["Murim", "murim"],
        ["Reincarnation", "reincarnation"],
        ["Manhwa", "manhwa"],
        ["Mystery", "mystery"],
        ["Tragedy", "tragedy"],
        ["Webtoons", "webtoons"],
        ["Revenge", "revenge"],
        ["Slice of Life", "slice-of-life"],
        ["Martial Arts", "martial-arts"],
        ["School Life", "school-life"],
        ["Regression", "regression"],
        ["Overpowered", "overpowered"],
        ["Historical", "historical"],
        ["Supernatural", "supernatural"],
        ["Game", "game"],
        ["Genius MC", "genius-mc"],
        ["System", "system"],
        ["Magic", "magic"],
        ["Shoujo", "shoujo"],
        ["Sci-Fi", "sci-fi"],
        ["Wuxia", "wuxia"],
        ["Horror", "horror"],
        ["Seinen", "seinen"],
        ["Psychological", "psychological"],
        ["Manhua", "manhua"],
        ["Sports", "sports"],
        ["Thriller", "thriller"],
        ["Dungeons", "dungeons"],
        ["Crime", "crime"],
        ["Demon", "demon"],
        ["Superhero", "superhero"],
        ["Crazy MC", "crazy-mc"],
        ["Sci Fi", "sci-fi"],
        ["Harem", "harem"],
        ["Necromancer", "necromancer"],
        ["Tower", "tower"],
        ["Full Color", "full-color"],
        ["Violence", "violence"],
        ["Ecchi", "ecchi"],
        ["Adaptation", "adaptation"],
        ["Long Strip", "long-strip"],
        ["Villain", "villain"],
        ["Mature", "mature"],
        ["Comic", "comic"],
        ["Monsters", "monsters"],
        ["Medical", "medical"],
        ["Manga", "manga"],
        ["Time Travel", "time-travel"],
        ["Cooking", "cooking"],
        ["One Shot", "one-shot"],
      ],
      "genres[]",
    );
  }
}
