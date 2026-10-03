// Port of keiyoushi/extensions-source src/en/asiatoon/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const browseEntries: [string, string][] = [
  ["Home", "en"],
  ["New", "en/genres/New"],
  ["Completed", "en/completed"],
  ["Page: Honey Toon", "en/pages/honey-toon"],
  ["Page: Manhwa toon", "en/pages/manhwa-toon"],
  ["Page: Manga toon", "en/pages/manga-toon"],
  ["Page: Comics toon", "en/pages/comics-toon"],
  ["Page: Toon God", "en/pages/toon-god"],
  ["Page: Toon Porn", "en/pages/toon-porn"],
  ["Genre: All", "en/genres"],
  ["Genre: Vanilla", "en/genres/Vanilla"],
  ["Genre: Monster Girls", "en/genres/Monster_Girls"],
  ["Genre: School Life", "en/genres/School_Life"],
  ["Genre: Horror Thriller", "en/genres/Horror_Thriller"],
  ["Genre: Slice of Life", "en/genres/Slice_of_Life"],
  ["Genre: Supernatural", "en/genres/Supernatural"],
  ["Genre: Office", "en/genres/Office"],
  ["Genre: Sexy", "en/genres/Sexy"],
  ["Genre: MILF", "en/genres/MILF"],
  ["Genre: In-Law", "en/genres/In-Law"],
  ["Genre: Harem", "en/genres/Harem"],
  ["Genre: Cheating", "en/genres/Cheating"],
  ["Genre: College", "en/genres/College"],
  ["Genre: Isekai", "en/genres/Isekai"],
  ["Genre: UNCENSORED", "en/genres/UNCENSORED"],
  ["Genre: GL", "en/genres/GL"],
  ["Genre: sexy comics", "en/genres/sexy_comics"],
  ["Genre: Sci-fi", "en/genres/Sci-fi"],
  ["Genre: Sports", "en/genres/Sports"],
  ["Genre: School life", "en/genres/School_life"],
  ["Genre: Historical", "en/genres/Historical"],
  ["Genre: Action", "en/genres/Action"],
  ["Genre: Thriller", "en/genres/Thriller"],
  ["Genre: Horror", "en/genres/Horror"],
  ["Genre: Fantasy", "en/genres/Fantasy"],
  ["Genre: Comedy", "en/genres/Comedy"],
  ["Genre: Drama", "en/genres/Drama"],
  ["Genre: BL", "en/genres/BL"],
  ["Genre: Romance", "en/genres/Romance"],
];

export class BrowseFilter extends Filter.Select<string> {
  constructor() {
    super("Browse", browseEntries.map((it) => it[0]));
  }
  get selected() {
    return browseEntries[this.state][1];
  }
}

export const browseFilters = (): FilterList => [new Filter.Header("Doesn't work with Text search"), new Filter.Separator(), new BrowseFilter()];
