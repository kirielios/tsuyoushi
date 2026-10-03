// Port of keiyoushi/extensions-source lib-multisrc/mangak/MangaKSource.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  extractNextJs,
  hasKeys,
  isNotBlank,
  substringBefore,
  toHttpUrl,
  type ClientBuilder,
  type PreferenceScreen,
} from "../../sdk/index.ts";
import { chapterItemToSChapter, initialMangaToSManga, mangaItemToSManga, searchHasNext, searchItems, type ChapterListResponseDto, type NextJsDto, type SearchResponseDto } from "./dto.ts";
import { AuthorFilter, ContentRatingFilter, DemographicFilter, GenreList, MinChapterFilter, SortFilter, StatusFilter, TypeFilter, getGenreList } from "./filters.ts";

const PREF_BLACKLIST_KEY = "pref_blacklist";
const FALLBACK_IMAGE_HOST = "rx.rzyn.net";
const DEFAULT_PAGE_LIMIT = "24";
const QUERY_LENGTH_LIMIT = 50;
const SORT_POPULAR = "popular";
const SORT_LATEST = "latest";
const WINDOW_WEEK = "week";

const IMAGE_FALLBACK_REGEX = /^rx\.qvzr[a-z]\.org$/;

export abstract class MangaKSource extends KeiSource {
  override get supportsFilterFetching() {
    return true;
  }
  protected get apiUrl(): string {
    return "https://api." + toHttpUrl(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder) {
    // Catches 5xx errors from the primary CDN and falls back to the working domain
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);

      const url = new URL(request.url);
      if (!response.isSuccessful && IMAGE_FALLBACK_REGEX.test(url.hostname)) {
        url.hostname = FALLBACK_IMAGE_HOST;
        return chain.proceed({ ...request, url: url.href });
      }

      return response;
    });
  }

  // ============================== Popular ==============================

  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/titles/search`).newBuilder();
    url.addQueryParameter("sort", SORT_POPULAR);
    url.addQueryParameter("window", WINDOW_WEEK);
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", DEFAULT_PAGE_LIMIT);

    const blacklist = this.getBlacklist();
    if (blacklist.size) url.addQueryParameter("exclude", [...blacklist].join(","));

    const dto = (await this.client.get(url.build().toString())).parseAs<SearchResponseDto>();
    return new MangasPage(searchItems(dto).map(mangaItemToSManga), searchHasNext(dto));
  }

  // ============================== Latest ===============================

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/titles/search`).newBuilder();
    url.addQueryParameter("sort", SORT_LATEST);
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", DEFAULT_PAGE_LIMIT);

    const blacklist = this.getBlacklist();
    if (blacklist.size) url.addQueryParameter("exclude", [...blacklist].join(","));

    const dto = (await this.client.get(url.build().toString())).parseAs<SearchResponseDto>();
    return new MangasPage(searchItems(dto).map(mangaItemToSManga), searchHasNext(dto));
  }

  // ============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/titles/search`).newBuilder();
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", DEFAULT_PAGE_LIMIT);

    if (isNotBlank(query)) {
      const filteredQuery = [...[...query].filter((it) => /[\p{L}\p{Nd}]/u.test(it) || it === " ").join("").trim()].slice(0, QUERY_LENGTH_LIMIT).join("");
      url.addQueryParameter("q", filteredQuery);
    }

    const includedGenres: string[] = [];
    const excludedGenres = new Set(this.getBlacklist());

    for (const filter of filters) {
      if (filter instanceof GenreList) {
        for (const genre of filter.state) {
          if (genre.state === Filter.TriState.STATE_INCLUDE) {
            includedGenres.push(genre.value);
            excludedGenres.delete(genre.value);
          } else if (genre.state === Filter.TriState.STATE_EXCLUDE) excludedGenres.add(genre.value);
        }
      } else if (filter instanceof SortFilter) {
        if (isNotBlank(filter.selected)) url.addQueryParameter("sort", filter.selected);
      } else if (filter instanceof ContentRatingFilter) {
        if (isNotBlank(filter.selected)) url.addQueryParameter("content_rating", filter.selected);
      } else if (filter instanceof StatusFilter) {
        if (isNotBlank(filter.selected)) url.addQueryParameter("status", filter.selected);
      } else if (filter instanceof TypeFilter) {
        if (isNotBlank(filter.selected)) url.addQueryParameter("type", filter.selected);
      } else if (filter instanceof DemographicFilter) {
        if (isNotBlank(filter.selected)) url.addQueryParameter("demographic", filter.selected);
      }
    }

    const author = filters.find((it): it is AuthorFilter => it instanceof AuthorFilter)?.state;
    if (isNotBlank(author)) url.addQueryParameter("author", author);
    const minCh = filters.find((it): it is MinChapterFilter => it instanceof MinChapterFilter)?.state;
    if (isNotBlank(minCh)) url.addQueryParameter("min_ch", minCh);

    if (includedGenres.length) url.addQueryParameter("genres", includedGenres.join(","));
    if (excludedGenres.size) url.addQueryParameter("exclude", [...excludedGenres].join(","));

    const dto = (await this.client.get(url.build().toString())).parseAs<SearchResponseDto>();
    return new MangasPage(searchItems(dto).map(mangaItemToSManga), searchHasNext(dto));
  }

  // ======================= Details & Chapters ==========================

  override getMangaUrl(manga: SManga): string {
    const path = substringBefore(manga.url, "#");
    return toHttpUrl(this.baseUrl).resolve(path)?.toString() ?? this.baseUrl + path;
  }

  override getChapterUrl(chapter: SChapter): string {
    return toHttpUrl(this.baseUrl).resolve(chapter.url)?.toString() ?? this.baseUrl + chapter.url;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const detailsUrl = this.getMangaUrl(manga);
    const memoId = typeof manga.memo?.id === "string" ? manga.memo.id : null;

    const needsNextJsData = fetchDetails || (fetchChapters && memoId == null);

    let nextJsData: NextJsDto | null = null;
    if (needsNextJsData) {
      const response = await this.client.get(detailsUrl);
      nextJsData = extractNextJs<NextJsDto>(response, hasKeys("pageProps"));
      if (nextJsData == null) throw new Error(`Could not extract Next.js data for: ${detailsUrl}`);
    }

    const details = async () => {
      if (!fetchDetails) return manga;
      const initialManga = nextJsData?.pageProps?.initialManga;
      if (initialManga == null) throw new Error(`Could not find manga details for: ${detailsUrl}`);
      return initialMangaToSManga(initialManga, manga.url);
    };

    const chapterList = async () => {
      if (!fetchChapters) return chapters;
      const id = memoId ?? nextJsData?.pageProps?.initialManga?.id;
      if (id == null) throw new Error(`Could not find manga ID for migration for: ${detailsUrl}`);
      return this.fetchChaptersByApiId(id);
    };

    const [d, c] = await Promise.all([details(), chapterList()]);
    return new SMangaUpdate(d, c);
  }

  private async fetchChaptersByApiId(id: string): Promise<SChapter[]> {
    const url = `${this.apiUrl}/titles/${id}/chapters?cv=${Date.now()}`;
    const chapterList = (await this.client.get(url)).parseAs<ChapterListResponseDto>().data?.chapters ?? [];

    return chapterList
      .slice()
      .sort((a, b) => (b.chapter_number ?? 0) - (a.chapter_number ?? 0))
      .map(chapterItemToSChapter);
  }

  // =============================== Pages ===============================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const response = await this.client.get(chapterUrl);
    const dto = extractNextJs<NextJsDto>(response, hasKeys("pageProps"));

    const images = dto?.pageProps?.initialChapter?.images;
    if (images == null) return [];

    return images.map((url, index) => new Page(index, "", url));
  }

  // ============================== Filters ==============================

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/genres`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = getGenreList(data, this.getBlacklist());

    const filters: Filter[] = [new SortFilter(), new ContentRatingFilter(), new StatusFilter(), new TypeFilter(), new DemographicFilter(), new Filter.Separator(), new AuthorFilter(), new MinChapterFilter()];
    if (genres.length) {
      filters.push(new Filter.Separator());
      filters.push(new GenreList(genres));
    }
    return FilterList(...filters);
  }

  // ============================= Utilities =============================

  private getBlacklist(): Set<string> {
    return new Set(this.preferences.getStringSet(PREF_BLACKLIST_KEY, []));
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    // Upstream's getFilterList() reads the host's filter cache; a source cannot reach it here, so this sees no genres
    // and the preference shows its "open search filters" hint with an empty list.
    const genres = this.getFilterList().find((it): it is GenreList => it instanceof GenreList)?.state ?? [];
    const blacklistPref = new MultiSelectListPreference(screen.context);
    blacklistPref.key = PREF_BLACKLIST_KEY;
    blacklistPref.title = "Global Genre Blacklist";
    blacklistPref.summary = !genres.length ? "Open search filters in the browse screen once to load and sync genres." : "Select genres to always exclude from search and browse results.";
    blacklistPref.entries = genres.map((it) => it.name);
    blacklistPref.entryValues = genres.map((it) => it.value);
    blacklistPref.setDefaultValue([]);
    screen.addPreference(blacklistPref);
  }
}
