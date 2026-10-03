// Port of keiyoushi/extensions-source src/all/mangadotnet/MangaDot.kt
//
// isLoggedIn() reads the client's cookie jar (upstream: WebView's CookieManager); there is no WebView login, so
// bookmarks and the library filter only work if the host ever carries the ory_kratos_session cookie.
// CacheControl on the for-you / following-reads requests is dropped.
import {
  EditTextPreference,
  Filter,
  KeiSource,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SMangaUpdate,
  SwitchPreferenceCompat,
  escapeRegex,
  firstInstance,
  firstInstanceOrNull,
  toHttpUrl,
  tryParseInstant,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type SharedPreferences,
  type SManga,
} from "../../../sdk/index.ts";
import {
  bookmarksHasNextPage,
  browseMangaToSManga,
  hasNextPage,
  mangaListOf,
  mangaToSManga,
  type BookmarksData,
  type BrowseManga,
  type Chapter,
  type ChapterUrl,
  type Data,
  type Images,
  type MangaData,
  type MangaItemsResponse,
  type MangaList,
  type RelatedData,
  type TagsResponse,
  type ViewAllData,
  type Volume,
} from "./dto.ts";
import {
  ArtistFilter,
  AuthorFilter,
  BrowseFilter,
  ContentRatingFilter,
  DemographicFilter,
  GenreFilter,
  LibraryFilter,
  MaxYearFilter,
  MinChaptersFilter,
  MinRatingFilter,
  MinYearFilter,
  ScanlatorFilter,
  SortFilter,
  StatusFilter,
  TagFilter,
  TagsGroupFilter,
  TypeFilter,
  VolumesFilter,
  contentRatings,
} from "./filters.ts";

const NSFW_MODE = "pref_nsfw_mode";
const CHAPTER_MODE = "pref_chapter_mode";
const EXCLUDE_GENRE_PREF = "pref_exclude_genre";
const EXCLUDE_GENRE_ADULT_PREF = "pref_exclude_genre_adult";
const BROWSE_TYPE_PREF = "pref_browse_type";
const BROWSE_STATUS_PREF = "pref_browse_status";
const DEDUPLICATE_CHAPTERS = "pref_deduplicate_chapters";
const PREFERRED_SCANLATORS = "pref_preferred_scanlators";
const EXCLUDE_DEMOGRAPHIC_PREF = "pref_exclude_demographic";
const CONTENT_RATING_PREF = "pref_content_rating";
const SHOW_TAGS_PREF = "pref_show_tags";

const LOGIN_MESSAGE = "Login through WebView to view bookmarks";
const byLower = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
/** Kotlin Float.toString().removeSuffix(".0") */
const floatText = (f: number) => String(f);

