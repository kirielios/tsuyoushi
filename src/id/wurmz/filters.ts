// Port of keiyoushi/extensions-source src/id/wurmz/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
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

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Urutkan", [
      ["Update Terbaru", "update"],
      ["Komik Baru", "new"],
      ["Terlama", "old"],
      ["Populer Hari Ini", "popular_today"],
      ["Populer 3 Hari", "popular_3d"],
      ["Populer 7 Hari", "popular_7d"],
      ["Populer 1 Bulan", "popular_30d"],
      ["Populer Sepanjang Masa", "popular_all"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Tipe", [
      ["Semua Tipe", ""],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["Semua Status", ""],
      ["Ongoing", "ongoing"],
      ["Tamat", "tamat"],
      ["Hiatus", "hiatus"],
      ["Drop", "drop"],
    ]);
  }
}

export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", GENRES);
  }
}

const GENRES: [string, string][] = [
  ["Semua Genre", ""],
  ["18+", "18+"],
  ["4-Koma", "4-Koma"],
  ["Action", "Action"],
  ["Adaptation", "Adaptation"],
  ["Adventure", "Adventure"],
  ["Age Gap", "Age Gap"],
  ["Aliens", "Aliens"],
  ["Animals", "Animals"],
  ["Anthology", "Anthology"],
  ["BDSM", "BDSM"],
  ["Beasts", "Beasts"],
  ["Bloody", "Bloody"],
  ["Bodyswap", "Bodyswap"],
  ["Boys", "Boys"],
  ["Cheating", "Cheating"],
  ["Childhood Friends", "Childhood Friends"],
  ["College Life", "College Life"],
  ["Comedy", "Comedy"],
  ["Cooking", "Cooking"],
  ["Crime", "Crime"],
  ["Crossdressing", "Crossdressing"],
  ["Cunnilingus", "Cunnilingus"],
  ["Delinguents", "Delinguents"],
  ["Dementia", "Dementia"],
  ["Demons", "Demons"],
  ["Doujinshi", "Doujinshi"],
  ["Drama", "Drama"],
  ["Dungeons", "Dungeons"],
  ["Ecchi", "Ecchi"],
  ["Fantasy", "Fantasy"],
  ["Femdom", "Femdom"],
  ["Fetish", "Fetish"],
  ["Game", "Game"],
  ["Gender Bender", "Gender Bender"],
  ["Ghosts", "Ghosts"],
  ["Girls", "Girls"],
  ["Gore", "Gore"],
  ["Guideverse", "Guideverse"],
  ["Gyaru", "Gyaru"],
  ["Harem", "Harem"],
  ["Hentai", "Hentai"],
  ["Historical", "Historical"],
  ["Horror", "Horror"],
  ["Incest", "Incest"],
  ["Infidelity", "Infidelity"],
  ["Isekai", "Isekai"],
  ["Josei", "Josei"],
  ["Kids", "Kids"],
  ["Lolicon", "Lolicon"],
  ["Mafia", "Mafia"],
  ["Magic", "Magic"],
  ["Martial Art", "Martial Art"],
  ["Mature", "Mature"],
  ["Mecha", "Mecha"],
  ["Medical", "Medical"],
  ["Milf", "Milf"],
  ["Military", "Military"],
  ["Monsters", "Monsters"],
  ["Music", "Music"],
  ["Mystery", "Mystery"],
  ["NTR", "NTR"],
  ["Nakadashi", "Nakadashi"],
  ["Ninja", "Ninja"],
  ["Non-human", "Non-human"],
  ["Office Workers", "Office Workers"],
  ["Omegaverse", "Omegaverse"],
  ["One Shot", "One Shot"],
  ["Parodi", "Parodi"],
  ["Philosophical", "Philosophical"],
  ["Police", "Police"],
  ["Post-Apocalyptic", "Post-Apocalyptic"],
  ["Project", "Project"],
  ["Psychological", "Psychological"],
  ["Regression", "Regression"],
  ["Reincarnation", "Reincarnation"],
  ["Revenge", "Revenge"],
  ["Reverse Harem", "Reverse Harem"],
  ["Reverse Isekai", "Reverse Isekai"],
  ["Romance", "Romance"],
  ["Royal Family", "Royal Family"],
  ["Royalty", "Royalty"],
  ["Samurai", "Samurai"],
  ["School", "School"],
  ["Sci-fi", "Sci-fi"],
  ["Seinen", "Seinen"],
  ["Shotacon", "Shotacon"],
  ["Shoujo", "Shoujo"],
  ["Shoujo Ai", "Shoujo Ai"],
  ["Shounen", "Shounen"],
  ["Shounen Ai", "Shounen Ai"],
  ["Showbiz", "Showbiz"],
  ["Slice of Life", "Slice of Life"],
  ["Sport", "Sport"],
  ["Super Power", "Super Power"],
  ["Supernatural", "Supernatural"],
  ["Survival", "Survival"],
  ["System", "System"],
  ["Thriller", "Thriller"],
  ["Time Travel", "Time Travel"],
  ["Tragedy", "Tragedy"],
  ["Transmigration", "Transmigration"],
  ["Vampire", "Vampire"],
  ["Villain", "Villain"],
  ["Villainess", "Villainess"],
  ["Violence", "Violence"],
  ["Virtual Reality", "Virtual Reality"],
  ["Webtoons", "Webtoons"],
  ["Yakuzas", "Yakuzas"],
  ["Yaoi", "Yaoi"],
  ["Yuri", "Yuri"],
  ["Zombies", "Zombies"],
];
