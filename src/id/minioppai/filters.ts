// Port of yuzono/anime-extensions src/id/minioppai/MiniOppaiFilters.kt
import { firstInstance, type FilterList } from "../../../sdk/index.ts";
import { CheckBoxFilterList, QueryPartFilter } from "../../../themes/animestream/index.ts";

const ORDER_LIST: [string, string][] = [
  ["Release date", "added"],
  ["IMDb", "imdb"],
  ["Latest", "latest"],
  ["Most viewed", "popular"],
  ["Name", "title"],
];

const GENRES_LIST: [string, string][] = [
  ["3D Hentai", "3d-hentai"],
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Ahegao", "ahegao"],
  ["Anal", "anal"],
  ["Armpit", "armpit"],
  ["Ashikoki", "ashikoki"],
  ["BDSM", "bdsm"],
  ["Big Oppai", "big-oppai"],
  ["Blowjob", "blowjob"],
  ["Bondage", "bondage"],
  ["Censored", "censored"],
  ["Cheating", "cheating"],
  ["Chikan", "chikan"],
  ["Comedy", "comedy"],
  ["Cosplay", "cosplay"],
  ["Creampie", "creampie"],
  ["Crime", "crime"],
  ["Dark Skin", "dark-skin"],
  ["Demons", "demons"],
  ["Doctor", "doctor"],
  ["Domination", "domination"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Elf", "elf"],
  ["Eroge", "eroge"],
  ["Exhibitionist", "exhibitionist"],
  ["Facial", "facial"],
  ["Fantasy", "fantasy"],
  ["Fellatio", "fellatio"],
  ["Female Monster", "female-monster"],
  ["Femdom", "femdom"],
  ["Fetish", "fetish"],
  ["Footjob", "footjob"],
  ["Forced", "forced"],
  ["Futanari", "futanari"],
  ["Gal", "gal"],
  ["Gangbang", "gangbang"],
  ["Group", "group"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Housewife", "housewife"],
  ["Humiliation", "humiliation"],
  ["Idol", "idol"],
  ["Incest", "incest"],
  ["Intercrural", "intercrural"],
  ["Josei", "josei"],
  ["Kemonomimi", "kemonomimi"],
  ["Kimono", "kimono"],
  ["Lactation", "lactation"],
  ["Lingerie", "lingerie"],
  ["MILF", "milf"],
  ["Magic", "magic"],
  ["Maid", "maid"],
  ["Male Monster", "male-monster"],
  ["Martial Arts", "martial-arts"],
  ["Masturbation", "masturbation"],
  ["Mecha", "mecha"],
  ["Megane", "megane"],
  ["Mind Control", "mind-control"],
  ["Mizugi", "mizugi"],
  ["Monster", "monster"],
  ["Mystery", "mystery"],
  ["Neko", "neko"],
  ["Netorare", "netorare"],
  ["Nurse", "nurse"],
  ["Office", "office"],
  ["Onee-san", "onee-san"],
  ["Onsen", "onsen"],
  ["Oppai", "oppai"],
  ["Oral", "oral"],
  ["Osananajimi", "osananajimi"],
  ["Outdoor", "outdoor"],
  ["Paizuri", "paizuri"],
  ["Pantyhose", "pantyhose"],
  ["Pantyhouse", "pantyhouse"],
  ["Parody", "parody"],
  ["Pregnant", "pregnant"],
  ["Prostitution", "prostitution"],
  ["Rape", "rape"],
  ["Romance", "romance"],
  ["School", "school"],
  ["Schoolgirl", "schoolgirl"],
  ["Seinen", "seinen"],
  ["Sex Toys", "sex-toys"],
  ["Shibari", "shibari"],
  ["Shota", "shota"],
  ["Shoujo", "shoujo"],
  ["Shounen", "shounen"],
  ["Stocking", "stocking"],
  ["Succubus", "succubus"],
  ["Supernatural", "supernatural"],
  ["Swimsuit", "swimsuit"],
  ["Teacher", "teacher"],
  ["Tennis", "tennis"],
  ["Tentacles", "tentacles"],
  ["Threesome", "threesome"],
  ["Tsundere", "tsundere"],
  ["Uncensored", "uncensored"],
  ["stock", "stock"],
];

const COUNTRIES_LIST: [string, string][] = [
  ["JP", "jp"],
  ["TH", "th"],
];

const QUALITIES_LIST: [string, string][] = [
  ["BD", "bd"],
  ["Censored", "censored"],
  ["HD", "hd"],
  ["TV", "tv"],
  ["Uncensored", "uncensored"],
  ["Web", "web"],
];

const STATUS_LIST: [string, string][] = [
  ["Completed", "completed"],
  ["Dropped", "dropped"],
  ["Ongoing", "ongoing"],
];

const YEARS_LIST: [string, string][] = Array.from({ length: 24 }, (_, i) => String(2024 - i)).map((y) => [y, y]);

export class OrderFilter extends QueryPartFilter {
  constructor() {
    super("Order", ORDER_LIST);
  }
}
export class GenresFilter extends CheckBoxFilterList {
  constructor() {
    super("Genres", GENRES_LIST);
  }
}
export class CountriesFilter extends CheckBoxFilterList {
  constructor() {
    super("Countries", COUNTRIES_LIST);
  }
}
export class QualitiesFilter extends CheckBoxFilterList {
  constructor() {
    super("Qualities", QUALITIES_LIST);
  }
}
export class YearsFilter extends CheckBoxFilterList {
  constructor() {
    super("Years", YEARS_LIST);
  }
}
export class StatusFilter extends CheckBoxFilterList {
  constructor() {
    super("Status", STATUS_LIST);
  }
}

export const getFilterList = (): FilterList => [new OrderFilter(), new GenresFilter(), new CountriesFilter(), new QualitiesFilter(), new YearsFilter(), new StatusFilter()];

export function getSearchParameters(filters: FilterList) {
  if (!filters.length) return { order: "", multi: [] as string[] };
  return {
    order: firstInstance(filters, OrderFilter).toQueryPart(),
    multi: [
      firstInstance(filters, GenresFilter).toQueryPart("genre"),
      firstInstance(filters, CountriesFilter).toQueryPart("country"),
      firstInstance(filters, QualitiesFilter).toQueryPart("quality"),
      firstInstance(filters, YearsFilter).toQueryPart("years"),
      firstInstance(filters, StatusFilter).toQueryPart("status"),
    ],
  };
}
