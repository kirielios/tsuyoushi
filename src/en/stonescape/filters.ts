// Port of keiyoushi/extensions-source src/en/stonescape/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [["All", ""], ["Ongoing", "ongoing"], ["Completed", "completed"], ["Hiatus", "hiatus"]]);
  }
}

export class Genre extends Filter.CheckBox {
  constructor(name: string, readonly slug: string) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

export const getGenreList = () => [
  new Genre("Action", "action"),
  new Genre("Adaptation", "adaptation"),
  new Genre("Adult", "adult"),
  new Genre("Adventure", "adventure"),
  new Genre("Comedy", "comedy"),
  new Genre("Demons", "demons"),
  new Genre("Drama", "drama"),
  new Genre("Ecchi", "ecchi"),
  new Genre("Fantasy", "fantasy"),
  new Genre("Gender Bender", "genderbender"),
  new Genre("Gore", "gore"),
  new Genre("Harem", "harem"),
  new Genre("Historical", "historical"),
  new Genre("Horror", "horror"),
  new Genre("Isekai", "isekai"),
  new Genre("Josei", "josei"),
  new Genre("Magic", "magic"),
  new Genre("Martial Arts", "martialarts"),
  new Genre("Mature", "mature"),
  new Genre("Mecha", "mecha"),
  new Genre("Military", "military"),
  new Genre("Monsters", "monsters"),
  new Genre("Mystery", "mystery"),
  new Genre("Post-Apocalyptic", "post-apocalyptic"),
  new Genre("Psychological", "psychological"),
  new Genre("Romance", "romance"),
  new Genre("School Life", "schoollife"),
  new Genre("Sci-Fi", "sci-fi"),
  new Genre("Seinen", "seinen"),
  new Genre("Shoujo", "shoujo"),
  new Genre("Shoujo Ai", "shoujoai"),
  new Genre("Shounen", "shounen"),
  new Genre("Shounen Ai", "shounenai"),
  new Genre("Slice of Life", "sliceoflife"),
  new Genre("Smut", "smut"),
  new Genre("Sports", "sports"),
  new Genre("Supernatural", "supernatural"),
  new Genre("Thriller", "thriller"),
  new Genre("Tragedy", "tragedy"),
  new Genre("Video Games", "video-games"),
  new Genre("Webtoons", "webtoons"),
  new Genre("Wuxia", "wuxia"),
  new Genre("Yaoi", "yaoi"),
  new Genre("Yuri", "yuri"),
];

export function genreLabel(slug: string): string {
  return getGenreList().find((it) => it.slug.toLowerCase() === slug.toLowerCase())?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function findGenre(query: string): Genre | null {
  const normalized = query.replaceAll("-", "").replaceAll(" ", "");
  return (
    getGenreList().find(
      (genre) =>
        genre.name.toLowerCase() === query.toLowerCase() ||
        genre.slug.toLowerCase() === query.toLowerCase() ||
        genre.name.replaceAll("-", "").replaceAll(" ", "").toLowerCase() === normalized.toLowerCase(),
    ) ?? null
  );
}
