// Port of keiyoushi/extensions-source src/en/multporn/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const LATEST_DEFAULT_SORT_BY_FILTER_STATE = 3;
export const POPULAR_DEFAULT_SORT_BY_FILTER_STATE = 0;
export const SEARCH_DEFAULT_SORT_BY_FILTER_STATE = 5;

export const LATEST_REQUEST_TYPE = "Latest";
export const POPULAR_REQUEST_TYPE = "Popular";
export const SEARCH_REQUEST_TYPE = "Search";

const nonAlphanumericRegex = /[^A-Za-z0-9]/g;
const whitespaceRegex = /\s+/g;

export class URIFilter {
  constructor(
    public name: string,
    readonly uri: string,
  ) {}
}

export class RequestTypeURIFilter extends URIFilter {
  constructor(
    readonly requestType: string,
    name: string,
    uri: string,
  ) {
    super(name, uri);
  }
}

export class URISelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly filters: URIFilter[],
    state = 0,
  ) {
    super(
      name,
      filters.map((it) => it.name),
      state,
    );
  }
  get selected(): URIFilter {
    return this.filters[this.state];
  }
}

export class TypeSelectFilter extends URISelectFilter {}

export class PopularTypeSelectFilter extends TypeSelectFilter {
  constructor(filters: URIFilter[]) {
    super("Popular Type", filters);
  }
}

export class LatestTypeSelectFilter extends TypeSelectFilter {
  constructor(filters: URIFilter[]) {
    super("Latest Type", filters);
  }
}

export class SearchTypeSelectFilter extends TypeSelectFilter {
  constructor(filters: URIFilter[]) {
    super("Search Type", filters);
  }
}

export class TextSearchFilter extends Filter.Text {
  constructor(
    name: string,
    readonly uri: string,
  ) {
    super(name);
  }
  get stateURIs(): string[] {
    return [
      ...new Set(
        this.state
          .split(",")
          .filter((it) => it.length > 0)
          .map((it) => it.replace(nonAlphanumericRegex, " ").trim().replace(whitespaceRegex, "_").toLowerCase()),
      ),
    ];
  }
}

export class SortBySelectFilter extends URISelectFilter {
  constructor(filters: RequestTypeURIFilter[], state: number) {
    super(
      "Sort By",
      filters.map((it) => {
        it.name = `[${it.requestType}] ${it.name}`;
        return it;
      }),
      state,
    );
  }
  get requestType(): string {
    return (this.filters[this.state] as RequestTypeURIFilter).requestType;
  }
}

export class SortOrderSelectFilter extends URISelectFilter {
  constructor(filters: URIFilter[]) {
    super("Order By", filters);
  }
}

export const getMultpornFilterList = (sortByFilterState: number): FilterList =>
  FilterList(
    new Filter.Header("Text search only works with Relevance and Author"),
    new SortBySelectFilter(getSortByFilters(), sortByFilterState),
    new Filter.Header("Order By only works with Popular and Latest"),
    new SortOrderSelectFilter(getSortOrderFilters()),
    new Filter.Header("Type filters apply based on selected Sort By option"),
    new PopularTypeSelectFilter(getPopularTypeFilters()),
    new LatestTypeSelectFilter(getLatestTypeFilters()),
    new SearchTypeSelectFilter(getSearchTypeFilters()),
    new Filter.Separator(),
    new Filter.Header("Filters below ignore text search and all options above"),
    new Filter.Header("Query must match title's non-special characters"),
    new Filter.Header("Separate queries with comma (,)"),
    new TextSearchFilter("Comic Tags", "category"),
    new TextSearchFilter("Comic Characters", "characters"),
    new TextSearchFilter("Comic Authors", "authors_comics"),
    new TextSearchFilter("Comic Sections", "comics"),
    new TextSearchFilter("Manga Categories", "category_hentai"),
    new TextSearchFilter("Manga Characters", "characters_hentai"),
    new TextSearchFilter("Manga Authors", "authors_hentai_comics"),
    new TextSearchFilter("Manga Sections", "hentai_manga"),
    new TextSearchFilter("Picture Authors", "authors_albums"),
    new TextSearchFilter("Picture Sections", "pictures"),
    new TextSearchFilter("Hentai Sections", "hentai"),
    new TextSearchFilter("Rule 63 Sections", "rule_63"),
    new TextSearchFilter("Gay Tags", "category_gay"),
  );

const getPopularTypeFilters = () => [
  new URIFilter("Comics", "1"),
  new URIFilter("Hentai Manga", "2"),
  new URIFilter("Cartoon Pictures", "3"),
  new URIFilter("Hentai Pictures", "4"),
  new URIFilter("Rule 63", "10"),
  new URIFilter("Author Albums", "11"),
];

const getLatestTypeFilters = () => [
  new URIFilter("Comics", "1"),
  new URIFilter("Hentai Manga", "2"),
  new URIFilter("Cartoon Pictures", "3"),
  new URIFilter("Hentai Pictures", "4"),
  new URIFilter("Author Albums", "10"),
];

const getSearchTypeFilters = () => [
  new URIFilter("Comics", "1"),
  new URIFilter("Hentai Manga", "2"),
  new URIFilter("Gay Comics", "3"),
  new URIFilter("Cartoon Pictures", "4"),
  new URIFilter("Hentai Pictures", "5"),
  new URIFilter("Rule 63", "11"),
  new URIFilter("Humor", "13"),
];

const getSortByFilters = () => [
  new RequestTypeURIFilter(POPULAR_REQUEST_TYPE, "Total Views", "totalcount_1"),
  new RequestTypeURIFilter(POPULAR_REQUEST_TYPE, "Views Today", "daycount"),
  new RequestTypeURIFilter(POPULAR_REQUEST_TYPE, "Last Viewed", "timestamp"),
  new RequestTypeURIFilter(LATEST_REQUEST_TYPE, "Date Posted", "created"),
  new RequestTypeURIFilter(LATEST_REQUEST_TYPE, "Date Updated", "changed"),
  new RequestTypeURIFilter(SEARCH_REQUEST_TYPE, "Relevance", "search_api_relevance"),
  new RequestTypeURIFilter(SEARCH_REQUEST_TYPE, "Author", "author"),
];

const getSortOrderFilters = () => [new URIFilter("Descending", "DESC"), new URIFilter("Ascending", "ASC")];
