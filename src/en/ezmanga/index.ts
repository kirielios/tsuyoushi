// Port of keiyoushi/extensions-source src/en/ezmanga/EZmanga.kt
import { FilterList, isNotBlank, toHttpUrl, type ClientBuilder, type HttpUrl, type SChapter } from "../../../sdk/index.ts";
import { EZManhwa, EZManhwaSortFilter, EZManhwaStatusFilter, EZManhwaTypeFilter } from "../../../themes/ezmanhwa/index.ts";
import { EZmangaGenreFilter } from "./filters.ts";

export default class EZmanga extends EZManhwa {
  override readonly apiUrl = "https://vapi.ezmanga.org/api/v1";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  protected override searchMangaUrl(page: number, query: string, filters: FilterList): HttpUrl {
    const isSearch = isNotBlank(query);
    const endpoint = isSearch ? `${this.apiUrl}/series/search` : `${this.apiUrl}/series`;
    const b = toHttpUrl(endpoint).newBuilder();
    b.addQueryParameter("page", String(page));
    b.addQueryParameter("perPage", "20");
    if (isSearch) {
      b.addQueryParameter("q", query);
    } else {
      let sortAdded = false;
      for (const filter of filters) {
        if (filter instanceof EZManhwaSortFilter) {
          b.addQueryParameter("sort", filter.value);
          sortAdded = true;
        } else if (filter instanceof EZManhwaStatusFilter) {
          if (isNotBlank(filter.value)) b.addQueryParameter("status", filter.value);
        } else if (filter instanceof EZManhwaTypeFilter) {
          if (isNotBlank(filter.value)) b.addQueryParameter("type", filter.value);
        } else if (filter instanceof EZmangaGenreFilter) {
          if (isNotBlank(filter.value)) b.addQueryParameter("genre", filter.value);
        }
      }
      if (!sortAdded) b.addQueryParameter("sort", "latest");
    }
    return b.build();
  }

  protected override pageListUrl(chapter: SChapter) {
    if (chapter.url.includes("/chapters/")) return `${this.apiUrl}/${chapter.url}`;
    const path = chapter.url.startsWith("/series/") ? chapter.url.slice("/series/".length) : chapter.url;
    const slash = path.indexOf("/");
    return `${this.apiUrl}/series/${path.substring(0, slash)}/chapters/${path.substring(slash + 1)}`;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new EZManhwaSortFilter(), new EZManhwaStatusFilter(), new EZManhwaTypeFilter(), new EZmangaGenreFilter());
  }
}
