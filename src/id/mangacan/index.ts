// Port of keiyoushi/extensions-source src/id/mangacan/MangaCan.kt
import { ClientBuilder, Filter, FilterList, toHttpUrl, type Document, type HttpUrlBuilder } from "../../../sdk/index.ts";
import { MangaThemesia, SelectFilter, type GenreData } from "../../../themes/mangathemesia/index.ts";

const SPACES_REGEX = /\s+/g;

class GenreFilter extends SelectFilter {}

export default class MangaCan extends MangaThemesia {
  override mangaUrlDirectory = "";
  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(3);
  }

  override get supportsLatest() {
    return false;
  }

  override seriesGenreSelector = ".seriestugenre a[href*=genre]";

  override pageSelector = "div.images img";

  override searchMangaUrlWithFilters(page: number, query: string, filters: FilterList): HttpUrlBuilder {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    const selected = filters.filter((it): it is GenreFilter => it instanceof GenreFilter).find((it) => it.selectedValue().trim() !== "")?.selectedValue() ?? "";

    if (query.trim()) {
      b.addPathSegment("cari");
      b.addPathSegment(query.trim().replace(SPACES_REGEX, "-").toLowerCase());
      b.addPathSegment(`${page}.html`);
    } else {
      b.addPathSegments(selected);
    }
    return b;
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = Array.isArray(data) ? (data as GenreData[]) : null;

    const filters: Filter[] = [];
    if (genres && genres.length) {
      filters.push(
        new Filter.Header(this.intl.get("genre_exclusion_warning")),
        new GenreFilter(
          this.intl.get("genre_filter_title"),
          genres.map((it) => [it.name, it.value]),
        ),
      );
    }
    return FilterList(...filters);
  }

  protected override parseGenres(document: Document): GenreData[] {
    return [{ name: "All", value: "" }, ...document.select(".textwidget.custom-html-widget a").map((element) => ({ name: element.text(), value: element.attr("href") }))];
  }
}
