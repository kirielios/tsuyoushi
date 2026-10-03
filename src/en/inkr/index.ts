// Port of keiyoushi/extensions-source src/en/inkr/Inkr.kt (+ ImageInterceptor.kt)
import {
  ClientBuilder,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  Response,
  SMangaUpdate,
  SwitchPreferenceCompat,
  aesCbcDecryptNoPadding,
  firstInstanceOrNull,
  type Chain,
  type PreferenceScreen,
  type Request,
  type SChapter,
  type SManga,
} from "../../../sdk/index.ts";
import { InkrAuth } from "./auth.ts";
import {
  CHAPTER_ACCESSIBLE_MEMO,
  CHAPTER_FREE_MEMO,
  CHAPTER_TITLE_MEMO,
  ChapterDto,
  titleToSManga,
  type ChapterPagesDto,
  type ChapterPagesIncludes,
  type ContentJsonRequest,
  type ContentMapResponse,
  type FilteredRequest,
  type FilteredResponse,
  type NamedDto,
  type SearchResponse,
  type TitleDto,
} from "./dto.ts";
import { GENRES, GenreFilters, StatusFilter, TypeFilter, defaultFilterList } from "./filters.ts";

const PAGE_SIZE = 20;
const BATCH_SIZE = 50;
const IMAGE_VARIANT = "w1600.ikc";
const SHOW_NSFW_PREF_KEY = "show_nsfw_titles";
const SHOW_PAID_PREF_KEY = "show_paid_chapters";

const TITLE_LIST_FIELDS = [
  "oid",
  "name",
  "thumbnailImage",
  "releaseStatus",
  "styleOrigin",
  "keyGenreList",
  "summary",
  "pageReadCount",
  "latestChapterFirstPublishedDate",
  "isExplicit",
  "monetizationType",
  "isAvailable",
  "isRemovedFromSale",
];
const TITLE_DETAIL_FIELDS = [...TITLE_LIST_FIELDS, "chapterList", "titleCreators"];
const CHAPTER_FIELDS = ["oid", "name", "order", "firstPublishedDate", "publishedDate", "revenueType", "coinPrice", "isPurchasedByCoin", "isPurchasedBySub"];
const NAMED_FIELDS = ["oid", "name", "url"];

type SortMode = "Popular" | "Latest" | "Relevance";

const chunked = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const distinct = <T>(list: T[]): T[] => [...new Set(list)];

// ============================ ImageInterceptor ============================
const KEY_XOR = 0x5a;
const ENCODED_KEY = [
  0x1f, 0x17, 0x0b, 0x11, 0x39, 0x2d, 0x03, 0x2b, 0x0b, 0x2e, 0x36, 0x12, 0x68, 0x63, 0x11, 0x20, 0x09, 0x00, 0x29, 0x1e, 0x35, 0x38, 0x12, 0x16, 0x6b, 0x37, 0x12, 0x2c, 0x20, 0x35, 0x2e, 0x36,
];
const KEY = Uint8Array.from(ENCODED_KEY, (b) => (b & 0xff) ^ KEY_XOR);
const IV_SIZE = 16;

async function imageInterceptor(chain: Chain): Promise<Response> {
  const request = chain.request();
  if (!new URL(request.url).pathname.endsWith(".ikc")) return chain.proceed(request);

  const response = await chain.proceed(request);
  if (!response.isSuccessful) return response;

  const source = response.bytes();
  // First 4 bytes are little-endian plaintext size; next 16 are IV. AES-CBC with no padding.
  const originalSize = new DataView(source.buffer, source.byteOffset, source.byteLength).getInt32(0, true);
  const iv = source.subarray(4, 4 + IV_SIZE);
  const plain = await aesCbcDecryptNoPadding(KEY, iv, source.subarray(4 + IV_SIZE));
  return Response.of(response.url, plain.subarray(0, originalSize), "image/webp", response.code);
}

export default class Inkr extends KeiSource {
  private readonly queryApiUrl = "https://icq-api.inkr.com/v1";
  private readonly contentApiUrl = "https://icd-api.inkr.com/v1";

  private readonly auth = new InkrAuth(
    () => this.client,
    () => this.baseUrl,
  );

  private _apiHeaders?: Headers;
  private get apiHeaders(): Headers {
    if (!this._apiHeaders) {
      const h = this.headersBuilder();
      h.set("User-Agent", "okhttp/4.9.1");
      h.set("ikc-platform", "android");
      h.set("cf-ipcountry", "en-GB");
      h.set("Accept", "application/json");
      this._apiHeaders = h;
    }
    return this._apiHeaders;
  }
  /** apiHeaders + toJsonRequestBody()'s media type */
  private get jsonApiHeaders(): Headers {
    const h = new Headers(this.apiHeaders);
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  // ponytail: catalogMutex dropped; concurrent first loads may both fetch, the last one wins the cache
  private catalogCache: { key: string; titles: TitleDto[] } | null = null;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((request) => this.authInterceptor(request)).addChainInterceptor(imageInterceptor);
  }

