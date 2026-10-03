// Port of keiyoushi/extensions-source src/en/manhwazone/Filters.kt
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
  toUriPart = () => this.vals[this.state][1];
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["Popularity", "popularity"],
      ["Latest", "latest"],
      ["Rank", "rank"],
      ["Score", "score"],
      ["Follower", "follower"],
      ["A → Z", "name_asc"],
      ["Z → A", "name_desc"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All Status", ""],
      ["Finished", "finished"],
      ["On Hiatus", "on_hiatus"],
      ["On Going", "currently_publishing"],
      ["Discontinued", "discontinued"],
    ]);
  }
}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

export class GenreFilterGroup extends Filter.Group<GenreCheckBox> {
  constructor(genres: GenreCheckBox[]) {
    super("Genres", genres);
  }
}

export const getGenreList = () => [
  new GenreCheckBox("Action", "action"),
  new GenreCheckBox("Adventure", "adventure"),
  new GenreCheckBox("Avant Garde", "avant-garde"),
  new GenreCheckBox("Award Winning", "award-winning"),
  new GenreCheckBox("Boys Love", "boys-love"),
  new GenreCheckBox("Comedy", "comedy"),
  new GenreCheckBox("Drama", "drama"),
  new GenreCheckBox("Fantasy", "fantasy"),
  new GenreCheckBox("Girls Love", "girls-love"),
  new GenreCheckBox("Gourmet", "gourmet"),
  new GenreCheckBox("Horror", "horror"),
  new GenreCheckBox("Mystery", "mystery"),
  new GenreCheckBox("Romance", "romance"),
  new GenreCheckBox("Sci-Fi", "sci-fi"),
  new GenreCheckBox("Slice of Life", "slice-of-life"),
  new GenreCheckBox("Sports", "sports"),
  new GenreCheckBox("Supernatural", "supernatural"),
  new GenreCheckBox("Suspense", "suspense"),
  new GenreCheckBox("Urban Fantasy", "urban-fantasy"),
  new GenreCheckBox("Ecchi", "ecchi"),
  new GenreCheckBox("Erotica", "erotica"),
  new GenreCheckBox("Hentai", "hentai"),
  new GenreCheckBox("Adult Cast", "adult-cast"),
  new GenreCheckBox("Anthropomorphic", "anthropomorphic"),
  new GenreCheckBox("CGDCT", "cgdct"),
  new GenreCheckBox("Childcare", "childcare"),
  new GenreCheckBox("Combat Sports", "combat-sports"),
  new GenreCheckBox("Crossdressing", "crossdressing"),
  new GenreCheckBox("Delinquents", "delinquents"),
  new GenreCheckBox("Detective", "detective"),
  new GenreCheckBox("Educational", "educational"),
  new GenreCheckBox("Gag Humor", "gag-humor"),
  new GenreCheckBox("Gore", "gore"),
  new GenreCheckBox("Harem", "harem"),
  new GenreCheckBox("High Stakes Game", "high-stakes-game"),
  new GenreCheckBox("Historical", "historical"),
  new GenreCheckBox("Idols (Female)", "idols-female"),
  new GenreCheckBox("Idols (Male)", "idols-male"),
  new GenreCheckBox("Isekai", "isekai"),
  new GenreCheckBox("Iyashikei", "iyashikei"),
  new GenreCheckBox("Love Polygon", "love-polygon"),
  new GenreCheckBox("Magical Sex Shift", "magical-sex-shift"),
  new GenreCheckBox("Mahou Shoujo", "mahou-shoujo"),
  new GenreCheckBox("Martial Arts", "martial-arts"),
  new GenreCheckBox("Mecha", "mecha"),
  new GenreCheckBox("Medical", "medical"),
  new GenreCheckBox("Memoir", "memoir"),
  new GenreCheckBox("Military", "military"),
  new GenreCheckBox("Music", "music"),
  new GenreCheckBox("Mythology", "mythology"),
  new GenreCheckBox("Organized Crime", "organized-crime"),
  new GenreCheckBox("Otaku Culture", "otaku-culture"),
  new GenreCheckBox("Parody", "parody"),
  new GenreCheckBox("Performing Arts", "performing-arts"),
  new GenreCheckBox("Pets", "pets"),
  new GenreCheckBox("Psychological", "psychological"),
  new GenreCheckBox("Racing", "racing"),
  new GenreCheckBox("Reincarnation", "reincarnation"),
  new GenreCheckBox("Reverse Harem", "reverse-harem"),
  new GenreCheckBox("Romantic Subtext", "romantic-subtext"),
  new GenreCheckBox("Samurai", "samurai"),
  new GenreCheckBox("School", "school"),
  new GenreCheckBox("Showbiz", "showbiz"),
  new GenreCheckBox("Space", "space"),
  new GenreCheckBox("Strategy Game", "strategy-game"),
  new GenreCheckBox("Super Power", "super-power"),
  new GenreCheckBox("Survival", "survival"),
  new GenreCheckBox("Team Sports", "team-sports"),
  new GenreCheckBox("Time Travel", "time-travel"),
  new GenreCheckBox("Vampire", "vampire"),
  new GenreCheckBox("Video Game", "video-game"),
  new GenreCheckBox("Villainess", "villainess"),
  new GenreCheckBox("Visual Arts", "visual-arts"),
  new GenreCheckBox("Workplace", "workplace"),
  new GenreCheckBox("Josei", "josei"),
  new GenreCheckBox("Kids", "kids"),
  new GenreCheckBox("Seinen", "seinen"),
  new GenreCheckBox("Shoujo", "shoujo"),
  new GenreCheckBox("Shounen", "shounen"),
];
