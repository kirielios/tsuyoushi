// Port of keiyoushi/extensions-source src/en/qiscans/QiScans.kt
import { FilterList, isNotBlank, toHttpUrl, type HttpUrl } from "../../../sdk/index.ts";
import { EZManhwa, EZManhwaSortFilter, EZManhwaStatusFilter, EZManhwaTypeFilter } from "../../../themes/ezmanhwa/index.ts";
import { QiScansGenreFilter } from "./filters.ts";

export default class QiScans extends EZManhwa {
  override readonly apiUrl = "https://api.qimanga.com/api/v1";

  protected override configureHeaders(headers: Headers): Headers {
    const h = this.addEZManhwaHeaders(headers);
    h.set("Sec-Fetch-Dest", "empty");
    h.set("Sec-Fetch-Mode", "cors");
    h.set("Sec-Fetch-Site", "same-site");
    return h;
  }

  // QiScans search endpoint ignores filters — only send the query when searching.
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
        } else if (filter instanceof QiScansGenreFilter) {
          if (isNotBlank(filter.value)) b.addQueryParameter("genre", filter.value);
        }
      }
      if (!sortAdded) b.addQueryParameter("sort", "latest");
    }
    return b.build();
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new EZManhwaSortFilter(), new EZManhwaStatusFilter(), new EZManhwaTypeFilter(), new QiScansGenreFilter());
  }
}
