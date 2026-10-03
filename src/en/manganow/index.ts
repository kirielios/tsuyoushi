// Port of keiyoushi/extensions-source src/en/manganow/MangaNow.kt
import { Filter, FilterList, type ClientBuilder } from "../../../sdk/index.ts";
import { MangaReader, Note } from "../../../themes/mangareader/index.ts";
import { GenreFilter, ScoreFilter, StatusFilter, TypeFilter, YearFilter } from "./filters.ts";

export default class MangaNow extends MangaReader {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  // =============================== Pages ================================

  override pageListParseSelector() {
    return ".container-reader-chapter > .iv-card:not([data-url$=manganow.jpg])";
  }

  // =============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Note(), new Filter.Separator(), new TypeFilter(), new StatusFilter(), new ScoreFilter(), new YearFilter(), this.getSortFilter(), new GenreFilter());
  }
}
