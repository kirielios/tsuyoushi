// Port of keiyoushi/extensions-source src/id/komikindoid/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
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

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year");
  }
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["A-Z", "title"],
      ["Z-A", "titlereverse"],
      ["Latest Update", "update"],
      ["Latest Added", "latest"],
      ["Popular", "popular"],
    ]);
  }
}

/** Every checkbox type upstream declares is `class X(name: String, val id: String = name) : Filter.CheckBox(name)`. */
export class IdCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name);
  }
}

export class OriginalLanguage extends IdCheckBox {}
export class OriginalLanguageFilter extends Filter.Group<OriginalLanguage> {
  constructor(list: OriginalLanguage[]) {
    super("Original language", list);
  }
}
export const getOriginalLanguage = () => [
    new OriginalLanguage("Japanese (Manga)", "Manga"),
    new OriginalLanguage("Chinese (Manhua)", "Manhua"),
    new OriginalLanguage("Korean (Manhwa)", "Manhwa"),
];

export class Format extends IdCheckBox {}
export class FormatFilter extends Filter.Group<Format> {
  constructor(list: Format[]) {
    super("Format", list);
  }
}
export const getFormat = () => [
    new Format("Black & White", "0"),
    new Format("Full Color", "1"),
];

export class Demographic extends IdCheckBox {}
export class DemographicFilter extends Filter.Group<Demographic> {
  constructor(list: Demographic[]) {
    super("Publication Demographic", list);
  }
}
export const getDemographic = () => [
    new Demographic("Josei", "josei"),
    new Demographic("Seinen", "seinen"),
    new Demographic("Shoujo", "shoujo"),
    new Demographic("Shounen", "shounen"),
];

export class Status extends IdCheckBox {}
export class StatusFilter extends Filter.Group<Status> {
  constructor(list: Status[]) {
    super("Status", list);
  }
}
export const getStatus = () => [
    new Status("Ongoing", "Ongoing"),
    new Status("Completed", "Completed"),
];

export class ContentRating extends IdCheckBox {}
export class ContentRatingFilter extends Filter.Group<ContentRating> {
  constructor(list: ContentRating[]) {
    super("Content Rating", list);
  }
}
export const getContentRating = () => [
    new ContentRating("Ecchi", "ecchi"),
    new ContentRating("Gore", "gore"),
    new ContentRating("Sexual Violence", "sexual-violence"),
    new ContentRating("Smut", "smut"),
];

export class Theme extends IdCheckBox {}
export class ThemeFilter extends Filter.Group<Theme> {
  constructor(list: Theme[]) {
    super("Story Theme", list);
  }
}
export const getTheme = () => [
    new Theme("Alien", "aliens"),
    new Theme("Animal", "animals"),
    new Theme("Cooking", "cooking"),
    new Theme("Crossdressing", "crossdressing"),
    new Theme("Delinquent", "delinquents"),
    new Theme("Demon", "demons"),
    new Theme("Ecchi", "ecchi"),
    new Theme("Gal", "gyaru"),
    new Theme("Genderswap", "genderswap"),
    new Theme("Ghost", "ghosts"),
    new Theme("Harem", "harem"),
    new Theme("Incest", "incest"),
    new Theme("Loli", "loli"),
    new Theme("Mafia", "mafia"),
    new Theme("Magic", "magic"),
    new Theme("Martial Arts", "martial-arts"),
    new Theme("Military", "military"),
    new Theme("Monster Girls", "monster-girls"),
    new Theme("Monsters", "monsters"),
    new Theme("Music", "music"),
    new Theme("Ninja", "ninja"),
    new Theme("Office Workers", "office-workers"),
    new Theme("Police", "police"),
    new Theme("Post-Apocalyptic", "post-apocalyptic"),
    new Theme("Reincarnation", "reincarnation"),
    new Theme("Reverse Harem", "reverse-harem"),
    new Theme("Samurai", "samurai"),
    new Theme("School Life", "school-life"),
    new Theme("Shota", "shota"),
    new Theme("Smut", "smut"),
    new Theme("Supernatural", "supernatural"),
    new Theme("Survival", "survival"),
    new Theme("Time Travel", "time-travel"),
    new Theme("Traditional Games", "traditional-games"),
    new Theme("Vampires", "vampires"),
    new Theme("Video Games", "video-games"),
    new Theme("Villainess", "villainess"),
    new Theme("Virtual Reality", "virtual-reality"),
    new Theme("Zombies", "zombies"),
];

export class Genre extends IdCheckBox {}
export class GenreFilter extends Filter.Group<Genre> {
  constructor(list: Genre[]) {
    super("Genre", list);
  }
}
export const getGenre = () => [
    new Genre("Action", "action"),
    new Genre("Adventure", "adventure"),
    new Genre("Comedy", "comedy"),
    new Genre("Crime", "crime"),
    new Genre("Drama", "drama"),
    new Genre("Fantasy", "fantasy"),
    new Genre("Girls Love", "girls-love"),
    new Genre("Harem", "harem"),
    new Genre("Historical", "historical"),
    new Genre("Horror", "horror"),
    new Genre("Isekai", "isekai"),
    new Genre("Magical Girls", "magical-girls"),
    new Genre("Mecha", "mecha"),
    new Genre("Medical", "medical"),
    new Genre("Philosophical", "philosophical"),
    new Genre("Psychological", "psychological"),
    new Genre("Romance", "romance"),
    new Genre("Sci-Fi", "sci-fi"),
    new Genre("Shoujo Ai", "shoujo-ai"),
    new Genre("Shounen Ai", "shounen-ai"),
    new Genre("Slice of Life", "slice-of-life"),
    new Genre("Sports", "sports"),
    new Genre("Superhero", "superhero"),
    new Genre("Thriller", "thriller"),
    new Genre("Tragedy", "tragedy"),
    new Genre("Wuxia", "wuxia"),
    new Genre("Yuri", "yuri"),
];
