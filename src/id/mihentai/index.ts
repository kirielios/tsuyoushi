// Port of keiyoushi/extensions-source src/id/mihentai/Mihentai.kt
import { FilterList } from "../../../sdk/index.ts";
import { GenreListFilter, MangaThemesia, OrderByFilter, SelectFilter } from "../../../themes/mangathemesia/index.ts";

// Private classes upstream, distinct from the theme's StatusFilter/TypeFilter, so the theme's URL builder ignores them.
class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Publishing", "publishing"],
      ["Finished", "finished"],
      ["Dropped", "drop"],
    ]);
  }
}

class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["Default", ""],
      ["Manga", "Manga"],
      ["Manhwa", "Manhwa"],
      ["Manhua", "Manhua"],
      ["Webtoon", "webtoon"],
      ["One-Shot", "One-Shot"],
      ["Doujin", "doujin"],
    ]);
  }
}

export default class Mihentai extends MangaThemesia {
  override getFilterList(data: unknown = null): FilterList {
    return FilterList(new StatusFilter(), new TypeFilter(), ...super.getFilterList(data).filter((it) => it instanceof GenreListFilter || it instanceof OrderByFilter));
  }
}
