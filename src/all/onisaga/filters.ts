// Port of keiyoushi/extensions-source src/all/onisaga/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class TextFilter extends Filter.Text {}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "MANGA"],
      ["Manhwa", "MANHWA"],
      ["Manhua", "MANHUA"],
      ["Novel", "NOVEL"],
      ["One-Shot", "ONE-SHOT"],
      ["Doujinshi", "DOUJINSHI"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Releasing", "releasing"],
    ]);
  }
}

export class MinChaptersFilter extends UriPartFilter {
  constructor() {
    super("Min Chapters", [
      ["Any", ""],
      ["10+", "10"],
      ["50+", "50"],
      ["100+", "100"],
      ["200+", "200"],
    ]);
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort", [
      ["Newest", "created_at"],
      ["Most Viewed", "view"],
      ["Release Date", "release_date"],
      ["Top Rated (Likes)", "like_count"],
      ["Name A-Z", "title"],
      ["Top Rated (Score)", "vote_average"],
      ["Fan Favorites", "fan_favorites"],
    ]);
    this.state = 1;
  }
}

export class GroupFilter extends TextFilter {
  constructor() {
    super("Group");
  }
}
export class ReleaseStartFilter extends TextFilter {
  constructor() {
    super("Release Start Date (YYYY-MM-DD)");
  }
}
export class ReleaseEndFilter extends TextFilter {
  constructor() {
    super("Release End Date (YYYY-MM-DD)");
  }
}

export class GenreTriState extends Filter.TriState {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}
export class GenreFilter extends Filter.Group<GenreTriState> {
  constructor(genres: GenreTriState[]) {
    super("Genres", genres);
  }
}

export const genreList: [string, string][] = [
  ["Action", "1"],
  ["Adaptation", "61"],
  ["Adult", "67"],
  ["Adventure", "6"],
  ["Aliens", "84"],
  ["Avant Garde", "43"],
  ["Award Winning", "78"],
  ["Boys Love", "31"],
  ["Comedy", "2"],
  ["Comics", "90"],
  ["Crazy MC", "59"],
  ["Crime", "98"],
  ["Demon", "57"],
  ["Demons", "5"],
  ["Doujinshi", "79"],
  ["Drama", "15"],
  ["Dungeons", "56"],
  ["Ecchi", "29"],
  ["Erotica", "68"],
  ["Fantasy", "7"],
  ["Full Color", "62"],
  ["Game", "46"],
  ["Gender Bender", "75"],
  ["Genderswap", "63"],
  ["Genius MC", "49"],
  ["Girls Love", "28"],
  ["Gore", "80"],
  ["Gourmet", "42"],
  ["Harem", "37"],
  ["Hentai", "76"],
  ["Historical", "66"],
  ["Horror", "16"],
  ["Isekai", "3"],
  ["Iyashikei", "34"],
  ["Josei", "35"],
  ["Kids", "38"],
  ["Lolicon", "70"],
  ["Long Strip", "64"],
  ["Magic", "8"],
  ["Magical Girls", "99"],
  ["Mahou Shoujo", "41"],
  ["Martial Arts", "11"],
  ["Mature", "45"],
  ["Mecha", "36"],
  ["Medical", "101"],
  ["Military", "17"],
  ["Monster Girls", "88"],
  ["Monsters", "81"],
  ["Murim", "47"],
  ["Music", "30"],
  ["Mystery", "19"],
  ["Necromancer", "54"],
  ["Overpowered", "55"],
  ["Parody", "12"],
  ["Philosophical", "100"],
  ["Post-Apocalyptic", "85"],
  ["Psychological", "18"],
  ["Regression", "52"],
  ["Reincarnation", "48"],
  ["Revenge", "51"],
  ["Reverse Harem", "44"],
  ["Romance", "20"],
  ["Samurai", "86"],
  ["School", "21"],
  ["School Life", "24"],
  ["Sci-Fi", "13"],
  ["Seinen", "14"],
  ["Self-Published", "82"],
  ["Shotacon", "77"],
  ["Shoujo", "27"],
  ["Shoujo Ai", "73"],
  ["Shounen", "4"],
  ["Shounen Ai", "72"],
  ["Slice of Life", "26"],
  ["Smut", "69"],
  ["Space", "22"],
  ["Sports", "32"],
  ["Super Power", "9"],
  ["Superhero", "89"],
  ["Supernatural", "10"],
  ["Survival", "87"],
  ["Suspense", "39"],
  ["System", "50"],
  ["Thriller", "40"],
  ["Time Travel", "23"],
  ["Tower", "58"],
  ["Tragedy", "25"],
  ["Vampire", "33"],
  ["Villain", "53"],
  ["Violence", "60"],
  ["Web Comic", "65"],
  ["Wuxia", "113"],
  ["Yaoi", "74"],
  ["Yuri", "71"],
];
