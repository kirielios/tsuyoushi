// Port of keiyoushi/extensions-source src/en/manganow/Filters.kt
import {
  UriMultiSelectFilter,
  UriPartFilter,
} from "../../../themes/mangareader/index.ts";

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", "type", [
      ["All", ""],
      ["Manga", "8"],
      ["Manhua", "53"],
      ["Manhwa", "39"],
      ["OEL", "169"],
      ["Web Comic", "344"],
      ["Webtoon", "983"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", "status", [
      ["All", ""],
      ["Completed", "completed"],
      ["Ongoing", "ongoing"],
      ["On-hiatus", "on-hiatus"],
      ["Discontinued", "discontinued"],
      ["Not-yet-published", "not-yet-published"],
    ]);
  }
}

export class ScoreFilter extends UriPartFilter {
  constructor() {
    super("Score", "score", [
      ["All", ""],
      ["(1) Appalling", "1"],
      ["(2) Horrible", "2"],
      ["(3) Very Bad", "3"],
      ["(4) Bad", "4"],
      ["(5) Average", "5"],
      ["(6) Fine", "6"],
      ["(7) Good", "7"],
      ["(8) Very Good", "8"],
      ["(9) Great", "9"],
      ["(10) Masterpiece", "10"],
    ]);
  }
}

const nextYear = new Date().getFullYear() + 1;
const years: [string, string][] = Array.from(
  { length: nextYear - 1916 },
  (_, year): [string, string] =>
    year === 0
      ? ["Any", ""]
      : [String(nextYear - year), String(nextYear - year)],
);

export class YearFilter extends UriPartFilter {
  constructor() {
    super("Release Year", "sy", years);
  }
}

export class GenreFilter extends UriMultiSelectFilter {
  constructor() {
    super(
      "Genres",
      "genres",
      [
        ["Action", "1"],
        ["Adventure", "2"],
        ["Animated", "641"],
        ["Anime", "375"],
        ["Cartoon", "463"],
        ["Comedy", "3"],
        ["Comic", "200"],
        ["Completed", "326"],
        ["Cooking", "133"],
        ["Detective", "386"],
        ["Doujinshi", "534"],
        ["Drama", "10"],
        ["Ecchi", "41"],
        ["Fantasy", "17"],
        ["Gender Bender", "89"],
        ["Harem", "11"],
        ["Historical", "30"],
        ["Horror", "21"],
        ["Isekai", "70"],
        ["Josei", "67"],
        ["Magic", "420"],
        ["Manga", "137"],
        ["Manhua", "51"],
        ["Manhwa", "79"],
        ["Martial Arts", "12"],
        ["Mature", "22"],
        ["Mecha", "72"],
        ["Military", "1180"],
        ["Mystery", "44"],
        ["One shot", "721"],
        ["Psychological", "23"],
        ["Reincarnation", "1603"],
        ["Romance", "13"],
        ["School Life", "4"],
        ["Sci-fi", "24"],
        ["Seinen", "25"],
        ["Shoujo", "33"],
        ["Shoujo Ai", "123"],
        ["Shounen", "5"],
        ["Shounen Ai", "680"],
        ["Slice of Life", "14"],
        ["Smut", "734"],
        ["Sports", "142"],
        ["Super Power", "28"],
        ["Supernatural", "6"],
        ["Thriller", "1816"],
        ["Tragedy", "97"],
        ["Webtoon", "60"],
      ],
      ",",
    );
  }
}
