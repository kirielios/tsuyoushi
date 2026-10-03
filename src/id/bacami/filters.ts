// Port of keiyoushi/extensions-source src/id/bacami/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class NewKomikFilter extends Filter.CheckBox {
  constructor() {
    super("Komik Baru");
  }
}

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

export class OrderByFilter extends UriPartFilter {
  constructor() {
    super("Order By", [
      ["Latest Updates", "latest"],
      ["Alphabetical", "name"],
      ["Score", "score"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", "all"],
      ["Hot", "hot"],
      ["Project", "project"],
      ["Completed", "tamat"],
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
    ]);
  }
}

export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      ["All", "all"],
      ["Action", "action-2"],
      ["Adult", "adult"],
      ["Adventure", "adventure"],
      ["Apocalypse", "apocalypse"],
      ["Comedy", "comedy"],
      ["Comedy Mystery Romance Slice Of Life Supernatural", "comedy-mystery-romance-slice-of-life-supernatural"],
      ["Comedy Romance Slice Of Life", "comedy-romance-slice-of-life"],
      ["Cooking", "cooking"],
      ["Crime", "crime"],
      ["Cultivation", "cultivation"],
      ["Demons", "demons"],
      ["Doujinshi", "doujinshi"],
      ["Drama", "drama"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Furry", "furry"],
      ["Game", "game"],
      ["Gender Bender", "gender-bender"],
      ["Genius", "genius"],
      ["Gore", "gore"],
      ["Harem", "harem"],
      ["Hentai", "hentai"],
      ["Historical", "historical"],
      ["Horror", "horror"],
      ["Isekai", "isekai"],
      ["Josei", "josei"],
      ["Lolicon", "lolicon"],
      ["Long Strip", "long-strip"],
      ["Love Polygon", "love-polygon"],
      ["Magic", "magic"],
      ["Magical Girl", "magical-girl"],
      ["Manhua", "manhua"],
      ["Manhwa", "manhwa"],
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
      ["Mystery Shounen", "mystery-shounen"],
      ["Mythology", "mythology"],
      ["One Shot", "one-shot"],
      ["Oneshot", "oneshot"],
      ["Parody", "parody"],
      ["Philosophical", "philosophical"],
      ["Police", "police"],
      ["Post-Apocalyptic", "post-apocalyptic"],
      ["Psychological", "psychological"],
      ["Rebirth", "rebirth"],
      ["Reincarnation", "reincarnation"],
      ["Romance", "romance"],
      ["Romantic Subtext", "romantic-subtext"],
      ["Samurai", "samurai"],
      ["School", "school"],
      ["School Life", "school-life"],
      ["Sci-fi", "sci-fi"],
      ["Seinen", "seinen"],
      ["Shotacon", "shotacon"],
      ["Shoujo", "shoujo"],
      ["Shoujo Ai", "shoujo-ai"],
      ["Shounen", "shounen"],
      ["Shounen Ai", "shounen-ai"],
      ["Slice of Life", "slice-of-life"],
      ["Smut", "smut"],
      ["Space", "space"],
      ["Sports", "sports"],
      ["Superhero", "superhero"],
      ["Supernatural", "supernatural"],
      ["Super Power", "super-power"],
      ["Survival", "survival"],
      ["Suspense", "suspense"],
      ["System", "system"],
      ["Team Sports", "team-sports"],
      ["Thriller", "thriller"],
      ["Time Travel", "time-travel"],
      ["Tragedy", "tragedy"],
      ["Urban", "urban"],
      ["Urban Fantasy", "urban-fantasy"],
      ["Vampire", "vampire"],
      ["Video Game", "video-game"],
      ["Villainess", "villainess"],
      ["Visual Arts", "visual-arts"],
      ["Webtoon", "webtoon"],
      ["Webtoons", "webtoons"],
      ["Wuxia", "wuxia"],
      ["Yaoi", "yaoi"],
      ["Yuri", "yuri"],
      ["Zombies", "zombies"],
    ]);
  }
}
