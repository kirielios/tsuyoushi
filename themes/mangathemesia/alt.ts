// Port of keiyoushi/extensions-source lib-multisrc/mangathemesia/MangaThemesiaAlt.kt
// Sites that prefix manga slugs with a random number that changes: keep a permanent slug, map it back when fetching.
import { MangasPage, SwitchPreferenceCompat, type Document, type PreferenceScreen, type SChapter, type SManga, type SMangaUpdate, trimEnd } from "../../sdk/index.ts";
import { MangaThemesia } from "./base.ts";

export abstract class MangaThemesiaAlt extends MangaThemesia {
  constructor(
    host: ConstructorParameters<typeof MangaThemesia>[0],
    meta: ConstructorParameters<typeof MangaThemesia>[1],
    private readonly randomUrlPrefKey = "pref_auto_random_url",
  ) {
    super(host, meta);
    // the constructor-time cleanup of getPreferencesLazy { ... } upstream
    if (this.preferences.contains("__random_part_cache")) this.preferences.edit().remove("__random_part_cache").apply();
    if (this.preferences.contains("titles_without_random_part")) this.preferences.edit().remove("titles_without_random_part").apply();
  }

  protected get listUrl() {
    return `${this.mangaUrlDirectory}/list-mode/`;
  }
  protected listSelector = "div#content div.soralist ul li a.series";

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = this.randomUrlPrefKey;
    pref.title = this.intl.get("pref_dynamic_url_title");
    pref.summary = this.intl.get("pref_dynamic_url_summary");
    pref.setDefaultValue(true);
    screen.addPreference(pref);
  }

  private getRandomUrlPref() {
    return this.preferences.getBoolean(this.randomUrlPrefKey, true);
  }

  private inFlight: Promise<Map<string, string>> | null = null;
  private cachedValue: Map<string, string> | null = null;
  private fetchTime = 0;

  private async getUrlMapInternal(): Promise<Map<string, string>> {
    if (this.fetchTime + 3_600_000 < Date.now()) this.cachedValue = null; // reset cache
    if (this.cachedValue) return this.cachedValue;
    // the Mutex upstream: concurrent callers share one fetch
    this.inFlight ??= this.fetchUrlMap()
      .then((map) => {
        this.cachedValue = map;
        this.fetchTime = Date.now();
        this.urlMapCache = map;
        return map;
      })
      .finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  protected async fetchUrlMap(): Promise<Map<string, string>> {
    const document = (await this.client.get(`${this.baseUrl}${this.listUrl}`)).asJsoup();
    return new Map(
      document.select(this.listSelector).map((it) => {
        const slug = trimEnd(it.absUrl("href"), "/").split("/").pop() ?? "";
        return [slug.replace(this.slugRegex, ""), slug] as const;
      }),
    );
  }

  protected async getUrlMap(cached = false): Promise<Map<string, string>> {
    return cached && this.cachedValue == null ? this.urlMapCache : this.getUrlMapInternal();
  }

  // cache in preference for webview urls
  private get urlMapCache(): Map<string, string> {
    try {
      return new Map(Object.entries(JSON.parse(this.preferences.getString("url_map_cache", "{}")!) as Record<string, string>));
    } catch {
      return new Map();
    }
  }
  private set urlMapCache(map: Map<string, string>) {
    this.preferences.edit().putString("url_map_cache", JSON.stringify(Object.fromEntries(map))).apply();
  }

  override searchMangaParse(document: Document): MangasPage {
    const mp = super.searchMangaParse(document);
    if (!this.getRandomUrlPref()) return mp;
    return new MangasPage(this.toPermanentMangaUrls(mp.mangas), mp.hasNextPage);
  }

  protected toPermanentMangaUrls(list: SManga[]): SManga[] {
    for (const it of list) {
      const slug = trimEnd(it.url, "/").split("/").pop() ?? "";
      it.url = `${this.mangaUrlDirectory}/${slug.replace(this.slugRegex, "")}/`;
    }
    return list;
  }

  protected slugRegex = /^(\d+-)/;

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (this.getRandomUrlPref()) await this.getUrlMap();
    return super.fetchMangaUpdate(manga, chapters, fetchDetails, fetchChapters);
  }

  override getMangaUrl(manga: SManga): string {
    if (!this.getRandomUrlPref()) return super.getMangaUrl(manga);
    const slug = (trimEnd(manga.url.split("#")[0], "/").split("/").pop() ?? "").replace(this.slugRegex, "");
    const randomSlug = this.cachedValue?.get(slug) ?? slug;
    return `${this.baseUrl}${this.mangaUrlDirectory}/${randomSlug}/`;
  }
}
