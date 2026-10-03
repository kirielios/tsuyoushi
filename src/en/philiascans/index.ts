// Port of keiyoushi/extensions-source src/en/philiascans/PhiliaScans.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  toHttpUrl,
  type ClientBuilder,
  type PreferenceScreen,
  type SChapter,
} from "../../../sdk/index.ts";
import { chapterToSChapter, detailsToSManga, hasNextPage, isLocked, itemToSManga } from "./dto.ts";
import type { ChapterResponse, DetailsResponse, DrmResponse, OpenResponse, PageKeys, SeriesResponse, TokenResponse, ViewerResponse } from "./dto.ts";
import { GenreFilter, OrderFilter, SortFilter, StatusFilter, TypeFilter, addFilter } from "./filters.ts";
import { imageInterceptor } from "./imageinterceptor.ts";

const HIDE_LOCKED_PREF_KEY = "hide_locked";
const TOKEN_SKEW_MS = 60_000;

export default class PhiliaScans extends KeiSource {
  private get apiUrl(): string {
    return `${this.baseUrl}/api`;
  }

  private readonly emptyBody = new Uint8Array(0);

  private get tokenHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("Accept", "application/json");
    h.set("Accept-Language", "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6");
    h.set("Sec-Fetch-Mode", "cors");
    h.set("X-Requested-With", "XMLHttpRequest");
    return h;
  }

  /** Mutex: token requests run one after another. */
  private tokenLock: Promise<unknown> = Promise.resolve();
  private cachedToken: string | null = null;
  private cachedExpiresAtMs = 0;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => imageInterceptor(this.host, chain));
  }

  // ============================== Popular ==============================

  getPopularManga(page: number): Promise<MangasPage> {
    const sort = new SortFilter();
    sort.state = 2;
    return this.getSearchMangaList(page, "", FilterList(sort, new OrderFilter()));
  }

  // ============================== Latest ===============================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter(), new OrderFilter()));
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/manga`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("perPage", "20");
    if (query.trim()) url.addQueryParameter("q", query);
    addFilter(url, "orderby", firstInstanceOrNull(filters, SortFilter));
    addFilter(url, "order", firstInstanceOrNull(filters, OrderFilter));
    addFilter(url, "types", firstInstanceOrNull(filters, TypeFilter));
    addFilter(url, "statuses", firstInstanceOrNull(filters, StatusFilter));
    addFilter(url, "genres", firstInstanceOrNull(filters, GenreFilter));

    const result = (await this.client.get(url.build().toString())).parseAs<SeriesResponse>();
    return new MangasPage(
      result.items.map((it) => itemToSManga(it, this.baseUrl)),
      hasNextPage(result),
    );
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Note: Search and active filters are applied together"), new SortFilter(), new OrderFilter(), new TypeFilter(), new StatusFilter(), new GenreFilter());
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const detailsPromise = (async () => {
      if (!fetchDetails) return manga;
      const details = detailsToSManga((await this.client.get(`${this.apiUrl}/manga/${manga.url}`)).parseAs<DetailsResponse>(), this.baseUrl);
      details.url = manga.url;
      return details;
    })();
    const chaptersPromise = (async () => {
      if (!fetchChapters) return chapters;
      return this.getChapterList(manga.url);
    })();
    return new SMangaUpdate(...(await Promise.all([detailsPromise, chaptersPromise])));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== "series") return null;
    const slug = segments[1]?.trim() ? segments[1] : null;
    if (slug === null) return null;
    const manga = detailsToSManga((await this.client.get(`${this.apiUrl}/manga/${slug}`)).parseAs<DetailsResponse>(), this.baseUrl);
    manga.url = slug;
    return manga;
  }

  // ============================= Chapters ==============================

  private async getChapterList(slug: string): Promise<SChapter[]> {
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    return (await this.client.get(`${this.apiUrl}/manga/${slug}/chapters`))
      .parseAs<ChapterResponse>()
      .items.filter((it) => !hideLocked || !isLocked(it))
      .map((it) => chapterToSChapter(it, slug));
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/series/${chapter.url}`;
  }

  // =============================== Pages ===============================

  private async fetchPageKeys(chapterId: number, token: string): Promise<[string, PageKeys]> {
    const response = await this.client.get(`${this.apiUrl}/chapters/${chapterId}/page-keys`, this.readerHeaders(token), { ensureSuccess: false });
    if (response.code === 404) {
      const refreshed = await this.getReaderAccessToken(true);
      return [refreshed, (await this.client.get(`${this.apiUrl}/chapters/${chapterId}/page-keys`, this.readerHeaders(refreshed))).parseAs<PageKeys>()];
    }
    if (!response.isSuccessful) {
      switch (response.code) {
        case 429:
          throw new Error("Rate limited by Philia Scans. Wait a moment and try again.");
        case 401:
          throw new Error("Log in via WebView to renew access.");
        default:
          throw new Error(`Failed to get page keys (HTTP ${response.code}).`);
      }
    }
    return [token, response.parseAs<PageKeys>()];
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const parts = chapter.url.split("/");
    const mangaSlug = parts[0];
    const chapterSlug = parts.at(-1)!;
    const result = (await this.client.get(`${this.apiUrl}/manga/${mangaSlug}/chapters/${chapterSlug}`)).parseAs<ViewerResponse>();
    if (!result.hasAccess) throw new Error("Log in via Webview and purchased this chapter to read.");

    const [token, pageKeyResponse] = await this.fetchPageKeys(result.chapter.id, await this.getReaderAccessToken());
    const headers = this.readerHeaders(token);

    const isScrambled = result.chapter.scrambled ? "1" : "0";

    let payloadA: string | null | undefined = null;
    let payloadB: string | null | undefined = null;
    if (pageKeyResponse.sessionDefault) {
      const openResponse = (await this.client.post(`${this.apiUrl}/chapters/${result.chapter.id}/open`, headers, this.emptyBody)).parseAs<OpenResponse>();
      const drmCall = await this.client.get(`${this.apiUrl}/chapters/${result.chapter.id}/get-drm?session=${openResponse.sessionId}`, headers, { ensureSuccess: false });
      const drmResponse = drmCall.isSuccessful ? drmCall.parseAs<DrmResponse>() : null;
      payloadA = openResponse.payloadA;
      payloadB = drmResponse?.payloadB;
    }

    return [...result.chapter.pages]
      .sort((a, b) => a.position - b.position)
      .map((page, i) => {
        const imageUrl = page.url.startsWith("http") ? page.url : `${this.baseUrl}/${page.url}`;
        // Kotlin's string templates print a missing payload as "null"
        return new Page(i, "", `${imageUrl}#${isScrambled};${page.mime};${pageKeyResponse.chapterKeyB64};${pageKeyResponse.gridSize};${payloadA ?? "null"};${payloadB ?? "null"};${i}`);
      });
  }

  // ============================= Utilities =============================

  private getReaderAccessToken(forceRefresh = false): Promise<string> {
    const run = this.tokenLock.then(async () => {
      const now = Date.now();
      if (!forceRefresh && this.cachedToken !== null && this.cachedExpiresAtMs - now > TOKEN_SKEW_MS) return this.cachedToken;

      const response = await this.client.post(`${this.apiUrl}/reader/access-token`, this.tokenHeaders, this.emptyBody, { ensureSuccess: false });
      if (!response.isSuccessful) {
        switch (response.code) {
          case 429:
            throw new Error("Rate limited by Philia Scans. Wait a moment and try again.");
          case 401:
            throw new Error("Log in via WebView to renew access.");
          default:
            throw new Error(`Failed to get reader access token (HTTP ${response.code}).`);
        }
      }

      const result = response.parseAs<TokenResponse>();
      this.cachedToken = result.token;
      this.cachedExpiresAtMs = result.expiresAt * 1000;
      return result.token;
    });
    this.tokenLock = run.catch(() => undefined);
    return run;
  }

  private readerHeaders(token: string): Headers {
    const h = this.tokenHeaders;
    h.append("X-Reader-Access-Token", token);
    return h;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new SwitchPreferenceCompat();
    pref.key = HIDE_LOCKED_PREF_KEY;
    pref.title = "Hide Locked Chapters";
    pref.summary = "Hide chapters that require coins to read.";
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }
}
