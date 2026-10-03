// Port of keiyoushi/extensions-source src/en/comix/Comix.kt
import {
  EditTextPreference,
  KeiSource,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  Page,
  PreferenceScreen,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  distinctBy,
  firstInstanceOrNull,
  parseAs,
  str,
  toHttpUrl,
  toHttpUrlOrNull,
  type Chain,
  type ClientBuilder,
  type Document,
  type FilterList,
  type HttpUrl,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { ComixCipher, type EncryptedResponse } from "./cipher.ts";
import { interceptor as descramblerInterceptor } from "./descrambler.ts";
import {
  CHAPTER_GROUP_ID_MEMO,
  CHAPTER_ID_MEMO,
  CHAPTER_LIST_BLACKLIST_MEMO,
  CHAPTER_LIST_DEDUPLICATED_MEMO,
  CHAPTER_OFFICIAL_MEMO,
  CHAPTER_VOTES_MEMO,
  MANGA_ID_MEMO,
  chapterToSChapter,
  hasNextPage,
  toBasicSManga,
  toSManga,
  type Chapter,
  type ChapterDetailsResponse,
  type ChapterResponse,
  type Items,
  type Manga,
  type SearchResponse,
  type TagSearchResponse,
} from "./dto.ts";
import { ArtistFilter, AuthorFilter, Filters, TagsFilter, getDemographics, getGenres, getTypes, isTermFilter, isUriFilter } from "./filters.ts";

const PREF_POSTER_QUALITY = "pref_poster_quality";
const PREF_CONTENT_RATING = "pref_content_rating";
const PREF_DEFAULT_TYPES = "pref_default_types";
const PREF_DEFAULT_DEMOGRAPHICS = "pref_default_demographics";
const PREF_BLOCKED_GENRES = "pref_blocked_genres";
const LEGACY_HIDE_NSFW_PREF = "nsfw_pref";
const DEDUPLICATE_CHAPTERS = "pref_deduplicate_chapters";
const PREF_FETCH_CHAPTERS_UNTIL_KNOWN = "pref_fetch_chapters_until_known";
const PREF_SCANLATOR_BLACKLIST = "pref_scanlator_blacklist";
const ALTERNATIVE_NAMES_IN_DESCRIPTION = "pref_alt_names_in_description";
const PREF_SHOW_EXTRA_INFO = "pref_show_extra_info";
const PREF_SHOW_TAGS_IN_GENRES = "pref_show_tags_in_genres";
const PREF_SCORE_POSITION = "pref_score_position";

const DEFAULT_CONTENT_RATING = "suggestive";
const MAX_CHAPTER_PAGES = 200;
const OFFICIAL_GROUP_ID = 10702;
const TAG_ID_CACHE_SIZE = 50;
const SCRAMBLE_PATH_FALLBACK_REGEX = /\/(?:i5|s?i+)\//;
const SERVER_ERROR_CODES = new Set([502, 503, 522, 523]);

/** The site's own script has to run in a WebView for this step; that is not ported (no site code is executed here). */
const WEBVIEW_UNSUPPORTED = "Comix needs a WebView to run the site's scripts for this request, which is not supported here";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * HttpUrl.newBuilder().setQueryParameter(name, value) / addQueryParameter(name, null) on the raw query, so flags such
 * as "?v3" keep OkHttp's form (no "=") that URLSearchParams would rewrite.
 */
function editQuery(url: string, edit: (parts: string[]) => string[]): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt < 0 ? "" : url.slice(hashAt);
  const base = hashAt < 0 ? url : url.slice(0, hashAt);
  const q = base.indexOf("?");
  const path = q < 0 ? base : base.slice(0, q);
  const parts = edit(q < 0 || q === base.length - 1 ? [] : base.slice(q + 1).split("&"));
  return path + (parts.length ? `?${parts.join("&")}` : "") + hash;
}
const paramName = (part: string) => decodeURIComponent(part.split("=")[0]);
const queryParameterNames = (url: string) => new Set(toHttpUrl(url).toURL().searchParams.keys());

