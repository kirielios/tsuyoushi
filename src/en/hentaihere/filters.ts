// Port of keiyoushi/extensions-source src/en/hentaihere/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export const sortFilterList: [string, string][] = [
  ["newest", "Newest"],
  ["most-popular", "Most Popular"],
  ["last-updated", "Last Updated"],
  ["most-viewed", "Most Viewed"],
  ["alphabetical", "Alphabetical"],
  ["", "----"],
  ["staff-pick", "Staff Pick"],
  ["last-month", "Popular (Monthly)"],
  ["last-week", "Popular (Weekly)"],
  ["yesterday", "Popular (Daily)"],
  ["trending", "Trending"],
];

export const alphabetFilterList: [string, string][] = [
  ["", "All"],
  ["a", "A"],
  ["b", "B"],
  ["c", "C"],
  ["d", "D"],
  ["e", "E"],
  ["f", "F"],
  ["g", "G"],
  ["h", "H"],
  ["i", "I"],
  ["j", "J"],
  ["k", "K"],
  ["l", "L"],
  ["m", "M"],
  ["n", "N"],
  ["o", "O"],
  ["p", "P"],
  ["q", "Q"],
  ["r", "R"],
  ["s", "S"],
  ["t", "T"],
  ["u", "U"],
  ["v", "V"],
  ["w", "W"],
  ["x", "X"],
  ["y", "Y"],
  ["z", "Z"],
];

export const statusFilterList: [string, string][] = [
  ["", "All"],
  ["ongoing", "Ongoing"],
  ["completed", "Completed"],
];

export const categoryFilterList: [string, string][] = [
  ["", "All"],
  ["t34", "Adult"],
  ["t7", "Anal"],
  ["t372", "Beastiality"],
  ["t20", "Big Breasts"],
  ["t43", "Comedy"],
  ["t46", "Compilation"],
  ["t42", "Doujinshi"],
  ["t40", "Ecchi"],
  ["t6", "Fantasy"],
  ["t14", "Futanari"],
  ["t302", "Guro"],
  ["t31", "Harem"],
  ["t15", "Incest"],
  ["t2650", "Isekai (Otherworld)"],
  ["t2158", "Korean Comic"],
  ["t50", "Licensed"],
  ["t17", "Lolicon"],
  ["t30", "Mecha"],
  ["t2503", "No Penetration"],
  ["t33", "Oneshot"],
  ["t23", "Rape"],
  ["t567", "Reverse Harem"],
  ["t41", "Romance"],
  ["t432", "Scat"],
  ["t48", "School Life"],
  ["t5", "Sci-fi"],
  ["t32", "Serialized"],
  ["t44", "Shotacon"],
  ["t49", "Tragedy"],
  ["t47", "Uncensored"],
  ["t27", "Yaoi"],
  ["t28", "Yuri"],
];

export class SortFilter extends Filter.Select<string> {
  constructor(sortables: string[], state = 1) {
    super("Sort", sortables, state);
  }
}

export class AlphabetFilter extends Filter.Select<string> {
  constructor(alphabet: string[]) {
    super("Starts With", alphabet, 0);
  }
}

export class StatusFilter extends Filter.Select<string> {
  constructor(statuses: string[]) {
    super("Status", statuses, 0);
  }
}

export class CategoryFilter extends Filter.Select<string> {
  constructor(categories: string[]) {
    super("Category", categories, 0);
  }
}
