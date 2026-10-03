// Port of keiyoushi/extensions-source src/en/multporn/Multporn.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../../sdk/index.ts";
import {
  LATEST_DEFAULT_SORT_BY_FILTER_STATE,
  LATEST_REQUEST_TYPE,
  LatestTypeSelectFilter,
  POPULAR_DEFAULT_SORT_BY_FILTER_STATE,
  POPULAR_REQUEST_TYPE,
  PopularTypeSelectFilter,
  SEARCH_REQUEST_TYPE,
  SearchTypeSelectFilter,
  SortBySelectFilter,
  SortOrderSelectFilter,
  TextSearchFilter,
  getMultpornFilterList,
} from "./filters.ts";

const HEADER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.122 Safari/537.36";
const HEADER_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8";

export default class Multporn extends KeiSource {
  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", HEADER_USER_AGENT);
    headers.set("Content-Type", HEADER_CONTENT_TYPE);
    return headers;
  }

  // Popular

  private async fetchPopularManga(page: number, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/best`).newBuilder().addQueryParameter("page", String(page));

    for (const it of filters) {
      if (it instanceof SortBySelectFilter) url.addQueryParameter("sort_by", it.selected.uri);
      else if (it instanceof SortOrderSelectFilter) url.addQueryParameter("sort_order", it.selected.uri);
      else if (it instanceof PopularTypeSelectFilter) url.addQueryParameter("type", it.selected.uri);
    }

    return this.fetchMangaList(url.build().toString());
  }

  getPopularManga(page: number) {
    return this.fetchPopularManga(page - 1, getMultpornFilterList(POPULAR_DEFAULT_SORT_BY_FILTER_STATE));
  }

  // Latest

  private async fetchLatestManga(page: number, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/new`).newBuilder().addQueryParameter("page", String(page));

    for (const it of filters) {
      if (it instanceof SortBySelectFilter) url.addQueryParameter("sort_by", it.selected.uri);
      else if (it instanceof SortOrderSelectFilter) url.addQueryParameter("sort_order", it.selected.uri);
      else if (it instanceof LatestTypeSelectFilter) url.addQueryParameter("type", it.selected.uri);
    }

    return this.fetchMangaList(url.build().toString());
  }

  getLatestUpdates(page: number) {
    return this.fetchLatestManga(page - 1, getMultpornFilterList(LATEST_DEFAULT_SORT_BY_FILTER_STATE));
  }

  // Search

  private async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("page", String(page - 1)).addQueryParameter("search_api_views_fulltext", query);

    for (const it of filters) {
      if (it instanceof SortBySelectFilter) url.addQueryParameter("sort_by", it.selected.uri);
      else if (it instanceof SearchTypeSelectFilter) url.addQueryParameter("type", it.selected.uri);
    }

    return this.fetchMangaList(url.build().toString());
  }

  private async fetchTextSearchFilters(page: number, filters: TextSearchFilter[]): Promise<MangasPage> {
    const results = await Promise.all(
      filters.flatMap((it) =>
        it.stateURIs.map(async (queryURI) => {
          const response = await this.client.get(`${this.baseUrl}/${it.uri}/${queryURI}?page=0,${page}`, undefined, { ensureSuccess: false });
          if (response.code !== 200) return null;

          const document = response.asJsoup();
          const mangas = document.select("#content .col-1:contains(Views:),.col-2:contains(Views:)").map((element) => this.popularMangaFromElement(element));
          const hasNextPage = document.select(this.popularMangaNextPageSelector).first() != null;

          return new MangasPage(mangas, hasNextPage);
        }),
      ),
    );
    const pages = results.filter((it) => it !== null);

    const seen = new Set<string>();
    const mangas = pages
      .flatMap((it) => it.mangas)
      .filter((it) => {
        if (seen.has(it.url)) return false;
        seen.add(it.url);
        return true;
      });
    return new MangasPage(
      mangas,
      pages.some((it) => it.hasNextPage),
    );
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortByFilterType = firstInstanceOrNull(filters, SortBySelectFilter)?.requestType ?? POPULAR_REQUEST_TYPE;
    const textSearchFilters = filters.filter((it): it is TextSearchFilter => it instanceof TextSearchFilter).filter((it) => it.state.trim());

    if (textSearchFilters.length > 0) return this.fetchTextSearchFilters(page - 1, textSearchFilters);
    if (query.length > 0 || sortByFilterType === SEARCH_REQUEST_TYPE) return this.fetchSearchManga(page - 1, query, filters);
    if (sortByFilterType === LATEST_REQUEST_TYPE) return this.fetchLatestManga(page - 1, filters);
    return this.fetchPopularManga(page - 1, filters);
  }

  private async fetchMangaList(url: string): Promise<MangasPage> {
    const document = (await this.client.get(url)).asJsoup();
    const mangas = document.select(this.popularMangaSelector).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.select(this.popularMangaNextPageSelector).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Details

  private parseUnlabelledAuthorNames(document: Document): string[] {
    return ["field-name-field-author", "field-name-field-authors-gr", "field-name-field-img-group", "field-name-field-hentai-img-group", "field-name-field-rule-63-section"].flatMap((it) => document.select(`.${it} a`).map((a) => a.text()));
  }

  private mangaDetailsParse(manga: SManga, document: Document): SManga {
    manga.title = document.select("h1#page-title").text();

    const infoMap = new Map<string, string[]>();
    for (const it of ["Section", "Characters", "Tags", "Author"]) {
      infoMap.set(
        it,
        document.select(`.field:has(.field-label:contains(${it}:)) .links a`).map((t) => t.text()),
      );
    }

    manga.artist = [...new Set([...infoMap.get("Author")!, ...this.parseUnlabelledAuthorNames(document)])].join(", ");
    manga.author = manga.artist;

    manga.genre = [...new Set(["Tags", "Section", "Characters"].flatMap((it) => infoMap.get(it)!))].join(", ");

    manga.status = infoMap.get("Section")?.some((it) => it === "Ongoings") ? SManga.ONGOING : SManga.COMPLETED;

    const pageCount = document.select(".jb-image img").length;

    manga.description = [
      ...[...infoMap].filter(([key, value]) => (key === "Section" || key === "Characters") && value.length > 0).map(([key, value]) => `${key}:\n${value.join(", ")}`),
      `Pages:\n${pageCount}`,
    ].join("\n\n");
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedManga = fetchDetails ? this.mangaDetailsParse(manga, (await this.client.get(this.getMangaUrl(manga))).asJsoup()) : manga;

    const chapter = SChapter.create();
    chapter.url = manga.url;
    chapter.name = "Chapter";
    chapter.chapter_number = 1;

    return new SMangaUpdate(updatedManga, [chapter]);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".jb-image img").map((image, i) => new Page(i, "", substringBefore(image.absUrl("src").replace("/styles/juicebox_2k/public", ""), "?")));
  }

  // Selectors

  private readonly popularMangaSelector = ".masonry-item";
  private readonly popularMangaNextPageSelector = ".pager-next a";

  private popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.select(".views-field-title a").attr("abs:href"));
    manga.title = element.select(".views-field-title").text();
    manga.thumbnail_url = element.select("img").attr("abs:src");
    return manga;
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return getMultpornFilterList(POPULAR_DEFAULT_SORT_BY_FILTER_STATE);
  }
}
