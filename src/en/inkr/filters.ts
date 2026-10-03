// Port of keiyoushi/extensions-source src/en/inkr/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

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
  get selected(): string {
    return this.vals[this.state][1];
  }
}

export class TypeFilter extends UriPartFilter {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "manga"],
      ["Manhua", "manhua"],
      ["Manhwa", "manhwa"],
      ["Western comics", "western-comics"],
    ]);
  }
}

export class StatusFilter extends UriPartFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<GenreCheckBox> {
  constructor(letter: string, genres: [string, string][]) {
    super(
      letter,
      genres.map((it) => new GenreCheckBox(it[0], it[1])),
    );
  }
}

export class GenreFilters extends Filter.Group<GenreFilter> {
  constructor(genres: [string, string][]) {
    const groups = new Map<string, [string, string][]>();
    for (const it of [...genres].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const c = it[0].charAt(0).toUpperCase() || null;
      const letter = c == null || !(c >= "A" && c <= "Z") ? "0-9" : c;
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(it);
    }
    super(
      "Genres",
      [...groups].map(([letter, chunk]) => new GenreFilter(letter, chunk)),
    );
  }
}

export const defaultFilterList = (genres: [string, string][] = GENRES) => FilterList(new TypeFilter(), new StatusFilter(), new GenreFilters(genres));

// Genre ids from https://comics.inkr.com/sitemap/comics.xml (`/genre/{id}-{slug}/titles`)
export const GENRES: [string, string][] = [
  ["Action", "ik-genre-2"],
  ["Adult Cast", "ik-genre-93"],
  ["Adult Men", "ik-genre-87"],
  ["Adult Women", "ik-genre-138"],
  ["Adventure", "ik-genre-8"],
  ["Age Gap", "ik-genre-149"],
  ["Alternative World", "ik-genre-143"],
  ["Animals", "ik-genre-31"],
  ["Anthropomorphic", "ik-genre-35"],
  ["Avant Garde", "ik-genre-151"],
  ["BL / Boys Love", "ik-genre-33"],
  ["CEOs", "ik-genre-156"],
  ["CGDCT", "ik-genre-94"],
  ["Childcare", "ik-genre-95"],
  ["Childhood Friends", "ik-genre-150"],
  ["Cohabitation", "ik-genre-144"],
  ["Combat Sports", "ik-genre-96"],
  ["Comedy", "ik-genre-3"],
  ["Coming of Age", "ik-genre-147"],
  ["Crime", "ik-genre-25"],
  ["Crossdressing", "ik-genre-97"],
  ["Cultivation", "ik-genre-142"],
  ["Cyberpunk", "ik-genre-98"],
  ["Delinquents", "ik-genre-99"],
  ["Detective", "ik-genre-100"],
  ["Disability", "ik-genre-145"],
  ["Drama", "ik-genre-12"],
  ["Ecchi", "ik-genre-6"],
  ["Educational", "ik-genre-101"],
  ["Family Life", "ik-genre-148"],
  ["Fantasy", "ik-genre-9"],
  ["Folklore", "ik-genre-158"],
  ["Gag Humor", "ik-genre-102"],
  ["Gender Bender", "ik-genre-62"],
  ["GL / Girls Love", "ik-genre-30"],
  ["Gore", "ik-genre-103"],
  ["Gourmet", "ik-genre-91"],
  ["Harem", "ik-genre-43"],
  ["Harem Fight", "ik-genre-137"],
  ["Healing", "ik-genre-107"],
  ["High Stakes Game", "ik-genre-104"],
  ["Historical", "ik-genre-18"],
  ["Historical Fiction", "ik-genre-59"],
  ["Horror", "ik-genre-16"],
  ["Idols (Female)", "ik-genre-105"],
  ["Idols (Male)", "ik-genre-106"],
  ["Individual Sport", "ik-genre-157"],
  ["Isekai", "ik-genre-38"],
  ["Kids", "ik-genre-141"],
  ["LGBTQI", "ik-genre-32"],
  ["Love Polygon", "ik-genre-108"],
  ["Magic", "ik-genre-10"],
  ["Magical Girls", "ik-genre-110"],
  ["Magical Sex Shift", "ik-genre-109"],
  ["Married Life", "ik-genre-155"],
  ["Martial Arts", "ik-genre-4"],
  ["Mature", "ik-genre-58"],
  ["Mecha", "ik-genre-15"],
  ["Medical", "ik-genre-111"],
  ["Memoir", "ik-genre-112"],
  ["Military", "ik-genre-41"],
  ["Music", "ik-genre-21"],
  ["Mystery", "ik-genre-24"],
  ["Mythology", "ik-genre-113"],
  ["Neighbors", "ik-genre-160"],
  ["Omegaverse", "ik-genre-152"],
  ["One Shot", "ik-genre-23"],
  ["Organized Crime", "ik-genre-114"],
  ["Otaku Culture", "ik-genre-115"],
  ["Parody", "ik-genre-60"],
  ["Performing Arts", "ik-genre-116"],
  ["Pirates", "ik-genre-154"],
  ["Political", "ik-genre-136"],
  ["Psychological", "ik-genre-11"],
  ["Racing", "ik-genre-118"],
  ["Reincarnation", "ik-genre-119"],
  ["Religion", "ik-genre-159"],
  ["Revenge", "ik-genre-146"],
  ["Reverse Harem", "ik-genre-120"],
  ["Romance", "ik-genre-5"],
  ["Romantic Subtext", "ik-genre-121"],
  ["Samurai", "ik-genre-122"],
  ["School", "ik-genre-7"],
  ["Sci-Fi", "ik-genre-27"],
  ["Showbiz", "ik-genre-123"],
  ["Shoujo Ai", "ik-genre-28"],
  ["Shounen Ai", "ik-genre-19"],
  ["Slice of Life", "ik-genre-13"],
  ["Space", "ik-genre-124"],
  ["Sports", "ik-genre-20"],
  ["Steampunk", "ik-genre-135"],
  ["Strategy Game", "ik-genre-125"],
  ["Super Power", "ik-genre-126"],
  ["Superhero", "ik-genre-29"],
  ["Supernatural", "ik-genre-1"],
  ["Survival", "ik-genre-127"],
  ["Suspense", "ik-genre-92"],
  ["Team Sports", "ik-genre-128"],
  ["Teen Boys", "ik-genre-140"],
  ["Teen Girls", "ik-genre-139"],
  ["Thriller", "ik-genre-17"],
  ["Time Travel", "ik-genre-129"],
  ["TL (Teens' Love)", "ik-genre-88"],
  ["Vampires", "ik-genre-22"],
  ["Video Game", "ik-genre-131"],
  ["Villainess", "ik-genre-132"],
  ["Visual Arts", "ik-genre-133"],
  ["Workplace", "ik-genre-134"],
  ["Xuanhuan", "ik-genre-34"],
  ["Yaoi", "ik-genre-14"],
  ["Yuri", "ik-genre-39"],
  ["Zombies", "ik-genre-153"],
];