interface FilterDataDto {
  genres?: string[] | null;
  tags?: string[] | null;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export default class MangaDot extends KeiSource {
  // =============================== Setup ===============================
  private migrated = false;
  /** getPreferences { … }: one-time migrations of older preference formats */
  protected get preferences(): SharedPreferences {
    const p = super.preferences;
    if (!this.migrated) {
      this.migrated = true;
      this.migratePreferences(p);
    }
    return p;
  }

  private migratePreferences(p: SharedPreferences) {
    const oldChapterKey = "pref_fetch_volume";
    if (p.contains(oldChapterKey)) {
      const fetchVolumes = p.getBoolean(oldChapterKey, false);
      p.edit()
        .putString(CHAPTER_MODE, fetchVolumes ? "both" : "chapters")
        .remove(oldChapterKey)
        .apply();
    }

    if (p.contains(NSFW_MODE)) {
      const value = p.getString(NSFW_MODE);
      if (value == null) {
        // stored as a Boolean
        p.edit()
          .putString(NSFW_MODE, p.getBoolean(NSFW_MODE, false) ? "both" : "none")
          .apply();
      } else if (value === "0") p.edit().putString(NSFW_MODE, "none").apply();
      else if (value === "1") p.edit().putString(NSFW_MODE, "1").apply();
    }

    const browseType = p.getString(BROWSE_TYPE_PREF);
    if (browseType != null) {
      if (browseType) {
        p.edit()
          .putStringSet(
            BROWSE_TYPE_PREF,
            ["JP", "KR", "CN", "ONESHOT"].filter((it) => it !== browseType),
          )
          .apply();
      } else p.edit().remove(BROWSE_TYPE_PREF).apply();
    }

    const demographics = ["Josei", "Seinen", "Shoujo", "Shounen"];
    const normalExcluded = p.getStringSet(EXCLUDE_GENRE_PREF, []);
    const adultExcluded = p.getStringSet(EXCLUDE_GENRE_ADULT_PREF, []);
    const migratedDemos = [...new Set([...normalExcluded, ...adultExcluded])].filter((it) => demographics.includes(it));

    if (migratedDemos.length) {
      const existingDemos = p.getStringSet(EXCLUDE_DEMOGRAPHIC_PREF, []);
      p.edit()
        .putStringSet(EXCLUDE_DEMOGRAPHIC_PREF, [...new Set([...existingDemos, ...migratedDemos])])
        .putStringSet(
          EXCLUDE_GENRE_PREF,
          normalExcluded.filter((it) => !demographics.includes(it)),
        )
        .putStringSet(
          EXCLUDE_GENRE_ADULT_PREF,
          adultExcluded.filter((it) => !demographics.includes(it)),
        )
        .apply();
    }

    // a Set stored under CONTENT_RATING_PREF (older format)
    if (p.contains(CONTENT_RATING_PREF) && p.getString(CONTENT_RATING_PREF) == null) {
      p.edit().remove(CONTENT_RATING_PREF).apply();
    }
  }

  private readonly officialPriorityPatterns = ["manga plus", "mangaplus", "viz media", "viz manga", "webtoon", "tapas", "mangadex", "k manga", "kmanga", "mangaup", "manga up", "comikey", "shonen jump", "shounen jump", "shonenjump", "official"].map(
    (it) => new RegExp(`\\b${escapeRegex(it)}\\b`),
  );

  private readonly demographicNames = ["Josei", "Seinen", "Shoujo", "Shounen"];

  private addAdultParam(builder: ReturnType<ReturnType<typeof toHttpUrl>["newBuilder"]>) {
    switch (this.adultModePref()) {
      case "none":
        builder.addQueryParameter("adult", "0");
        break;
      case "1":
        builder.addQueryParameter("adult", "1");
        break;
      case "both":
        builder.addQueryParameter("adult", "both");
        break;
    }
    return builder;
  }

  private get queryLang(): string {
    switch (this.lang) {
      case "pt-BR":
        return "pt-br";
      case "es-419":
        return "es-la";
      case "zh-Hant":
        return "zh-hk";
      default:
        return this.lang;
    }
  }

  get supportsRelatedMangas() {
    return true;
  }

  // ========================= Popular & Latest ==========================
  private async getViewAllPage(mode: string, page: number): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/view-all/${mode}.data`).newBuilder();
    this.addAdultParam(builder);
    if (page > 1) builder.addQueryParameter("page", String(page));
    for (const genre of this.excludedGenresPref()) builder.addQueryParameter("genre", `-${genre}`);
    for (const demo of this.excludedDemographicsPref()) builder.addQueryParameter("genre", `-${demo}`);
    builder.addQueryParameter("_routes", "pages/ViewAllPage");
    for (const origin of this.includedTypes()) builder.addQueryParameter("origin", origin);
    const status = this.browseStatusPref();
    if (status != null) builder.addQueryParameter("status", status);

    const data = this.decodeRscAs<Data<ViewAllData>>(await this.client.get(builder.build().toString())).data;

    return new MangasPage(
      (mangaListOf(data.data) ?? []).map((it) => browseMangaToSManga(it, this.baseUrl)),
      hasNextPage(data.data),
    );
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getViewAllPage("most-tracked", page);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getViewAllPage("latest-updates", page);
  }

  // ============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("​​")) {
      const name = query.slice(2);
      firstInstance(filters, ArtistFilter).state = name;
      return this.getSearchMangaList(page, "", filters);
    }
    if (query.startsWith("​")) {
      const name = query.slice(1);
      firstInstance(filters, AuthorFilter).state = name;
      return this.getSearchMangaList(page, "", filters);
    }

    const browseMode = firstInstanceOrNull(filters, BrowseFilter)?.selected;
    if (browseMode?.trim() && !query.trim()) {
      if (browseMode === "bookmarks") {
        if (!this.isLoggedIn()) throw new Error(LOGIN_MESSAGE);
        const url = toHttpUrl(`${this.baseUrl}/bookmark.data`).newBuilder();
        if (page > 1) url.addQueryParameter("page", String(page));
        url.addQueryParameter("_routes", "pages/BookmarksPage");
        return this.parseBookmarksResponse(await this.client.get(url.build().toString()));
      }
      return this.getViewAllPage(browseMode, page);
    }

    const url = toHttpUrl(`${this.baseUrl}/api/search`).newBuilder();
    if (query.trim()) url.addQueryParameter("search", query);
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", "56");

    const sort = firstInstanceOrNull(filters, SortFilter);
    if (sort) {
      if (sort.sort === "" && !query.trim()) url.addQueryParameter("sortBy", "latest");
      else if (sort.sort.trim()) url.addQueryParameter("sortBy", sort.sort);
      url.addQueryParameter("sortOrder", sort.ascending ? "asc" : "desc");
    }

    const status = firstInstanceOrNull(filters, StatusFilter)?.selected;
    if (status != null) url.addQueryParameter("status", status);

    const volumes = firstInstanceOrNull(filters, VolumesFilter)?.selected;
    if (volumes?.trim()) url.addQueryParameter("has_volumes", volumes);

    const scanlator = firstInstanceOrNull(filters, ScanlatorFilter)?.selected;
    if (scanlator?.trim()) url.addQueryParameter("has_scanlator", scanlator);

    const library = firstInstanceOrNull(filters, LibraryFilter)?.selected;
    if (library?.trim()) url.addQueryParameter("library", library);

    const minRating = firstInstanceOrNull(filters, MinRatingFilter)?.selected;
    if (minRating?.trim()) url.addQueryParameter("min_rating", minRating);

    const contentRating = firstInstanceOrNull(filters, ContentRatingFilter);
    if (contentRating) {
      const included = contentRating.included;
      const excluded = contentRating.excluded;
      if (included.length || excluded.length) url.addQueryParameter("content_rating", [...included, ...excluded.map((it) => `-${it}`)].join(","));
    }

    const checked = firstInstanceOrNull(filters, TypeFilter)?.checked;
    if (checked?.length && !(new Set(checked).size === this.allOrigins.length && this.allOrigins.every((it) => checked.includes(it)))) {
      url.addQueryParameter("origin", checked.join(","));
    }

    const genres: string[] = [];
    const demographic = firstInstanceOrNull(filters, DemographicFilter);
    if (demographic) genres.push(...demographic.included, ...demographic.excluded.map((it) => `-${it}`));
    const genre = firstInstanceOrNull(filters, GenreFilter);
    if (genre) genres.push(...genre.included, ...genre.excluded.map((it) => `-${it}`));
    if (genres.length) url.addQueryParameter("genres", genres.join(","));

    const tags: string[] = [];
    for (const filter of this.findTagFilters(filters)) tags.push(...filter.included, ...filter.excluded.map((it) => `-${it}`));
    if (tags.length) url.addQueryParameter("tags", tags.join(","));

    const text = <T extends Filter.Text>(cls: abstract new (...args: never[]) => T) => filters.find((f): f is T => f instanceof cls)?.state;
    const minYear = text(MinYearFilter);
    if (minYear?.trim()) url.addQueryParameter("year_min", minYear.trim());
    const maxYear = text(MaxYearFilter);
    if (maxYear?.trim()) url.addQueryParameter("year_max", maxYear.trim());
    const minChapters = text(MinChaptersFilter);
    if (minChapters?.trim()) url.addQueryParameter("min_chapters", minChapters.trim());
    const author = text(AuthorFilter);
    if (author?.trim()) url.addQueryParameter("author", author.trim());
    const artist = text(ArtistFilter);
    if (artist?.trim()) url.addQueryParameter("artist", artist.trim());

    const data = (await this.client.get(url.build().toString())).parseAs<MangaList>();

    const hideAdultCovers = this.adultModePref() === "none";
    const mangaList = mangaListOf(data) ?? [];
    return new MangasPage(
      mangaList.map((it) => browseMangaToSManga(it, this.baseUrl, hideAdultCovers)),
      hasNextPage(data) && mangaList.length > 0,
    );
  }

  protected async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.split("/").slice(1);
    if (url.hostname !== toHttpUrl(this.baseUrl).host || segments.length <= 1) return null;

    let mangaUrl: string;
    switch (segments[0]) {
      case "manga":
        if (segments.length < 2) return null;
        mangaUrl = decodeURIComponent(segments[1]);
        break;
      case "chapter":
      case "volume": {
        if (segments.length < 2) return null;
        const chapterUrl: ChapterUrl = {
          id: decodeURIComponent(segments[1]),
          source: segments[0] === "volume" ? "user" : (url.searchParams.get("source") ?? "user"),
          isVolume: segments[0] === "volume",
        };
        const segment = chapterUrl.source === "user" ? "uploads" : "chapters";
        const apiUrl = `${this.baseUrl}/api/${segment}/${chapterUrl.id}/images`;
        mangaUrl = String((await this.client.get(apiUrl)).parseAs<Images>().manga.id);
        break;
      }
      default:
        return null;
    }

    const tmpManga: SManga = { url: mangaUrl, title: "", status: 0, memo: {} };
    return (await this.fetchMangaUpdate(tmpManga, [], true, false)).manga;
  }

  // ============================== Filters ==============================
  get supportsFilterFetching() {
    return true;
  }

  async fetchFilterData(): Promise<unknown> {
    const [facetsResponse, tagsResponse] = await Promise.all([
      this.client.get(`${this.baseUrl}/api/search?facets=1`).then((r) => r.parseAs<MangaList>()),
      this.client.get(`${this.baseUrl}/api/manga/tags`).then((r) => r.parseAs<TagsResponse>()),
    ]);

    const genres = facetsResponse.facets?.genres ? [...new Set(facetsResponse.facets.genres.map((it) => it.key).filter((it) => !this.demographicNames.includes(it)))].sort(byLower) : null;

    const tags = [
      ...new Set(
        (tagsResponse.categories ?? [])
          .flatMap((it) => it.tags ?? [])
          .map((it) => it.name.trim())
          .filter((it) => it.length),
      ),
    ].sort(byLower);

    return { genres, tags } satisfies FilterDataDto;
  }

  getFilterList(data: unknown = null): FilterList {
    const dto = data as FilterDataDto | null;

    const filters: Filter[] = [new BrowseFilter(), new SortFilter(), new StatusFilter(), new VolumesFilter(), new ScanlatorFilter(), new MinRatingFilter()];

    if (this.isLoggedIn()) filters.push(new LibraryFilter());

    filters.push(new ContentRatingFilter(this.excludedContentRatingPref()), new TypeFilter(), new DemographicFilter(this.excludedDemographicsPref()));

    const genreList = dto?.genres ? [...dto.genres].sort(byLower) : null;
    const tagList = dto?.tags ? [...dto.tags].sort(byLower) : null;

    if (genreList != null) filters.push(new GenreFilter(genreList, this.excludedGenresPref()));

    if (tagList != null) {
      const tagFilters: TagFilter[] = [];
      const first = (s: string) => s.charAt(0).toLowerCase();

      const otherTags = tagList.filter((it) => !(first(it) >= "a" && first(it) <= "z"));
      if (otherTags.length) tagFilters.push(new TagFilter("0-9 / Misc", otherTags));

      const chunks: [string, string, string][] = [
        ["A-C", "a", "c"],
        ["D-H", "d", "h"],
        ["I-L", "i", "l"],
        ["M-O", "m", "o"],
        ["P-S", "p", "s"],
        ["T-V", "t", "v"],
        ["W-Z", "w", "z"],
      ];
      for (const [name, from, to] of chunks) {
        const chunkTags = tagList.filter((it) => first(it) >= from && first(it) <= to);
        if (chunkTags.length) tagFilters.push(new TagFilter(name, chunkTags));
      }

      if (tagFilters.length) filters.push(new TagsGroupFilter(tagFilters));
    }

    filters.push(new MinYearFilter(), new MaxYearFilter(), new MinChaptersFilter(), new AuthorFilter(), new ArtistFilter());
    return filters;
  }

  private findTagFilters(filters: FilterList): TagFilter[] {
    return filters.flatMap((filter) => {
      if (filter instanceof TagFilter) return [filter];
      if (filter instanceof Filter.Group) return (filter.state as Filter[]).filter((it): it is TagFilter => it instanceof TagFilter);
      return [];
    });
  }

  private async fetchForYouItems(): Promise<BrowseManga[]> {
    try {
      if (!this.isLoggedIn()) return [];
      const forYouUrl = this.addAdultParam(toHttpUrl(`${this.baseUrl}/api/manga/for-you?limit=100`).newBuilder()).build();
      return (await this.client.get(forYouUrl.toString())).parseAs<MangaItemsResponse>().items ?? [];
    } catch {
      return [];
    }
  }

  private async fetchFollowingReads(): Promise<BrowseManga[]> {
    try {
      if (!this.isLoggedIn()) return [];
      return (await this.client.get(`${this.baseUrl}/api/discovery/following-reads?limit=30`)).parseAs<MangaItemsResponse>().items ?? [];
    } catch {
      return [];
    }
  }

  // ============================== Details ==============================
  getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = (async () => {
      if (!fetchDetails) return manga;
      const url = `${this.baseUrl}/manga/${manga.url}.data?_routes=pages/MangaDetailPage`;
      const data = this.decodeRscAs<Data<MangaData>>(await this.client.get(url)).data;
      return mangaToSManga(data.mangaData.manga, this.baseUrl, this.showTagsPref(), data.mangaData.total_volumes ?? null);
    })();
    const chapterList = fetchChapters ? this.fetchChapterListInternal(manga) : Promise.resolve(chapters);
    return new SMangaUpdate(await details, await chapterList);
  }

  async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const url = `${this.baseUrl}/manga/${manga.url}.data?_routes=pages/MangaDetailPage`;
    const [data, followingReadsItems, forYouItems] = await Promise.all([
      this.client.get(url).then((r) => this.decodeRscAs<Data<RelatedData>>(r).data),
      this.fetchFollowingReads(),
      this.fetchForYouItems(),
    ]);

    const hideAdultCovers = this.adultModePref() === "none";
    const relations = data.relationsData?.relations;
    const list: BrowseManga[] = [];
    if (relations && !Array.isArray(relations)) for (const v of Object.values(relations)) list.push(...v);
    list.push(...(data.suggestions ?? []), ...followingReadsItems, ...forYouItems);
    return list.map((it) => browseMangaToSManga(it, this.baseUrl, hideAdultCovers));
  }

  // ============================= Chapters ==============================
  private langMatches(language: string | null | undefined) {
    return language == null || language.toLowerCase() === this.lang.toLowerCase() || language.toLowerCase() === this.queryLang.toLowerCase();
  }

  private async fetchChapterListInternal(manga: SManga): Promise<SChapter[]> {
    const mode = this.chapterModePref();
    const deduplicate = this.preferences.getBoolean(DEDUPLICATE_CHAPTERS, false);

    const chaptersP = mode !== "volumes" ? this.fetchChaptersList(manga) : Promise.resolve([]);
    const volumesP = (async (): Promise<SChapter[]> => {
      if (mode === "chapters") return [];
      const volumesUrl = toHttpUrl(`${this.baseUrl}/api/manga/${manga.url}/volumes`).newBuilder().addQueryParameter("lang", this.queryLang).build();
      return (await this.client.get(volumesUrl.toString()))
        .parseAs<Volume[]>()
        .filter((it) => this.langMatches(it.language))
        .map((volume) => {
          const chapter = SChapter.create();
          chapter.url = JSON.stringify({ id: String(volume.id), source: volume.source ?? "user", isVolume: true } satisfies ChapterUrl);
          chapter.name = `Volume ${floatText(volume.volume_number ?? 0)}`;
          chapter.chapter_number = 0;
          chapter.scanlator = (volume.group_name ?? volume.scanlator_name)?.trim() ? (volume.group_name ?? volume.scanlator_name)! : undefined;
          chapter.date_upload = tryParseInstant(volume.date_added?.replaceAll(" ", "T"));
          return chapter;
        });
    })();

    const chaptersResult = await chaptersP;
    const volumesResult = await volumesP;

    const allChapters = mode === "volumes" && volumesResult.length === 0 ? await this.fetchChaptersList(manga) : [...chaptersResult, ...volumesResult];

    let finalChapters: SChapter[];
    if (deduplicate && allChapters.length) {
      const prefPatterns = (this.preferences.getString(PREFERRED_SCANLATORS, "") ?? "")
        .split(",")
        .map((it) => it.trim().toLowerCase())
        .filter((it) => it.trim())
        .map((it) => new RegExp(`\\b${escapeRegex(it)}\\b`));

      const prefPatternsLower = new Set(prefPatterns.map((it) => it.source.toLowerCase()));
      const fullPriorityPatterns = [...prefPatterns, ...this.officialPriorityPatterns.filter((pattern) => !prefPatternsLower.has(pattern.source.toLowerCase()))];

      const dedupedChapters: SChapter[] = [];
      const grouped = new Map<number, SChapter[]>();
      for (const ch of allChapters) grouped.set(ch.chapter_number, [...(grouped.get(ch.chapter_number) ?? []), ch]);

      for (const [chapterNum, chapterGroup] of grouped) {
        if (chapterNum <= 0 || chapterGroup.length === 1) {
          dedupedChapters.push(...chapterGroup);
          continue;
        }

        let selectedChapter: SChapter | null = null;
        for (const pattern of fullPriorityPatterns) {
          const match = chapterGroup.find((ch) => ch.scanlator != null && pattern.test(ch.scanlator.toLowerCase()));
          if (match) {
            selectedChapter = match;
            break;
          }
        }
        dedupedChapters.push(selectedChapter ?? chapterGroup[0]);
      }
      finalChapters = dedupedChapters;
    } else finalChapters = allChapters;

    if (finalChapters.some((it) => it.scanlator != null)) {
      for (const it of finalChapters) it.scanlator = it.scanlator ?? "​";
    }

    return finalChapters;
  }

  private async fetchChaptersList(manga: SManga): Promise<SChapter[]> {
    const chaptersUrl = toHttpUrl(`${this.baseUrl}/api/manga/${manga.url}/chapters/list`).newBuilder().addQueryParameter("lang", this.queryLang).build();
    return (await this.client.get(chaptersUrl.toString()))
      .parseAs<Chapter[]>()
      .filter((it) => this.langMatches(it.language))
      .map((chapter) => {
        const sChapter = SChapter.create();
        sChapter.url = JSON.stringify({ id: String(chapter.id), source: chapter.source ?? "user", isVolume: false } satisfies ChapterUrl);
        const number = chapter.chapter_number != null ? floatText(chapter.chapter_number) : "0";
        const name = chapter.chapter_title ?? "";
        sChapter.name = (!name.includes(number) ? `Chapter ${number}: ` : "") + name.trim();
        sChapter.chapter_number = chapter.chapter_number ?? 0;
        const scanlator = chapter.group_name ?? chapter.scanlator_name;
        sChapter.scanlator = scanlator?.trim() ? scanlator : undefined;
        sChapter.date_upload = tryParseInstant(chapter.date_added?.replaceAll(" ", "T"));
        return sChapter;
      })
      .reverse();
  }

  // =============================== Pages ===============================
  getChapterUrl(chapter: SChapter): string {
    const chapterUrl = JSON.parse(chapter.url) as ChapterUrl;
    if (chapterUrl.isVolume) return `${this.baseUrl}/volume/${chapterUrl.id}`;
    const builder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("chapter").addPathSegment(chapterUrl.id);
    if (chapterUrl.source === "user") builder.addQueryParameter("source", "user");
    return builder.build().toString();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = JSON.parse(chapter.url) as ChapterUrl;
    const segment = chapterUrl.source === "user" ? "uploads" : "chapters";
    const data = (await this.client.get(`${this.baseUrl}/api/${segment}/${chapterUrl.id}/images`)).parseAs<Images>();

    this.countViews(data.manga.id);

    const chapterPageUrl = this.getChapterUrl(chapter);
    return data.images
      .map((image, index) => {
        let imageUrl: string | undefined;
        if (image.url.startsWith("/")) imageUrl = this.baseUrl + image.url;
        else if (image.url.startsWith("http")) imageUrl = image.url;
        return new Page(index, chapterPageUrl, imageUrl);
      })
      .filter((it) => it.imageUrl != null);
  }

  private countViews(mangaId: number) {
    const headers = new Headers(this.headers);
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    this.client.enqueue({ url: `${this.baseUrl}/api/manga/${mangaId}/view`, method: "POST", headers, body: "" });
  }

  imageRequest(page: Page): { url: string; headers: Headers } {
    const i = page.url.lastIndexOf("#");
    const referer = i < 0 ? page.url : page.url.slice(0, i);
    const headers = this.headersBuilder();
    headers.set("Referer", referer);
    return { url: page.imageUrl!, headers };
  }

  // ============================ Preferences ============================
  private adultModePref(): string {
    return this.preferences.getString(NSFW_MODE, "none")!;
  }

  private chapterModePref(): string {
    return this.preferences.getString(CHAPTER_MODE, "chapters")!;
  }

  private excludedDemographicsPref(): string[] {
    return this.preferences.getStringSet(EXCLUDE_DEMOGRAPHIC_PREF, []);
  }

  private excludedContentRatingPref(): string[] {
    const highest = this.preferences.getString(CONTENT_RATING_PREF, "suggestive")!;
    const index = Math.max(
      contentRatings.findIndex((it) => it[1] === highest),
      0,
    );
    return contentRatings.slice(index + 1).map((it) => it[1]);
  }

  private excludedGenresPref(): string[] {
    const mode = this.adultModePref();
    return mode === "1" || mode === "both" ? this.preferences.getStringSet(EXCLUDE_GENRE_ADULT_PREF, []) : this.preferences.getStringSet(EXCLUDE_GENRE_PREF, []);
  }

  private readonly allOrigins = ["JP", "KR", "CN", "EN", "ONESHOT"];

  private excludedTypesPref(): string[] {
    return this.preferences.getStringSet(BROWSE_TYPE_PREF, []);
  }

  private includedTypes(): string[] {
    const excluded = this.excludedTypesPref();
    const included = this.allOrigins.filter((it) => !excluded.includes(it));
    return included.length === 0 || included.length === this.allOrigins.length ? [] : included;
  }

  private browseStatusPref(): string | null {
    const v = this.preferences.getString(BROWSE_STATUS_PREF, "");
    return v !== "" ? v : null;
  }

  private showTagsPref() {
    return this.preferences.getBoolean(SHOW_TAGS_PREF, true);
  }

  // ============================= Bookmarks =============================
  private parseBookmarksResponse(response: Response): MangasPage {
    try {
      const flat = response.parseAs<Json[]>();
      const decoded = this.decodeRsc(flat);
      if (decoded == null) throw new Error(LOGIN_MESSAGE);
      const routeContent = (decoded as Record<string, Json>)["pages/BookmarksPage"];
      if (routeContent == null) throw new Error(LOGIN_MESSAGE);

      const container = this.findRscObjectContaining(routeContent, "entries");
      const hideAdultCovers = this.adultModePref() === "none";

      const data = (container ?? {}) as BookmarksData;
      const entries = data.entries ?? [];

      if (entries.length === 0 && !this.isLoggedIn()) throw new Error(LOGIN_MESSAGE);

      return new MangasPage(
        entries.map((it) => browseMangaToSManga(it, this.baseUrl, hideAdultCovers)),
        bookmarksHasNextPage(data),
      );
    } catch {
      throw new Error(LOGIN_MESSAGE);
    }
  }

  private findRscObjectContaining(element: Json, fieldName: string): Record<string, Json> | null {
    if (Array.isArray(element)) {
      for (const item of element) {
        const found = this.findRscObjectContaining(item, fieldName);
        if (found) return found;
      }
    } else if (element && typeof element === "object") {
      if (fieldName in element) return element;
      for (const value of Object.values(element)) {
        const found = this.findRscObjectContaining(value, fieldName);
        if (found) return found;
      }
    }
    return null;
  }

  private isLoggedIn(): boolean {
    return this.client.cookieJar.loadForRequest(this.baseUrl).some((it) => it.name === "ory_kratos_session");
  }

  // ============================= Settings ==============================
  setupPreferenceScreen(screen: PreferenceScreen): void {
    const nsfwPref = new ListPreference(screen.context);
    nsfwPref.key = NSFW_MODE;
    nsfwPref.title = "NSFW (18+) Content";
    nsfwPref.entries = ["No 18+", "18+ Only", "Both 18+ & No 18+"];
    nsfwPref.entryValues = ["none", "1", "both"];
    nsfwPref.setDefaultValue("none");
    nsfwPref.summary = "%s";
    screen.addPreference(nsfwPref);

    const contentRatingPref = new ListPreference(screen.context);
    contentRatingPref.key = CONTENT_RATING_PREF;
    contentRatingPref.title = "Content Rating";
    contentRatingPref.entries = contentRatings.map((it) => `Up to ${it[0]}`);
    contentRatingPref.entryValues = contentRatings.map((it) => it[1]);
    contentRatingPref.setDefaultValue("suggestive");
    contentRatingPref.summary = "%s";
    screen.addPreference(contentRatingPref);

    const browseTypePref = new MultiSelectListPreference(screen.context);
    browseTypePref.key = BROWSE_TYPE_PREF;
    browseTypePref.title = "Type Blacklist";
    browseTypePref.entries = ["Manga", "Manhwa", "Manhua", "OEL", "One Shot"];
    browseTypePref.entryValues = ["JP", "KR", "CN", "EN", "ONESHOT"];
    browseTypePref.setDefaultValue([]);
    browseTypePref.summary = "Exclude types from Popular & Latest.";
    screen.addPreference(browseTypePref);

    const browseStatusPref = new ListPreference(screen.context);
    browseStatusPref.key = BROWSE_STATUS_PREF;
    browseStatusPref.title = "Status Filter";
    browseStatusPref.entries = ["Any Status", "Ongoing", "Completed", "Hiatus"];
    browseStatusPref.entryValues = ["", "Ongoing", "Completed", "Hiatus"];
    browseStatusPref.setDefaultValue("");
    browseStatusPref.summary = "Applies to Popular & Latest.";
    screen.addPreference(browseStatusPref);

    const showTagsPref = new SwitchPreferenceCompat(screen.context);
    showTagsPref.key = SHOW_TAGS_PREF;
    showTagsPref.title = "Show Tags In Details";
    showTagsPref.summary = "Show tags after genres in manga details.";
    showTagsPref.setDefaultValue(true);
    screen.addPreference(showTagsPref);

    const chapterModePref = new ListPreference(screen.context);
    chapterModePref.key = CHAPTER_MODE;
    chapterModePref.title = "Chapter List Mode";
    chapterModePref.entries = ["Chapters Only", "Volumes Only", "Chapters + Volumes"];
    chapterModePref.entryValues = ["chapters", "volumes", "both"];
    chapterModePref.setDefaultValue("chapters");
    chapterModePref.summary = "%s\nNote: Most titles don't have volumes. 'Volumes only' falls back to chapters if none are found.";
    screen.addPreference(chapterModePref);

    const dedupeSwitch = new SwitchPreferenceCompat(screen.context);
    dedupeSwitch.key = DEDUPLICATE_CHAPTERS;
    dedupeSwitch.title = "Deduplicate Chapters";
    dedupeSwitch.summary = "Keep only one version of each chapter, preferring selected scanlators.";
    dedupeSwitch.setDefaultValue(false);
    screen.addPreference(dedupeSwitch);

    // setEnabled(dedupe) / its change listener have no counterpart in the app's settings form
    const priorityPref = new EditTextPreference(screen.context);
    priorityPref.key = PREFERRED_SCANLATORS;
    priorityPref.title = "Scanlator Priority";
    priorityPref.summary =
      "Comma-separated, in order of preference. First match wins. Supports unofficial only if scanlator name matches website.\nDefaults to official scrapers: Manga Plus, VIZ Media, Webtoon, Tapas, MangaDex, K Manga, Manga UP, Comikey, Shonen Jump";
    priorityPref.setDefaultValue("VIZ Media, MANGA Plus, MangaPlus, Official, Webtoon, Tapas, MangaDex, K Manga, Manga UP, Comikey, Shonen Jump");
    screen.addPreference(priorityPref);

    const sortedDemographics = [...this.demographicNames].sort(byLower);
    const demographicPref = new MultiSelectListPreference(screen.context);
    demographicPref.key = EXCLUDE_DEMOGRAPHIC_PREF;
    demographicPref.title = "Demographic Blacklist";
    demographicPref.summary = "Exclude demographics when browsing.";
    demographicPref.entries = sortedDemographics;
    demographicPref.entryValues = sortedDemographics;
    demographicPref.setDefaultValue([]);
    screen.addPreference(demographicPref);

    // upstream's getFilterList() here has no fetched data either, so the genres come from the stored exclusions
    const genresFromFilters = firstInstanceOrNull(this.getFilterList(), GenreFilter)?.state.map((it) => it.name);
    const excludedNormal = this.preferences.getStringSet(EXCLUDE_GENRE_PREF, []);
    const excludedAdult = this.preferences.getStringSet(EXCLUDE_GENRE_ADULT_PREF, []);
    const genres = [...new Set(genresFromFilters ?? [...excludedNormal, ...excludedAdult].filter((it) => !this.demographicNames.includes(it)))].sort(byLower);

    // setEnabled by NSFW mode is not expressible in the app's form: both lists are always shown
    const normalGenrePref = new MultiSelectListPreference(screen.context);
    normalGenrePref.key = EXCLUDE_GENRE_PREF;
    normalGenrePref.title = "Genre Blacklist";
    normalGenrePref.summary = "Exclude genres when browsing without 18+ content.";
    normalGenrePref.entries = genres;
    normalGenrePref.entryValues = genres;
    normalGenrePref.setDefaultValue([]);
    screen.addPreference(normalGenrePref);

    const adultGenrePref = new MultiSelectListPreference(screen.context);
    adultGenrePref.key = EXCLUDE_GENRE_ADULT_PREF;
    adultGenrePref.title = "Genre Blacklist (Adult Mode)";
    adultGenrePref.summary = "Exclude genres when browsing with 18+ content.";
    adultGenrePref.entries = genres;
    adultGenrePref.entryValues = genres;
    adultGenrePref.setDefaultValue([]);
    screen.addPreference(adultGenrePref);
  }

  // ============================ RSC Decoder ============================
  private decodeRscAs<T>(response: Response): T {
    const flat = response.parseAs<Json[]>();
    const decoded = this.decodeRsc(flat);
    if (decoded == null) throw new Error("Failed to decode RSC response");
    const routes = new URL(response.url).searchParams.get("_routes");
    if (routes != null) {
      const routeElement = (decoded as Record<string, Json>)[routes];
      if (routeElement === undefined) throw new Error(`Route '${routes}' not found in RSC response`);
      return routeElement as T;
    }
    return decoded as T;
  }

  private decodeRsc(flat: Json[]): Json {
    const cache = new Map<number, Json>();
    const resolve = (i: number): Json => {
      if (i < 0) return null;
      if (cache.has(i)) return cache.get(i)!;
      const el = flat[i];
      let result: Json;
      if (el === null || el === undefined) result = null;
      else if (Array.isArray(el)) result = el.map((it) => resolve(it as number));
      else if (typeof el === "object") {
        result = {};
        for (const [k, v] of Object.entries(el)) result[String(flat[Number.parseInt(k.replace(/^_/, ""), 10)])] = resolve(v as number);
      } else result = el;
      cache.set(i, result);
      return result;
    };
    return resolve(0);
  }
}
