// keiyoushi.source.KeiSource: the base class 1,174 of Keiyoushi's 1,377 extensions build on (libVersion 1.6).
import type { Host, Meta } from "./host.ts";
import { ClientBuilder, HttpClient, type Response } from "./network.ts";
import { MangasPage, type Page, type SChapter, type SManga, type SMangaUpdate } from "./models.ts";
import type { FilterList } from "./filters.ts";
import { EditTextPreference, ListPreference, PreferenceScreen, SharedPreferences } from "./preferences.ts";

const MIRROR_KEY = "preferred_mirror";
const CUSTOM_KEY = "overrideBaseUrl";
const CUSTOM_DEFAULT_KEY = "defaultBaseUrl";

/** CustomUrlPreferences' change listener: blank or invalid -> null (use the default), else scheme://host[:port]. */
export function sanitizeBaseUrl(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const u = new URL(text.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export abstract class KeiSource {
  readonly id: string;
  readonly name: string;
  readonly lang: string;

  constructor(
    protected readonly host: Host,
    readonly meta: Meta,
  ) {
    this.id = meta.id;
    this.name = meta.name;
    this.lang = meta.lang;
  }

  /**
   * The gradle plugin's generated wrapper upstream: a fixed URL, the preferred mirror (MirrorPreferences) or the user's
   * override (CustomUrlPreferences).
   */
  get baseUrl(): string {
    const { mirrors, customUrl, baseUrl } = this.meta;
    if (mirrors?.length) {
      const i = Number.parseInt(this.preferences.getString(MIRROR_KEY, "0") ?? "0", 10);
      return mirrors[Math.min(Math.max(Number.isNaN(i) ? 0 : i, 0), mirrors.length - 1)];
    }
    if (customUrl) {
      // a new upstream default replaces a stale override, as CustomUrlPreferences' init does
      if (this.preferences.getString(CUSTOM_DEFAULT_KEY) !== baseUrl) this.preferences.edit().putString(CUSTOM_KEY, baseUrl).putString(CUSTOM_DEFAULT_KEY, baseUrl).apply();
      return sanitizeBaseUrl(this.preferences.getString(CUSTOM_KEY, baseUrl) ?? "") ?? baseUrl;
    }
    return baseUrl;
  }

  private _client?: HttpClient;
  /**
   * Built on first use, not in the constructor: a subclass's configureClient() may read its own fields, which are
   * only initialised after this constructor returns.
   */
  get client(): HttpClient {
    return (this._client ??= new HttpClient(this.host, () => this.headers, this.configureClient(new ClientBuilder())));
  }
  /** Rate limits, interceptors: `return builder.rateLimit(2)`. */
  protected configureClient(builder: ClientBuilder): ClientBuilder {
    return builder;
  }

  get supportsLatest(): boolean {
    return true;
  }

  /** Append source-specific headers. User-Agent, Referer and Origin are already set, as upstream. */
  protected configureHeaders(headers: Headers): Headers {
    return headers;
  }
  headersBuilder(): Headers {
    return this.configureHeaders(new Headers({ "User-Agent": this.host.userAgent, Referer: `${this.baseUrl}/`, Origin: this.baseUrl }));
  }
  /** Not lazy, matching KeiSource. */
  get headers(): Headers {
    return this.headersBuilder();
  }

  private _prefs?: SharedPreferences;
  /** getPreferences() / getPreferencesLazy() */
  protected get preferences(): SharedPreferences {
    return (this._prefs ??= new SharedPreferences(this.host.prefs));
  }
  /** ConfigurableSource: add preferences to `screen`. Sources without settings leave it empty. */
  setupPreferenceScreen(_screen: PreferenceScreen): void {}

  /** What the host calls: the generated mirror/custom-URL preference first, then the source's own screen. */
  buildPreferenceScreen(screen: PreferenceScreen): void {
    const { mirrors, customUrl, baseUrl } = this.meta;
    if (mirrors?.length) {
      const p = new ListPreference();
      p.key = MIRROR_KEY;
      p.title = "Preferred Mirror";
      p.entries = mirrors.map((m) => new URL(m).host);
      p.entryValues = mirrors.map((_, i) => String(i));
      p.setDefaultValue("0");
      screen.addPreference(p);
    } else if (customUrl) {
      const p = new EditTextPreference();
      p.key = CUSTOM_KEY;
      p.title = "Custom Base URL";
      p.summary = "Leave blank to use the default URL.";
      p.setDefaultValue(baseUrl);
      screen.addPreference(p);
    }
    this.setupPreferenceScreen(screen);
  }

  abstract getPopularManga(page: number): Promise<MangasPage>;
  abstract getLatestUpdates(page: number): Promise<MangasPage>;
  abstract getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage>;

  /** Resolves a pasted URL; sources opt in by overriding. */
  protected getMangaByUrl(_url: URL): Promise<SManga | null> {
    throw new Error("getMangaByUrl not implemented");
  }
  protected async getMangasByUrl(url: URL, _page: number): Promise<MangasPage> {
    const manga = await this.getMangaByUrl(url);
    return new MangasPage(manga ? [manga] : [], false);
  }
  /** A query that is a URL goes to getMangasByUrl, everything else to getSearchMangaList. */
  getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (/^https?:\/\//i.test(query.trim())) return this.getMangasByUrl(new URL(query.trim()), page);
    return this.getSearchMangaList(page, query, filters);
  }

  /** Whether filters come from the network; then implement fetchFilterData. The host caches the data for 3 days. */
  get supportsFilterFetching(): boolean {
    return false;
  }
  fetchFilterData(): Promise<unknown> {
    return Promise.resolve(null);
  }
  /** Build filters from previously fetched data (null before the first fetch). Must not do I/O. */
  getFilterList(_data: unknown = null): FilterList {
    return [];
  }

  abstract fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate>;

  getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }
  getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }
  /** WebView home page; kept for fidelity, the reader has no WebView. */
  getHomeUrl(): string {
    return this.baseUrl;
  }

  /** Komikku-only upstream; kept so ports compile, the reader does not ask for related titles. */
  get supportsRelatedMangas(): boolean {
    return false;
  }
  fetchRelatedMangaList(_manga: SManga): Promise<SManga[]> {
    return Promise.resolve([]);
  }

  abstract getPageList(chapter: SChapter): Promise<Page[]>;

  /** For pages that only carry a page URL (HttpSource.getImageUrl); override when a source needs it. */
  getImageUrl(page: Page): Promise<string> {
    throw new Error(`page ${page.index} has no image URL`);
  }
  /** The image request; override to add headers such as a Referer. */
  imageRequest(page: Page): { url: string; headers: Headers } {
    return { url: page.imageUrl!, headers: this.headers };
  }
  /** HttpSource.getImage: the image goes through the client, so its interceptors (cookies, retries) apply too. */
  getImage(page: Page): Promise<Response> {
    const { url, headers } = this.imageRequest(page);
    return this.client.execute({ url, method: "GET", headers });
  }
}