export default class Comix extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api/v1`;
  }

  private cipher: ComixCipher | null = null;

  /** LinkedHashMap in access order, evicting the eldest past TAG_ID_CACHE_SIZE. */
  private readonly tagIdCache = new Map<string, string[]>();

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor((chain) => descramblerInterceptor(this.host, chain))
      .addChainInterceptor(async (chain) => {
        const request = chain.request();

        let response = await this.proceedWithRetry(chain, request);
        if (response.isSuccessful) return response;

        const url = request.url;
        const fallbacks = ["/i5/", "/si/", "/i/", "/sii/", "/ii/"].map((it) => url.replace(SCRAMBLE_PATH_FALLBACK_REGEX, it)).filter((it) => it !== url);

        if (!fallbacks.length) return response;

        for (const fallbackUrl of fallbacks) {
          response = await this.proceedWithRetry(chain, { ...request, url: fallbackUrl });
          if (response.isSuccessful) break;
        }
        return response;
      })
      .rateLimit(5);
  }

  private async proceedWithRetry(chain: Chain, request: Request): Promise<Response> {
    let response = await chain.proceed(request);
    if (response.isSuccessful) return response;

    for (let attempt = 1; attempt <= 10; attempt++) {
      if (!SERVER_ERROR_CODES.has(response.code) && response.code !== 404) break;

      await sleep(1500);

      const retryUrl = editQuery(request.url, (parts) => {
        const hasEight = parts.some((it) => paramName(it) === "8");
        const next = parts.filter((it) => paramName(it) !== "r");
        next.push(`r=${attempt}`);
        if (!hasEight) next.push("8");
        return next;
      });
      response = await chain.proceed({ ...request, url: retryUrl });
      if (response.isSuccessful) break;
    }

    return response;
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.append("Accept", "*/*");
    return headers;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegment("browse");
    url.addQueryParameter("order[score]", "desc");
    url.addQueryParameter("page", String(page));
    this.applyPreferenceFilters(url);
    return this.getMangaListFromBrowse(url.build());
  }

  private async getMangaListFromBrowse(url: HttpUrl): Promise<MangasPage> {
    const signed = await this.getSigned<SearchResponse>("/api/v1/manga", this.nativeMangaParams(url));
    if (signed != null) {
      return new MangasPage(
        (signed.result.items ?? []).map((it) => toBasicSManga(it, this.posterQuality())),
        hasNextPage(signed.result),
      );
    }

    const document = (await this.client.get(url.toString())).asJsoup();
    // Upstream falls back to a WebView that seeds the content filter in localStorage and captures the site's own
    // /api/v1/manga response; only the static initial-data read is possible here.
    const searchResponse = this.extractBrowseResponse(document) ?? this.runInWebView();

    const mangaList = (searchResponse.result.items ?? []).map((it) => toBasicSManga(it, this.posterQuality()));
    return new MangasPage(mangaList, hasNextPage(searchResponse.result));
  }

  private extractBrowseResponse(document: Document): SearchResponse | null {
    let queries: Record<string, unknown>;
    try {
      queries = this.extractInitialQueries(document);
    } catch {
      return null;
    }
    for (const value of Object.values(queries)) {
      const parsed = value as SearchResponse | null;
      if (parsed?.result && Array.isArray(parsed.result.items) && parsed.result.items.length) return parsed;
    }
    return null;
  }

  private extractInitialQueries(document: Document): Record<string, unknown> {
    const initialData = document.selectFirst("script#initial-data")?.data();
    if (initialData == null) throw new Error("Could not find initial data in page");
    const queries = parseAs<{ queries?: unknown }>(initialData).queries;
    if (queries == null || typeof queries !== "object" || Array.isArray(queries)) throw new Error("Could not find queries in initial data");
    return queries as Record<string, unknown>;
  }

  private nativeMangaParams(url: HttpUrl): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const params = url.toURL().searchParams;
    for (const name of new Set(params.keys())) {
      const values = params.getAll(name);
      if (values.length) map.set(name, name === "content_rating" ? values.flatMap((it) => it.split(",")) : values);
    }
    if (!map.has("limit")) map.set("limit", ["28"]);
    return map;
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegment("browse");
    url.addQueryParameter("order[chapter_updated_at]", "desc");
    url.addQueryParameter("page", String(page));
    this.applyPreferenceFilters(url);
    return this.getMangaListFromBrowse(url.build());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const author = firstInstanceOrNull(filters, AuthorFilter)?.state;
    const authorIds = author != null ? await this.resolveTagIdsForNames("author", author) : [];
    const artist = firstInstanceOrNull(filters, ArtistFilter)?.state;
    const artistIds = artist != null ? await this.resolveTagIdsForNames("artist", artist) : [];
    const tags = firstInstanceOrNull(filters, TagsFilter)?.state;
    const tagIds = tags != null ? await this.resolveTagIdsForNames("tag", tags) : [];
    const hasTermSelection = filters.some((it) => isTermFilter(it) && it.hasSelection) || tagIds.length > 0;
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("browse");
    filters
      .filter(isUriFilter)
      .filter((it) => !(it.requiresTermSelection && !hasTermSelection))
      .forEach((it) => {
        if (it.queryAware) it.addToUri(url, query);
        else it.addToUri(url);
      });

    authorIds.forEach((it) => url.addQueryParameter("authors[]", it));
    artistIds.forEach((it) => url.addQueryParameter("artists[]", it));
    tagIds.forEach((it) => url.addQueryParameter("genres_in[]", it));

    if (query.trim()) url.addQueryParameter("keyword", query);

    url.addQueryParameter("page", String(page));

    return this.getMangaListFromBrowse(url.build());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname.replace(/^www\./, "") !== toHttpUrl(this.baseUrl).host.replace(/^www\./, "")) return null;
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (segments.length < 2 || segments[0] !== "title") return null;

    const mangaSlug = segments[1];
    const mangaId = mangaSlug.split("-")[0];
    if (!mangaId) return null;
    const manga = SManga.create();
    manga.url = `/${mangaSlug}`;
    manga.memo = { [MANGA_ID_MEMO]: mangaId };
    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.url = manga.url;
    return result;
  }

  private sourceFilters() {
    return new Filters(this.contentRating(), this.defaultTypes(), this.defaultDemographics(), this.blockedGenres());
  }

  private applyPreferenceFilters(builder: ReturnType<HttpUrl["newBuilder"]>) {
    this.sourceFilters()
      .getFilterList()
      .filter(isUriFilter)
      .filter((it) => it.preferenceFilter)
      .forEach((it) => it.addToUri(builder));
  }

  private async resolveTagIdsForNames(type: string, raw: string): Promise<string[]> {
    const names = raw
      .split(",")
      .map((it) => it.trim())
      .filter((it) => it);
    const out: string[] = [];
    for (const name of names) out.push(...(await this.resolveTagIds(type, name)));
    return out;
  }

  private async resolveTagIds(type: string, name: string): Promise<string[]> {
    const cacheKey = `${type}\u0000${name.toLowerCase()}`;
    const cached = this.tagIdCache.get(cacheKey);
    if (cached) {
      this.tagIdCache.delete(cacheKey);
      this.tagIdCache.set(cacheKey, cached);
      return cached;
    }

    const url = toHttpUrl(this.apiUrl).newBuilder().addPathSegment("tags").addPathSegment("search").addQueryParameter("type", type).addQueryParameter("q", name).build();

    let ids: string[];
    try {
      ids = ((await this.client.get(url.toString())).parseAs<TagSearchResponse>().result ?? []).map((it) => String(it.id));
    } catch {
      return [];
    }
    this.tagIdCache.set(cacheKey, ids);
    if (this.tagIdCache.size > TAG_ID_CACHE_SIZE) this.tagIdCache.delete(this.tagIdCache.keys().next().value!);
    return ids;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let cachedDocument: Promise<Document> | null = null;
    const getDocument = () => (cachedDocument ??= this.client.get(this.getMangaUrl(manga)).then((it) => it.asJsoup()));

    const deduplicateChapters = this.deduplicateChapters();
    const scanlatorBlacklist = this.scanlatorBlacklist();
    const blacklistSignature = [...scanlatorBlacklist].sort().join(",");
    const storedDeduplicateChapters = typeof manga.memo[CHAPTER_LIST_DEDUPLICATED_MEMO] === "boolean" ? (manga.memo[CHAPTER_LIST_DEDUPLICATED_MEMO] as boolean) : null;
    const storedBlacklistSignature = str(manga.memo[CHAPTER_LIST_BLACKLIST_MEMO]) ?? null;
    const fetchUntilKnown = fetchChapters && this.fetchChaptersUntilKnown() && storedDeduplicateChapters === deduplicateChapters && storedBlacklistSignature === blacklistSignature;
    const latestChapterId = fetchUntilKnown && chapters.length ? this.chapterId(chapters[0]) : null;

    const nativeChapters = fetchChapters && this.cipher != null ? this.getNativeChapterList(manga, latestChapterId) : null;
    // async { } starts eagerly; keep a rejection from going unhandled while details load
    nativeChapters?.catch(() => undefined);

    const updatedManga = fetchDetails ? this.parseMangaDetails(await getDocument()) : manga;
    let updatedChapters: SChapter[];
    if (fetchChapters) {
      const fetched = (await nativeChapters) ?? (await this.getWebViewChapterList(manga, await getDocument(), latestChapterId));
      const candidates = fetchUntilKnown ? [...fetched, ...chapters] : fetched;
      updatedChapters = this.selectChapters(candidates, deduplicateChapters, scanlatorBlacklist);
    } else {
      updatedChapters = chapters;
    }
    const chapterListMode = fetchChapters ? deduplicateChapters : storedDeduplicateChapters;
    const chapterListBlacklist = fetchChapters ? blacklistSignature : storedBlacklistSignature;
    if (chapterListMode != null && chapterListBlacklist != null) {
      updatedManga.memo = { ...updatedManga.memo, [CHAPTER_LIST_DEDUPLICATED_MEMO]: chapterListMode, [CHAPTER_LIST_BLACKLIST_MEMO]: chapterListBlacklist };
    }
    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private parseMangaDetails(document: Document): SManga {
    const detail = Object.entries(this.extractInitialQueries(document)).find(([key]) => key.includes('"detail"'))?.[1];
    if (detail == null) throw new Error("Could not find manga detail in queries");

    return toSManga(detail as Manga, this.posterQuality(), this.alternativeNamesInDescription(), this.scorePosition(), this.showExtraInfo(), this.showTagsInGenres());
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/title${manga.url}`;
  }

  private mangaId(manga: SManga): string | null {
    const memo = str(manga.memo[MANGA_ID_MEMO]);
    if (memo != null) return memo;
    const seg = toHttpUrlOrNull(this.getMangaUrl(manga))?.pathSegments?.[1];
    const id = seg?.split("-")[0];
    return id ? id : null;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const related = Object.entries(this.extractInitialQueries(document)).find(([key]) => key.includes('"recommended"'))?.[1] as Items<Manga> | undefined;
    if (related == null) return [];

    return (related.items ?? []).map((it) => toBasicSManga(it, this.posterQuality()));
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/${chapter.url}`;
  }

  private chapterId(chapter: SChapter): number | null {
    const memo = chapter.memo[CHAPTER_ID_MEMO];
    if (typeof memo === "number") return memo;
    const last = toHttpUrlOrNull(this.getChapterUrl(chapter))?.pathSegments?.at(-1);
    const id = last?.split("-chapter-")[0];
    return id != null && /^[+-]?\d+$/.test(id) ? Number.parseInt(id, 10) : null;
  }

  private async getWebViewChapterList(manga: SManga, _document: Document, _latestChapterId: number | null): Promise<SChapter[]> {
    const mangaId = this.mangaId(manga);
    if (mangaId == null) throw new Error("Refresh manga details");
    // Upstream loads the page in a WebView, imports the site's env bundle and pages through its chapters() API
    return this.runInWebView();
  }

  private selectChapters(allChapters: SChapter[], shouldDeduplicate: boolean, scanlatorBlacklist: Set<string>): SChapter[] {
    const uniqueChapters = distinctBy(allChapters, (it) => it.url);
    const filteredChapters = !scanlatorBlacklist.size
      ? uniqueChapters
      : uniqueChapters.filter((chapter) => !scanlatorBlacklist.has((chapter.scanlator ?? "").trim().toLowerCase()) && !scanlatorBlacklist.has(String(this.groupId(chapter))));

    let finalChapters: SChapter[];
    if (shouldDeduplicate) {
      const chapterMap = new Map<number, SChapter>();
      this.deduplicateChaptersInto(chapterMap, filteredChapters);
      finalChapters = [...chapterMap.values()];
    } else {
      finalChapters = filteredChapters;
    }

    return [...finalChapters].sort((a, b) => b.chapter_number - a.chapter_number);
  }

  private deduplicateChaptersInto(chapterMap: Map<number, SChapter>, items: SChapter[]) {
    for (const ch of items) {
      const key = ch.chapter_number;
      const current = chapterMap.get(key);
      if (current == null) {
        chapterMap.set(key, ch);
      } else {
        const newIsOfficial = this.isOfficial(ch);
        const currentIsOfficial = this.isOfficial(current);
        const newIsOfficialGroup = this.groupId(ch) === OFFICIAL_GROUP_ID;
        const currentIsOfficialGroup = this.groupId(current) === OFFICIAL_GROUP_ID;

        let better: boolean;
        if (newIsOfficial && !currentIsOfficial) better = true;
        else if (!newIsOfficial && currentIsOfficial) better = false;
        else if (newIsOfficialGroup && !currentIsOfficialGroup) better = true;
        else if (!newIsOfficialGroup && currentIsOfficialGroup) better = false;
        else if (this.votes(ch) > this.votes(current)) better = true;
        else if (this.votes(ch) < this.votes(current)) better = false;
        else better = (this.chapterId(ch) ?? 0) > (this.chapterId(current) ?? 0);
        if (better) chapterMap.set(key, ch);
      }
    }
  }

  private votes(ch: SChapter): number {
    const v = ch.memo[CHAPTER_VOTES_MEMO];
    return typeof v === "number" ? v : 0;
  }

  private isOfficial(ch: SChapter): boolean {
    return ch.memo[CHAPTER_OFFICIAL_MEMO] === true;
  }

  private groupId(ch: SChapter): number | null {
    const v = ch.memo[CHAPTER_GROUP_ID_MEMO];
    return typeof v === "number" ? v : null;
  }

  private async getNativeChapterList(manga: SManga, latestChapterId: number | null): Promise<SChapter[] | null> {
    if (this.cipher == null) return null;
    const mangaSlug = toHttpUrl(this.getMangaUrl(manga)).pathSegments[1];
    if (mangaSlug == null) return null;
    const mangaId = this.mangaId(manga);
    if (mangaId == null) return null;
    const chapters: Chapter[] = [];
    let page = 1;
    while (page <= MAX_CHAPTER_PAGES) {
      const response = await this.getSigned<ChapterDetailsResponse>(
        `/api/v1/manga/${mangaId}/chapters`,
        new Map([
          ["limit", ["100"]],
          ["order[number]", ["desc"]],
          ["page", [String(page)]],
        ]),
      );
      if (response == null) return null;
      const items = response.result.items ?? [];
      chapters.push(...items);
      const reachedKnown = items.some((it) => it.id === latestChapterId);
      if (reachedKnown || !hasNextPage(response.result) || !items.length) break;
      page++;
    }
    return chapters.map((it) => chapterToSChapter(it, mangaSlug));
  }

  // V3 grid-scramble pages must NOT send Origin — the server withholds X-Scramble-Seed when
  // Origin is present. Legacy byte-XOR pages need Origin to receive X-Enc-Seed.
  override imageRequest(page: Page): { url: string; headers: Headers } {
    const imageUrl = page.imageUrl;
    if (imageUrl == null) return super.imageRequest(page);
    const urlWithoutFragment = imageUrl.split("#")[0];
    const imageHost = toHttpUrlOrNull(urlWithoutFragment)?.host ?? "";
    const isScrambled = imageUrl.includes("#scrambled");
    const isV3 = toHttpUrlOrNull(urlWithoutFragment) != null && queryParameterNames(urlWithoutFragment).has("v3");
    const isLegacyScramble = isScrambled && !isV3;
    const baseUrlHost = toHttpUrl(this.baseUrl).host;
    let requestHeaders: Headers;
    if (imageHost && !imageHost.endsWith(baseUrlHost) && !isLegacyScramble) {
      requestHeaders = this.headersBuilder();
      requestHeaders.delete("Origin");
    } else {
      requestHeaders = this.headers;
    }
    return { url: urlWithoutFragment, headers: requestHeaders };
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const native = await this.getNativePageList(chapter);
    if (native != null) return native;

    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    // The WebView capture script first looks for a { result: { pages } } payload in initial-data (static data, read
    // here as it would be there); catching it from the site's own JSON.parse needs the WebView.
    let payload: ChapterResponse | null = null;
    try {
      payload = (Object.values(this.extractInitialQueries(document)).find((it) => (it as ChapterResponse | null)?.result?.pages) as ChapterResponse | undefined) ?? null;
    } catch {
      payload = null;
    }
    return this.buildPages(payload ?? this.runInWebView());
  }

  private buildPages(response: ChapterResponse): Page[] {
    const pages = response.result.pages;
    const base = pages.baseUrl.replace(/\/+$/, "");

    return pages.items.map((img, index) => {
      const full = img.url.startsWith("http") ? img.url : `${base}/${img.url.replace(/^\/+/, "")}`;
      // V3 pages need the query flag so the server returns grid-scramble headers.
      // Legacy byte-XOR pages: add #scrambled so imageRequest keeps Origin for x-enc-seed
      const isV3 = img.s === 1 || full.includes("?v3");
      const isLegacyScramble = !isV3 && (index + 1) % 4 === 0;
      const url = isV3 ? (queryParameterNames(full).has("v3") ? full : editQuery(full, (parts) => [...parts, "v3"])) : isLegacyScramble ? `${full}#scrambled` : full;
      return new Page(index, "", url);
    });
  }

  private async getNativePageList(chapter: SChapter): Promise<Page[] | null> {
    if (this.cipher == null) return null;
    const chapterId = this.chapterId(chapter);
    if (chapterId == null) return null;
    const response = await this.getSigned<ChapterResponse>(`/api/v1/chapters/${chapterId}`, new Map());
    return response != null ? this.buildPages(response) : null;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return this.sourceFilters().getFilterList();
  }

  private async getSigned<T>(path: string, params: Map<string, string[]>): Promise<T | null> {
    const currentCipher = this.cipher;
    if (currentCipher == null) return null;
    try {
      const entries = this.canonicalEntries(params);
      const query = entries.map(([name, value]) => `${name}=${value.trim()}`).join("&");
      const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(path.replace(/^\/+/, ""));
      entries.forEach(([name, value]) => url.addQueryParameter(name, value));
      url.addQueryParameter("_", currentCipher.sign(path, query));
      const response = await this.client.get(url.build().toString());

      const root = response.parseAs<unknown>();
      const decoded = root != null && typeof root === "object" && !Array.isArray(root) && "e" in root ? parseAs<unknown>(currentCipher.decrypt((root as EncryptedResponse).e)) : root;
      return decoded as T;
    } catch {
      if (this.cipher === currentCipher) this.cipher = null;
      return null;
    }
  }

  private canonicalEntries(params: Map<string, string[]>): [string, string][] {
    const out: [string, string][] = [];
    const keys = [...params.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const rawName of keys) {
      const values = params.get(rawName)!;
      const name = rawName.endsWith("[]") ? rawName.slice(0, -2) : rawName;
      if (values.length === 1 && !rawName.endsWith("[]")) out.push([name, values[0]]);
      else values.forEach((value, index) => out.push([`${name}[${index}]`, value]));
    }
    return out;
  }

  // encodeURIComponent(): unused upstream, not ported.

  /**
   * runInWebView(): upstream renders the page in a WebView with an injected capture script, which also picks up the
   * cipher material (sboxes/keys) from the site's atob calls. Executing the site's scripts is not ported, so the
   * cipher stays unset and every WebView-only path ends here.
   */
  private runInWebView(): never {
    throw new Error(WEBVIEW_UNSUPPORTED);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const fetchUntilKnown = new SwitchPreferenceCompat(screen.context);
    fetchUntilKnown.key = PREF_FETCH_CHAPTERS_UNTIL_KNOWN;
    fetchUntilKnown.title = "Faster chapter list fetching";
    fetchUntilKnown.summary =
      "Enabled: Uses fewer requests, but may miss newly added older chapters " +
      "(e.g. chapter 5.5 when the latest known chapter is 150).\n\n" +
      "Disabled: Finds older chapter additions, but fetching large chapter lists is slower.";
    fetchUntilKnown.setDefaultValue(true);
    screen.addPreference(fetchUntilKnown);

    const poster = new ListPreference(screen.context);
    poster.key = PREF_POSTER_QUALITY;
    poster.title = "Thumbnail Quality";
    poster.summary = "Change the quality of the thumbnail. Current: %s.";
    poster.entryValues = ["small", "medium", "large"];
    poster.entries = ["Small", "Medium", "Large"];
    poster.setDefaultValue("large");
    screen.addPreference(poster);

    const rating = new ListPreference(screen.context);
    rating.key = PREF_CONTENT_RATING;
    rating.title = "Content rating";
    rating.summary = "Maximum content rating shown in popular, latest, and search " + "results. The Content rating filter in search overrides this. " + "Current: %s.";
    rating.entries = ["Show all", "Safe only", "Up to Suggestive", "Up to Erotica", "Up to Pornographic"];
    rating.entryValues = ["", "safe", "suggestive", "erotica", "pornographic"];
    rating.setDefaultValue(DEFAULT_CONTENT_RATING);
    screen.addPreference(rating);

    const types = new MultiSelectListPreference(screen.context);
    types.key = PREF_DEFAULT_TYPES;
    types.title = "Default types";
    types.summary = "Types to include in popular, latest, and search results. " + "The Type filter in search overrides this.";
    types.entries = getTypes().map((it) => it[0]);
    types.entryValues = getTypes().map((it) => it[1]);
    types.setDefaultValue(getTypes().map((it) => it[1]));
    screen.addPreference(types);

    const demographics = new MultiSelectListPreference(screen.context);
    demographics.key = PREF_DEFAULT_DEMOGRAPHICS;
    demographics.title = "Default demographics";
    demographics.summary = "Demographics to include in popular, latest, and search " + "results. The Demographic filter in search overrides this.";
    demographics.entries = getDemographics().map((it) => it[0]);
    demographics.entryValues = getDemographics().map((it) => it[1]);
    demographics.setDefaultValue(getDemographics().map((it) => it[1]));
    screen.addPreference(demographics);

    const blocked = new MultiSelectListPreference(screen.context);
    blocked.key = PREF_BLOCKED_GENRES;
    blocked.title = "Blocked genres";
    blocked.summary = "Genres always excluded from results. The search filter " + "can still include a blocked genre as a one-off override.";
    blocked.entries = getGenres().map((it) => it[0]);
    blocked.entryValues = getGenres().map((it) => it[1]);
    blocked.setDefaultValue([]);
    screen.addPreference(blocked);

    const dedup = new SwitchPreferenceCompat(screen.context);
    dedup.key = DEDUPLICATE_CHAPTERS;
    dedup.title = "Deduplicate Chapters";
    dedup.summary =
      "Remove duplicate chapters from the chapter list.\n" + "Official chapters (Comix-marked) are preferred, followed by the highest-voted or most recent.\n" + "Warning: It can be slow on large lists.";
    dedup.setDefaultValue(false);
    screen.addPreference(dedup);

    const blacklist = new EditTextPreference(screen.context);
    blacklist.key = PREF_SCANLATOR_BLACKLIST;
    blacklist.title = "Scanlator Blacklist";
    blacklist.summary = "Filter out chapters from specific groups. Comma-separated list of group names or group IDs (e.g., 'Violet Scans, 307').";
    blacklist.dialogTitle = "Exclude groups";
    blacklist.setDefaultValue("");
    screen.addPreference(blacklist);

    const altNames = new SwitchPreferenceCompat(screen.context);
    altNames.key = ALTERNATIVE_NAMES_IN_DESCRIPTION;
    altNames.title = "Show Alternative Names in Description";
    altNames.setDefaultValue(false);
    screen.addPreference(altNames);

    const extra = new SwitchPreferenceCompat(screen.context);
    extra.key = PREF_SHOW_EXTRA_INFO;
    extra.title = "Show extra info in description";
    extra.summary = "Append publication year, language, content rating, rank, " + "ratings count, follower count, and tracker links to the manga description.";
    extra.setDefaultValue(true);
    screen.addPreference(extra);

    const tagsInGenres = new SwitchPreferenceCompat(screen.context);
    tagsInGenres.key = PREF_SHOW_TAGS_IN_GENRES;
    tagsInGenres.title = "Show tags in genre chips";
    tagsInGenres.summary =
      "Include the site's narrative tag list (e.g. Demons, " +
      "Vampires, Time Travel) alongside the curated genres in the " +
      "manga details. Off by default — the curated set matches what " +
      "the site itself shows on the page.";
    tagsInGenres.setDefaultValue(false);
    screen.addPreference(tagsInGenres);

    const score = new ListPreference(screen.context);
    score.key = PREF_SCORE_POSITION;
    score.title = "Score display position";
    score.summary = "%s";
    score.entries = ["Top of description", "Bottom of description", "Don't show"];
    score.entryValues = ["top", "bottom", "none"];
    score.setDefaultValue("top");
    screen.addPreference(score);
  }

  private posterQuality() {
    return this.preferences.getString(PREF_POSTER_QUALITY, "large");
  }

  private deduplicateChapters() {
    return this.preferences.getBoolean(DEDUPLICATE_CHAPTERS, false);
  }

  private fetchChaptersUntilKnown() {
    return this.preferences.getBoolean(PREF_FETCH_CHAPTERS_UNTIL_KNOWN, true);
  }

  private scanlatorBlacklist(): Set<string> {
    return new Set(
      (this.preferences.getString(PREF_SCANLATOR_BLACKLIST, "") ?? "")
        .split(",")
        .map((it) => it.trim().toLowerCase())
        .filter((it) => it),
    );
  }

  private alternativeNamesInDescription() {
    return this.preferences.getBoolean(ALTERNATIVE_NAMES_IN_DESCRIPTION, false);
  }

  private scorePosition() {
    return this.preferences.getString(PREF_SCORE_POSITION, "top") ?? "top";
  }

  private showExtraInfo() {
    return this.preferences.getBoolean(PREF_SHOW_EXTRA_INFO, true);
  }

  private showTagsInGenres() {
    return this.preferences.getBoolean(PREF_SHOW_TAGS_IN_GENRES, false);
  }

  private defaultTypes(): string[] {
    return this.preferences.getStringSet(
      PREF_DEFAULT_TYPES,
      getTypes().map((it) => it[1]),
    );
  }

  private defaultDemographics(): string[] {
    return this.preferences.getStringSet(
      PREF_DEFAULT_DEMOGRAPHICS,
      getDemographics().map((it) => it[1]),
    );
  }

  private blockedGenres(): string[] {
    return this.preferences.getStringSet(PREF_BLOCKED_GENRES, []);
  }

  // The legacy "Hide NSFW" boolean still exists in some users' preferences;
  // map it to a sensible default until they pick a value explicitly.
  private contentRating(): string {
    if (this.preferences.contains(PREF_CONTENT_RATING)) return this.preferences.getString(PREF_CONTENT_RATING, DEFAULT_CONTENT_RATING) ?? DEFAULT_CONTENT_RATING;
    if (this.preferences.contains(LEGACY_HIDE_NSFW_PREF) && !this.preferences.getBoolean(LEGACY_HIDE_NSFW_PREF, true)) return "";
    return DEFAULT_CONTENT_RATING;
  }
}