  private authInterceptor(request: Request): Request {
    const host = new URL(request.url).hostname;
    if ((host === "icq-api.inkr.com" || host === "icd-api.inkr.com") && !request.headers.has("Authorization")) {
      const token = this.auth.accessToken;
      if (token != null) {
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return { ...request, headers };
      }
    }
    return request;
  }

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.browseManga(page, "", FilterList(), "Popular");
  }

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.browseManga(page, "", FilterList(), "Latest");
  }

  override getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const trimmed = query.trim();
    const sortMode: SortMode = !trimmed ? "Popular" : this.genreIdForName(trimmed) != null ? "Popular" : "Relevance";
    return this.browseManga(page, trimmed, filters, sortMode);
  }

  private async browseManga(page: number, query: string, filters: FilterList, sortMode: SortMode): Promise<MangasPage> {
    const showNsfw = this.preferences.getBoolean(SHOW_NSFW_PREF_KEY, false);
    const filterRequest = this.buildFilteredRequest(filters, query);
    const cacheKey = this.catalogKey(query, filterRequest, sortMode, showNsfw);
    let titles: TitleDto[];
    const cached = this.catalogCache;
    if (cached != null && cached.key === cacheKey) {
      titles = cached.titles;
    } else {
      const oids = await this.resolveTitleOids(query, filterRequest);
      let hydrated = (await this.hydrateTitles(oids)).filter((it) => (it.isAvailable ?? true) && !it.isRemovedFromSale).filter((it) => showNsfw || !it.isExplicit);
      // /title/search ranks poorly (often worst-first); keep name matches only
      if (!(query === "" || this.genreIdForName(query) != null)) {
        hydrated = hydrated.filter((it) => (it.name ?? "").toLowerCase().includes(query.toLowerCase()));
      }
      let sorted: TitleDto[];
      switch (sortMode) {
        case "Popular":
          sorted = [...hydrated].sort((a, b) => (b.pageReadCount ?? 0) - (a.pageReadCount ?? 0));
          break;
        case "Latest":
          sorted = [...hydrated].sort((a, b) => {
            const x = a.latestChapterFirstPublishedDate ?? "";
            const y = b.latestChapterFirstPublishedDate ?? "";
            return x < y ? 1 : x > y ? -1 : 0;
          });
          break;
        case "Relevance":
          sorted = hydrated;
      }
      this.catalogCache = { key: cacheKey, titles: sorted };
      titles = sorted;
    }

    const from = (page - 1) * PAGE_SIZE;
    if (from >= titles.length) return new MangasPage([], false);
    const pageTitles = titles.slice(from, Math.min(from + PAGE_SIZE, titles.length));
    const mangas = await this.toSMangaList(pageTitles);
    return new MangasPage(mangas, from + PAGE_SIZE < titles.length);
  }

  private buildFilteredRequest(filters: FilterList, searchQuery = ""): FilteredRequest {
    const type = firstInstanceOrNull(filters, TypeFilter)?.selected || null;
    const status = firstInstanceOrNull(filters, StatusFilter)?.selected || null;
    const selectedGenres = (firstInstanceOrNull(filters, GenreFilters)?.state ?? []).flatMap((letterGroup) => letterGroup.state.filter((it) => it.state).map((it) => it.id));
    const g = this.genreIdForName(searchQuery);
    if (g != null) selectedGenres.push(g);

    const andGenres = distinct(selectedGenres);
    return {
      orStyleOrigin: type != null ? [type] : null,
      releaseStatus: status,
      andGenres: andGenres.length ? andGenres : null,
    };
  }

  private async resolveTitleOids(searchQuery: string, filterRequest: FilteredRequest): Promise<string[]> {
    // Genre chip clicks arrive as a search query matching the genre display name
    if (this.genreIdForName(searchQuery) != null) return this.filterTitleOids(filterRequest);
    if (!searchQuery) return this.filterTitleOids(filterRequest);
    const searchOids = await this.searchTitleOids(searchQuery);
    const hasFilters = filterRequest.orStyleOrigin != null || filterRequest.releaseStatus != null || filterRequest.andGenres != null;
    if (!hasFilters) return searchOids;
    const allowed = new Set(await this.filterTitleOids(filterRequest));
    return searchOids.filter((it) => allowed.has(it));
  }

  private genreIdForName(name: string): string | null {
    return GENRES.find((it) => it[0].toLowerCase() === name.toLowerCase())?.[1] ?? null;
  }

  /** request.toJsonRequestBody(): nulls dropped (explicitNulls = false). */
  private async filterTitleOids(request: FilteredRequest): Promise<string[]> {
    const res = await this.client.post(`${this.queryApiUrl}/title/filtered`, this.jsonApiHeaders, JSON.stringify(request, (_, v) => (v === null ? undefined : v)));
    return res.parseAs<FilteredResponse>().data ?? [];
  }

  private async searchTitleOids(query: string): Promise<string[]> {
    const res = await this.client.post(`${this.queryApiUrl}/title/search`, this.jsonApiHeaders, JSON.stringify({ query }));
    return res.parseAs<SearchResponse>().data?.title ?? [];
  }

  private async hydrateTitles(oids: string[]): Promise<TitleDto[]> {
    if (!oids.length) return [];
    const maps = await Promise.all(chunked(oids, BATCH_SIZE).map((chunk) => this.fetchContentMap(chunk, TITLE_LIST_FIELDS)));
    const byOid = new Map<string, TitleDto>();
    for (const m of maps) for (const [k, v] of Object.entries(m)) byOid.set(k, v as TitleDto);
    return oids.map((it) => byOid.get(it)).filter((it): it is TitleDto => it != null);
  }

  private async toSMangaList(titles: TitleDto[]): Promise<SManga[]> {
    const imageOids = distinct(titles.map((it) => it.thumbnailImage).filter((it): it is string => it != null));
    const images = await this.fetchNamedMap(imageOids);
    const genreOids = distinct(titles.flatMap((it) => it.keyGenreList ?? []));
    const genres = await this.fetchNamedMap(genreOids);

    return titles.map((title) =>
      titleToSManga(
        title,
        title.thumbnailImage != null ? images.get(title.thumbnailImage)?.url : null,
        null,
        (title.keyGenreList ?? [])
          .map((it) => genres.get(it)?.name)
          .filter((it) => it != null)
          .join(", ") || null,
      ),
    );
  }

  /** The detail part shared by fetchMangaUpdate and getMangaByUrl. */
  private async titleDetails(title: TitleDto): Promise<SManga> {
    const image = title.thumbnailImage != null ? (await this.fetchNamedMap([title.thumbnailImage])).get(title.thumbnailImage)?.url : null;
    const creatorsList = title.titleCreators ?? [];
    const creators = await this.fetchNamedMap(distinct(creatorsList.map((it) => it.creator)));
    const authors =
      distinct(creatorsList.map((it) => creators.get(it.creator)?.name).filter((it): it is string => it != null)).join(", ") || null;
    const keyGenres = title.keyGenreList ?? [];
    const genres = await this.fetchNamedMap(keyGenres);
    return titleToSManga(
      title,
      image,
      authors,
      keyGenres
        .map((it) => genres.get(it)?.name)
        .filter((it) => it != null)
        .join(", ") || null,
    );
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    await this.auth.ensureLoaded();
    const showPaid = this.preferences.getBoolean(SHOW_PAID_PREF_KEY, false);
    const titleDeferred = (async () => {
      if (!fetchDetails && !fetchChapters) return null;
      const t = (await this.fetchContentMap([manga.url], TITLE_DETAIL_FIELDS))[manga.url] as TitleDto | undefined;
      if (t == null) throw new Error("Title not found");
      return t;
    })();

    const detailsDeferred = (async () => {
      if (!fetchDetails) return manga;
      return this.titleDetails((await titleDeferred)!);
    })();

    const chaptersDeferred = (async () => {
      if (!fetchChapters) return chapters;
      const title = (await titleDeferred)!;
      const chapterList = title.chapterList ?? [];
      if (!chapterList.length) return [];

      const maps = await Promise.all(chunked(chapterList, BATCH_SIZE).map((chunk) => this.fetchContentMap(chunk, CHAPTER_FIELDS)));
      const chapterMap = new Map<string, ChapterDto>();
      for (const m of maps) for (const [k, v] of Object.entries(m)) chapterMap.set(k, ChapterDto.from(v));

      const isSubscriber = this.auth.isSubscriber;
      const list: SChapter[] = [];
      for (const oid of chapterList) {
        const chapter = chapterMap.get(oid);
        if (!chapter) continue;
        const accessible = chapter.isAccessible(isSubscriber);
        if (!accessible && !showPaid) continue;
        list.push(chapter.toSChapter(title.oid, showPaid, isSubscriber));
      }
      return list.sort((a, b) => b.chapter_number - a.chapter_number);
    })();

    return new SMangaUpdate(await detailsDeferred, await chaptersDeferred);
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    await this.auth.ensureLoaded();

    const raw = (await this.fetchContentMap([chapter.url], CHAPTER_FIELDS))[chapter.url];
    const meta = raw != null ? ChapterDto.from(raw) : null;
    const isSubscriber = this.auth.isSubscriber;
    const memoBool = (k: string) => (typeof chapter.memo?.[k] === "boolean" ? (chapter.memo[k] as boolean) : null);
    const accessible = meta?.isAccessible(isSubscriber) ?? memoBool(CHAPTER_ACCESSIBLE_MEMO) ?? memoBool(CHAPTER_FREE_MEMO);

    if (accessible === false) {
      const revenue = meta?.revenueType?.toLowerCase() ?? "";
      if (this.auth.accessToken == null) throw new Error("Log in via WebView (INKR account), then reopen this chapter");
      if (revenue === "coin-only") throw new Error("Chapter requires INKR coins (Extra does not unlock coin-only chapters)");
      throw new Error("Chapter requires INKR coins or Extra subscription");
    }

    const pagesRaw = (
      await this.fetchContentMap([chapter.url], ["chapterPages"], {
        chapterPages: { fields: ["oid", "width", "height", "type"], includes: {}, includeKey: "page" },
      })
    )[chapter.url];
    if (pagesRaw == null) return [];
    const pagesDto = pagesRaw as ChapterPagesDto;

    return (pagesDto.chapterPages ?? []).map((page, index) => new Page(index, "", `${page.url.replace(/\/+$/, "")}/${IMAGE_VARIANT}`));
  }

  override getMangaUrl(manga: SManga): string {
    const id = manga.url.replace(/^ik-title-/, "");
    return `${this.baseUrl}/title/${id}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const t = chapter.memo?.[CHAPTER_TITLE_MEMO];
    if (typeof t !== "string") return this.baseUrl;
    const titleId = t.replace(/^ik-title-/, "");
    const chapterId = chapter.url.replace(/^ik-chapter-/, "");
    return `${this.baseUrl}/title/${titleId}/chapter/${chapterId}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.split("/").filter(Boolean);
    const segment = segments[0];
    if (segment == null || segment !== "title") return null;
    const raw = segments[1];
    if (raw == null) return null;
    const id = raw.split("-")[0];
    if (!/^\d*$/.test(id)) return null;
    const oid = `ik-title-${id}`;
    const title = (await this.fetchContentMap([oid], TITLE_DETAIL_FIELDS))[oid] as TitleDto | undefined;
    if (title == null) return null;
    const manga = await this.titleDetails(title);
    manga.initialized = true;
    return manga;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return defaultFilterList();
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const nsfw = new SwitchPreferenceCompat();
    nsfw.key = SHOW_NSFW_PREF_KEY;
    nsfw.title = "Show NSFW titles";
    nsfw.summary = "Include titles marked as explicit.";
    nsfw.setDefaultValue(false);
    screen.addPreference(nsfw);

    const paid = new SwitchPreferenceCompat();
    paid.key = SHOW_PAID_PREF_KEY;
    paid.title = "Show paid chapters";
    paid.summary = "Display locked coin/Extra chapters (marked 🔒). " + "Log in via WebView to unlock purchased/Extra chapters, then refresh the series.";
    paid.setDefaultValue(true);
    screen.addPreference(paid);
  }

  private async fetchNamedMap(oids: string[]): Promise<Map<string, NamedDto>> {
    const out = new Map<string, NamedDto>();
    if (!oids.length) return out;
    const maps = await Promise.all(chunked(oids, BATCH_SIZE).map((chunk) => this.fetchContentMap(chunk, NAMED_FIELDS)));
    for (const m of maps) for (const [k, v] of Object.entries(m)) out.set(k, v as NamedDto);
    return out;
  }

  private async fetchContentMap(oids: string[], fields: string[], includes: ChapterPagesIncludes | null = null): Promise<Record<string, unknown>> {
    if (!oids.length) return {};
    const req: ContentJsonRequest = { fields, oids };
    if (includes != null) req.includes = includes;
    const res = await this.client.post(`${this.contentApiUrl}/content_json/batch`, this.jsonApiHeaders, JSON.stringify([req]));
    return res.parseAs<ContentMapResponse>().data ?? {};
  }

  private catalogKey(searchQuery: string, request: FilteredRequest, sortMode: SortMode, showNsfw: boolean): string {
    return [sortMode, searchQuery, (request.orStyleOrigin ?? []).join(", "), request.releaseStatus ?? "", (request.andGenres ?? []).join(", "), String(showNsfw)].join("\u0000");
  }
}
