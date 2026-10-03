// Port of keiyoushi/extensions-source src/en/theblank/TheBlank.kt
import { Filter, FilterList, hexBytes, concat } from "../../../sdk/index.ts";
import { CheckBoxGroup, Pam, SortFilter, TriStateGroupFilter } from "../../../themes/pam/index.ts";

export default class TheBlank extends Pam {
  protected override readonly readerSecret = hexBytes("3eb4f283204c2786a6b00bef43808861eaed6aa99aeeb0c62ad170700b7fa272");

  protected override readonly kdfDomain = "4pkdsu71";

  protected override signedPayload(payload: Uint8Array) {
    return concat(payload, this.readerSecret);
  }

  protected override manifestPayload(uid: string, version: number, ts: number, nonce: string) {
    return `${uid}|${ts}|${nonce}|${version}`;
  }

  protected override contentKeyMaterial(sharedSecret: Uint8Array, info: Uint8Array) {
    return [info, this.readerSecret, sharedSecret];
  }

  protected override readonly contentKeyRounds = 4;

  protected override readonly popularFilters = FilterList(new SortFilter("Sort", sortValues, { index: 3, ascending: false }));
  protected override readonly latestFilters = FilterList(new SortFilter("Sort", sortValues, { index: 2, ascending: false }));

  override getFilterList(): FilterList {
    return FilterList(new Filter.Header("Text search ignores filters!"), new Filter.Separator(), new SortFilter("Sort", sortValues), new GenreFilter(), new TypeFilter(), new StatusFilter());
  }
}

class GenreFilter extends TriStateGroupFilter {
  constructor() {
    super("Genres", genres);
  }
}
class TypeFilter extends TriStateGroupFilter {
  constructor() {
    super("Types", type);
  }
}
class StatusFilter extends CheckBoxGroup {
  constructor() {
    super("Status", status);
  }
}

const sortValues: [string, string][] = [
  ["New Series", "date"],
  ["Trending", "trending"],
  ["Recently Updated", "recently"],
  ["Most Views", "views"],
  ["A-Z", "alphabetical"],
];

const genres: [string, string][] = [
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Ai", "ai"],
  ["Animated", "animated"],
  ["Anthology", "anthology"],
  ["Cohabitation", "cohabitation"],
  ["College", "college"],
  ["Comedy", "comedy"],
  ["Doujinshi", "doujinshi"],
  ["Drama", "drama"],
  ["Fantasy", "fantasy"],
  ["Folklore", "folklore"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Love triangle", "love-triangle"],
  ["Martial arts", "martial-arts"],
  ["Mature", "mature"],
  ["Murim", "murim"],
  ["Mystery", "mystery"],
  ["Office workers", "office-workers"],
  ["Psychological", "psychological"],
  ["Robots", "robots"],
  ["Romance", "romance"],
  ["School life", "school-life"],
  ["Sci-fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shounen", "shounen"],
  ["Slice of life", "slice-of-life"],
  ["Smut", "smut"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Superpower", "superpower"],
  ["System", "system"],
  ["Thriller", "thriller"],
  ["Uncensored", "uncensored"],
  ["Violence", "violence"],
  ["Workplace", "workplace"],
];

const type: [string, string][] = [
  ["Comic", "comic"],
  ["Doujin", "doujin"],
  ["Josei", "josei"],
  ["Manga", "manga"],
  ["Manhua", "manhua"],
  ["Manhwa", "manhwa"],
  ["Pornhwa", "pornhwa"],
  ["Webtoon", "webtoon"],
];

const status: [string, string][] = [
  ["Ongoing", "ongoing"],
  ["Finished", "finished"],
  ["Dropped", "dropped"],
  ["On Hold", "onhold"],
  ["Upcoming", "upcoming"],
];
