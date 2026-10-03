// Port of keiyoushi/extensions-source src/id/softkomik/Filters.kt
import { Filter } from "../../../sdk/index.ts";

abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
    state = 0,
  ) {
    super(
      name,
      options.map((it) => it[0]),
      state,
    );
  }
  get selected() {
    return this.options[this.state][1];
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["Semua", ""],
      ["Ongoing", "ongoing"],
      ["Tamat", "tamat"],
    ]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["Semua", ""],
      ["Manga", "manga"],
      ["Manhua", "manhua"],
      ["Manhwa", "manhwa"],
    ]);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Terbaru", "newKomik"],
      ["Popular", "popular"],
    ]);
  }
}

export class MinChapterFilter extends Filter.Text {
  constructor() {
    super("Minimal Chapter");
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genre", [
      ["Semua Genre", ""],
      ["Action", "Action"],
      ["Adventure", "Adventure"],
      ["Comedy", "Comedy"],
      ["Cooking", "Cooking"],
      ["Crime", "Crime"],
      ["Demon", "demon"],
      ["Drama", "Drama"],
      ["Ecchi", "Ecchi"],
      ["Fantasy", "Fantasy"],
      ["Game", "Game"],
      ["Gender Bender", "Gender Bender"],
      ["Gore", "Gore"],
      ["Harem", "Harem"],
      ["Historical", "Historical"],
      ["Horror", "Horror"],
      ["Isekai", "Isekai"],
      ["Josei", "Josei"],
      ["Magic", "magic"],
      ["Martial Arts", "Martial Arts"],
      ["Mature", "Mature"],
      ["Mecha", "Mecha"],
      ["Medical", "Medical"],
      ["Military", "Military"],
      ["Music", "Musyc"],
      ["Mystery", "Mystery"],
      ["Parody", "parody"],
      ["Police", "Police"],
      ["Psychological", "Psychological"],
      ["Reincarnation", "Reincarnation"],
      ["Romance", "Romance"],
      ["School", "School"],
      ["School Life", "School Life"],
      ["Sci-fi", "Sci-fi"],
      ["Seinen", "Seinen"],
      ["Shoujo", "Shoujo"],
      ["Shoujo Ai", "Shoujo Ai"],
      ["Shounen", "Shounen"],
      ["Shounen Ai", "Shounen Ai"],
      ["Slice of Life", "Slice of Life"],
      ["Sports", "Sports"],
      ["Super Power", "Super Power"],
      ["Supernatural", "Supernatural"],
      ["Thriller", "Thriler"],
      ["Tragedy", "Tragedy"],
      ["Webtoons", "Webtoons"],
      ["Yaoi", "Yaoi"],
      ["Yuri", "Yuri"],
      ["Zombies", "zombies"],
    ]);
  }
}
