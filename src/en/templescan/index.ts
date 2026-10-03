// Port of keiyoushi/extensions-source src/en/templescan/TempleScan.kt
import {
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  extractNextJs,
  firstInstanceOrNull,
  hasKeys,
  parseAs,
  substringAfterLast,
  type ClientBuilder,
  type Document,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import {
  browseSeriesToSManga,
  chapterCreated,
  isSeries,
  seriesChapters,
  seriesCreated,
  seriesSlug,
  seriesTitle,
  seriesUpdated,
  seriesViews,
  type BrowseSeries,
  type ComicSeriesLd,
  type PagesList,
  type SeriesDataWrapper,
} from "./dto.ts";
import { OrderFilter, StatusFilter, getFilters } from "./filters.ts";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const PREF_HIDE_LOCKED_CHAPTERS = "pref_hide_locked_chapters";

export default class TempleScan extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(1);
  }

  protected override configureHeaders(headers: Headers): Headers {
    // Cloudflare rejects the app's default User-Agent (both for pages and for the image CDN),
    // so a full browser fingerprint is required.
    headers.set("User-Agent", USER_AGENT);
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
    headers.set("Accept-Language", "en-US,en;q=0.9");
    headers.set("Sec-Fetch-Dest", "document");
    headers.set("Sec-Fetch-Mode", "navigate");
    headers.set("Sec-Fetch-Site", "none");
    headers.set("Upgrade-Insecure-Requests", "1");
    return headers;
  }

  getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", OrderFilter.POPULAR);
  }

  getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", OrderFilter.LATEST);
  }

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const catalog = await this.fetchCatalog();
    return this.parseDirectory(catalog, query, filters);
  }

  private parseDirectory(series: BrowseSeries[], query: string, filters: FilterList): MangasPage {
    const status = firstInstanceOrNull(filters, StatusFilter)?.selected ?? null;
    let mangaList = series.filter((series) => {
      const queryFilter = !query.trim() || seriesTitle(series).toLowerCase().includes(query.toLowerCase()) || series.alternative_names?.toLowerCase().includes(query.toLowerCase()) === true;

      const statusFilter = status == null || series.status === status;

      return queryFilter && statusFilter;
    });

    const order = firstInstanceOrNull(filters, OrderFilter)?.selected;
    // sortedByDescending is stable, like Array.prototype.sort
    switch (order) {
      case "updated":
        mangaList = [...mangaList].sort((a, b) => seriesUpdated(b) - seriesUpdated(a));
        break;
      case "created":
        mangaList = [...mangaList].sort((a, b) => seriesCreated(b) - seriesCreated(a));
        break;
      case "views":
        mangaList = [...mangaList].sort((a, b) => seriesViews(b) - seriesViews(a));
        break;
    }

    return new MangasPage(
      mangaList.map((it) => browseSeriesToSManga(it)),
      false,
    );
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (url.hostname !== new URL(this.baseUrl).hostname || pathSegments[0] !== "comic") return null;

    const mangaUrl = `/comic/${pathSegments[1]}`;
    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  // =========================== Manga Updates ============================

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringAfterLast(manga.url, "/");
    const response = await this.client.get(`${this.baseUrl}/comic/${slug}`);
    const document = response.asJsoup();

    const series = this.jsonLd(document, isSeries);
    const seriesData = extractNextJs<SeriesDataWrapper>(response, hasKeys("seriesData"))?.seriesData;
    // The status only lives in the browse catalog; the detail page renders it without a stable hook.
    const catalogEntry = (await this.fetchCatalog()).find((it) => seriesSlug(it) === slug);

    const genres = series?.genre ?? [];
    const adult = genres.some((it) => it.toLowerCase() === "+18");

    const result = SManga.create();
    result.url = `/comic/${slug}`;
    result.title = series?.name ?? (catalogEntry ? seriesTitle(catalogEntry) : undefined) ?? slug;
    result.thumbnail_url = series?.image ?? catalogEntry?.thumbnail ?? undefined;
    result.author = series?.author?.name ?? undefined;
    switch (catalogEntry?.status?.toLowerCase()) {
      case "ongoing":
        result.status = SManga.ONGOING;
        break;
      case "hiatus":
        result.status = SManga.ON_HIATUS;
        break;
      case "completed":
        result.status = SManga.COMPLETED;
        break;
      case "canceled":
      case "dropped":
        result.status = SManga.CANCELLED;
        break;
      default:
        result.status = SManga.UNKNOWN;
    }
    const genreList: string[] = [];
    if (catalogEntry?.badge != null) genreList.push(catalogEntry.badge);
    if (adult) genreList.push("Adult");
    genreList.push(...genres.filter((it) => it.toLowerCase() !== "+18"));
    result.genre = genreList.join(", ");
    let description = this.synopsis(document) ?? series?.description ?? "";
    const alternateName = series?.alternateName;
    if (alternateName?.trim()) description += `\n\nAlternative Name: ${alternateName}`;
    result.description = description;

    const hideLocked = this.preferences.getBoolean(PREF_HIDE_LOCKED_CHAPTERS, true);
    const chapterList = (seriesData ? seriesChapters(seriesData) : [])
      .filter((it) => !hideLocked || (it.ivo8tc ?? 0) <= 0)
      .map((chapter) => {
        const c = SChapter.create();
        c.url = `/comic/${slug}/${chapter.m1shekt}`;
        let name = "";
        if ((chapter.ivo8tc ?? 0) > 0) name += "🔒 ";
        name += chapter.c27b2ow;
        if (chapter.chapter_title?.trim()) name += `: ${chapter.chapter_title}`;
        c.name = name;
        c.date_upload = chapterCreated(chapter);
        return c;
      });

    return new SMangaUpdate(result, chapterList);
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const data = extractNextJs<PagesList>(await this.client.get(this.baseUrl + chapter.url), hasKeys("xdmo0k"));
    if (!data) return [];
    return data.xdmo0k.map((url, idx) => new Page(idx, "", url));
  }

  // ============================ Preferences =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_LOCKED_CHAPTERS;
    p.title = "Hide locked chapters";
    p.summary = "Hide early access chapters that require a subscription. If disabled, they are shown with a 🔒 prefix but stay unreadable without a subscription.";
    p.setDefaultValue(true);
    screen.addPreference(p);
  }

  // ============================= Utilities ==============================

  private async fetchCatalog(): Promise<BrowseSeries[]> {
    // List<BrowseSeries>: an array whose first element is an object with the required keys (title, slug)
    return (
      extractNextJs<BrowseSeries[]>(await this.client.get(`${this.baseUrl}/comics`), (it) => {
        return Array.isArray(it) && it.length > 0 && typeof it[0] === "object" && it[0] !== null && "jdp5hu" in it[0] && "m15392f" in it[0];
      }) ?? []
    );
  }

  private jsonLd(document: Document, predicate: (t: ComicSeriesLd) => boolean): ComicSeriesLd | null {
    for (const it of document.select("script[type=application/ld+json]")) {
      let parsed: ComicSeriesLd;
      try {
        parsed = parseAs<ComicSeriesLd>(it.data());
      } catch {
        continue;
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && predicate(parsed)) return parsed;
    }
    return null;
  }

  private synopsis(document: Document): string | null {
    const element = document.selectFirst("#series-synopsis-text");
    if (!element) return null;
    const ps = element.select("p");
    const text = ps.length > 0 ? ps.map((it) => it.text()).join("\n\n") : element.text();
    return text.trim() ? text : null;
  }
}
