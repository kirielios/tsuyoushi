// Port of yuzono/anime-extensions src/all/rouvideo/RouVideoFilter.kt
import { Filter } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";

export type Tag = [string, string];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly options: Tag[],
  ) {
    super(
      displayName,
      options.map((it) => it[0]),
    );
  }
  toUriPart = () => this.options[this.state][1];
  isEmpty = () => this.options[this.state][1] === "";
  isDefault = () => this.state === 0;
}

export const FEATURED = "featured";
export const WATCHING = "watching";
export const ALL_VIDEOS = "all-videos";

export const SORT_LATEST_KEY = "createdAt";
export const SORT_LIKE_KEY = "likeCount";
export const SORT_VIEW_KEY = "viewCount";

export const categories = (intl: Intl): Tag[] => [
  [intl.get("ChineseAV"), "國產AV"], // ChineseAV
  [intl.get("ChineseSub"), "中文字幕"], // ChineseSub
  [intl.get("Madou_Media"), "麻豆傳媒"], // Madou Media
  [intl.get("Selfie_leaked"), "自拍流出"], // Selfie leaked
  [intl.get("Tanhua"), "探花"], // Tanhua (Flower exploration)
  ["OnlyFans", "OnlyFans"],
  [intl.get("JAV"), "日本"], // JAV
];

export class CategoryFilter extends UriPartFilter {
  constructor(intl: Intl) {
    super(intl.get("category"), [
      [`<${intl.get("category")}>`, ""],
      [intl.get("featured"), FEATURED],
      [intl.get("other_watching"), WATCHING],
      ...categories(intl),
      [intl.get("all_videos"), ALL_VIDEOS],
    ]);
  }
}

export class TagFilter extends UriPartFilter {
  constructor(intl: Intl, tags: Tag[]) {
    super(intl.get("tag"), tags);
  }
}

export class HotSearchFilter extends UriPartFilter {
  constructor(intl: Intl, keywords: Tag[]) {
    super(intl.get("hot_search"), keywords);
  }
}

export class SortFilter extends UriPartFilter {
  constructor(intl: Intl) {
    super(intl.get("sort"), [
      [intl.get("latest_recent"), SORT_LATEST_KEY],
      [intl.get("most_viewed"), SORT_VIEW_KEY],
      [intl.get("most_liked"), SORT_LIKE_KEY],
    ]);
  }
}
