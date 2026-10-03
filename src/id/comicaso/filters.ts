// Port of keiyoushi/extensions-source src/id/comicaso/Filters.kt
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

export class SourceFilter extends UriPartFilter {
  constructor() {
    super("Source", [
      ["All", "all"],
      ["Comicazen", "comicazen"],
      ["Medusa", "medusa"],
    ]);
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", "all"],
      ["Manga", "manga"],
      ["Manhua", "manhua"],
      ["Manhwa", "manhwa"],
      ["One Shot", "one shot"],
    ]);
  }
}

export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      ["All", ""],
      ["Action", "action"],
      ["Adaptation", "Adaptation"],
      ["Adventure", "adventure"],
      ["Age Gap", "Age Gap"],
      ["Aliens", "Aliens"],
      ["Animals", "Animals"],
      ["Beasts", "Beasts"],
      ["Bloody", "Bloody"],
      ["Bodyswap", "Bodyswap"],
      ["Boys", "boys"],
      ["Cheating/Infidelity", "Cheating/Infidelity"],
      ["Childhood Friends", "Childhood Friends"],
      ["College life", "College life"],
      ["Comedy", "Comedy"],
      ["Cooking", "Cooking"],
      ["Crime", "Crime"],
      ["Crossdressing", "Crossdressing"],
      ["Delinquents", "Delinquents"],
      ["Demons", "Demons"],
      ["Drama", "drama"],
      ["Dungeons", "Dungeons"],
      ["Ecchi", "ecchi"],
      ["Emperor's daughte", "Emperor's daughte"],
      ["Fantasy", "Fantasy"],
      ["Fighting", "fighting"],
      ["Full Color", "Full Color"],
      ["Game", "Game"],
      ["Gender Bender", "Gender Bender"],
      ["Genderswap", "Genderswap"],
      ["Ghosts", "Ghosts"],
      ["Girl", "girl"],
      ["Girls", "Girls"],
      ["Gore", "gore"],
      ["Harem", "Harem"],
      ["Historical", "Historical"],
      ["Horror", "horror"],
      ["Incest", "Incest"],
      ["Isekai", "Isekai"],
      ["Josei(W)", "Josei(W)"],
      ["Kids", "Kids"],
      ["Magic", "Magic"],
      ["Magical Girls", "Magical Girls"],
      ["Manga", "manga"],
      ["Manhua", "Manhua"],
      ["Manhwa", "manhwa"],
      ["Martial Arts", "Martial Arts"],
      ["Mature", "Mature"],
      ["Medical", "Medical"],
      ["Military", "Military"],
      ["Monster Girls", "Monster Girls"],
      ["Monsters", "Monsters"],
      ["Music", "Music"],
      ["Mystery", "Mystery"],
      ["NTR", "NTR"],
      ["Office Workers", "Office Workers"],
      ["Philosophical", "Philosophical"],
      ["Police", "Police"],
      ["Psychological", "Psychological"],
      ["Regression", "Regression"],
      ["Reincarnation", "Reincarnation"],
      ["Revenge", "Revenge"],
      ["Reverse Harem", "Reverse Harem"],
      ["Reverse Isekai", "Reverse Isekai"],
      ["Romance", "Romance"],
      ["Royal family", "Royal family"],
      ["Royalty", "Royalty"],
      ["School Life", "School Life"],
      ["Sci-Fi", "Sci-Fi"],
      ["Seinen(M)", "Seinen(M)"],
      ["Sejarah", "Sejarah"],
      ["Shoujo(G)", "Shoujo(G)"],
      ["Shounen ai", "Shounen ai"],
      ["Shounen(B)", "Shounen(B)"],
      ["Showbiz", "Showbiz"],
      ["Slice of Life", "Slice of Life"],
      ["Smut", "Smut"],
      ["Sports", "Sports"],
      ["Super Power", "Super Power"],
      ["Superhero", "Superhero"],
      ["Supernatural", "Supernatural"],
      ["Survival", "Survival"],
      ["Thriller", "Thriller"],
      ["Time Travel", "Time Travel"],
      ["Tower Climbing", "Tower Climbing"],
      ["Tragedy", "Tragedy"],
      ["Transmigration", "Transmigration"],
      ["Vampires", "Vampires"],
      ["Video Games", "Video Games"],
      ["Villainess", "Villainess"],
      ["Violence", "Violence"],
      ["Western", "Western"],
      ["Yuri(GL)", "Yuri(GL)"],
      ["Zombies", "Zombies"],
    ]);
  }
}
