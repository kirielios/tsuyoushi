// Port of keiyoushi/extensions-source src/en/webdexscans/WebdexScans.kt
import {
  CheckBoxPreference,
  KeiSource,
  MangasPage,
  Page,
  SMangaUpdate,
  firstInstanceOrNull,
  FilterList,
  toHttpUrl,
  type PreferenceScreen,
  type SChapter,
  type SManga,
  type Response,
} from "../../../sdk/index.ts";
import { chapterInfoToSChapter, isPremium, searchSeriesToSManga, seriesInfoToSManga, seriesSlugOf, toAbsoluteUrl, updateSeriesSlug, type ChapterInfo, type PageInfo, type SearchSeriesDto, type SeriesInfo } from "./dto.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

const PREF_SHOW_PREMIUM = "pref_show_premium";

export default class WebdexScans extends KeiSource {
  private readonly supabaseUrl = "https://nrqghtbdrdnoywxjkgkf.supabase.co/rest/v1";
  private readonly supabaseApiKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycWdodGJkcmRub3l3eGprZ2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Njg4NDEsImV4cCI6MjA5MjQ0NDg0MX0.Gnrn33_LMxFA9m_OdCpybBZ-Cjcc5rdsJlD8Y9eOICg";

  private get supabaseHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("apikey", this.supabaseApiKey);
    h.append("authorization", `Bearer ${this.supabaseApiKey}`);
    h.append("Accept", "application/json");
    return h;
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const offset = (page - 1) * 24;
    const url = toHttpUrl(`${this.supabaseUrl}/series`)
      .newBuilder()
      .addQueryParameter("select", "id,title,slug,cover_url")
      .addQueryParameter("order", "view_count.desc")
      .addQueryParameter("offset", String(offset))
      .addQueryParameter("limit", "24")
      .build();

    return this.mangaListParse(await this.client.get(url.toString(), this.supabaseHeaders));
  }

  private mangaListParse(response: Response): MangasPage {
    const mangaList = response.parseAs<SearchSeriesDto[]>().map((it) => searchSeriesToSManga(it, this.baseUrl));
    return new MangasPage(mangaList, mangaList.length === 24);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const offset = (page - 1) * 24;
    const url = toHttpUrl(`${this.supabaseUrl}/series`)
      .newBuilder()
      .addQueryParameter("select", "id,title,slug,cover_url")
      .addQueryParameter("order", "updated_at.desc")
      .addQueryParameter("offset", String(offset))
      .addQueryParameter("limit", "24")
      .build();

    return this.mangaListParse(await this.client.get(url.toString(), this.supabaseHeaders));
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const offset = (page - 1) * 24;
    const url = toHttpUrl(`${this.supabaseUrl}/series`).newBuilder();

    const genreSlug = firstInstanceOrNull(filters, GenreFilter)?.selected;
    if (genreSlug != null) {
      url.addQueryParameter("select", "id,title,slug,cover_url,genres!inner(slug)");
      url.addQueryParameter("genres.slug", `eq.${genreSlug}`);
    } else {
      url.addQueryParameter("select", "id,title,slug,cover_url");
    }

    if (query.length > 0) {
      url.addQueryParameter("title", `ilike.%${query}%`);
    }

    const type = firstInstanceOrNull(filters, TypeFilter)?.selected;
    if (type != null) url.addQueryParameter("type", `eq.${type}`);

    const status = firstInstanceOrNull(filters, StatusFilter)?.selected;
    if (status != null) url.addQueryParameter("status", `eq.${status}`);

    switch (firstInstanceOrNull(filters, SortFilter)?.selected ?? null) {
      case "popular":
        url.addQueryParameter("order", "view_count.desc");
        break;
      case "rating":
        url.addQueryParameter("order", "rating.desc");
        break;
      case "a-z":
        url.addQueryParameter("order", "title.asc");
        break;
      case "latest":
      case null:
        url.addQueryParameter("order", "updated_at.desc");
        break;
    }

    url.addQueryParameter("offset", String(offset));
    url.addQueryParameter("limit", "24");

    return this.mangaListParse(await this.client.get(url.build().toString(), this.supabaseHeaders));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (url.hostname !== new URL(this.baseUrl).hostname || segments[0] !== "series") {
      return null;
    }

    const slug = segments[1];
    if (slug === undefined) return null;
    const apiUrl = toHttpUrl(`${this.supabaseUrl}/series`).newBuilder().addQueryParameter("slug", `eq.${slug}`).addQueryParameter("select", "*,genres(name)").build();

    const series = (await this.client.get(apiUrl.toString(), this.supabaseHeaders)).parseAs<SeriesInfo[]>()[0];
    if (!series) return null;
    return seriesInfoToSManga(series, this.baseUrl, this.host);
  }

  // ============================= Utilities =============================

  override getMangaUrl(manga: SManga): string {
    const slug = manga.memo["slug"];
    if (typeof slug !== "string") throw new Error("Series slug missing (try refreshing)");
    return `${this.baseUrl}/series/${slug}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const seriesSlug = chapter.memo["seriesSlug"];
    if (typeof seriesSlug !== "string") throw new Error("Chapter missing series slug (try refreshing)");
    const chapterSlug = chapter.memo["slug"];
    if (typeof chapterSlug !== "string") throw new Error("Chapter slug missing (try refreshing)");
    return `${this.baseUrl}/series/${seriesSlug}/${chapterSlug}`;
  }

  // ============================== Updates ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const seriesDeferred = fetchDetails
      ? (async () => {
          const url = toHttpUrl(`${this.supabaseUrl}/series`).newBuilder().addQueryParameter("id", `eq.${manga.url}`).addQueryParameter("select", "*,genres(name)").build();
          return (await this.client.get(url.toString(), this.supabaseHeaders)).parseAs<SeriesInfo[]>()[0];
        })()
      : null;

    const chaptersDeferred = fetchChapters
      ? (async () => {
          const url = toHttpUrl(`${this.supabaseUrl}/chapters`)
            .newBuilder()
            .addQueryParameter("series_id", `eq.${manga.url}`)
            .addQueryParameter("select", "id,chapter_number,title,slug,created_at,is_premium,free_at,series(slug)")
            .addQueryParameter("order", "chapter_number.desc")
            .build();
          return (await this.client.get(url.toString(), this.supabaseHeaders)).parseAs<ChapterInfo[]>();
        })()
      : null;

    const [series, chapterInfos] = await Promise.all([seriesDeferred, chaptersDeferred]);

    const memoSlug = manga.memo["slug"];
    const seriesSlug = series?.slug ?? (chapterInfos?.[0] ? seriesSlugOf(chapterInfos[0]) : undefined) ?? (typeof memoSlug === "string" ? memoSlug : undefined);
    if (seriesSlug === undefined) throw new Error("Failed to resolve series slug (try refreshing)");

    const newManga = series ? seriesInfoToSManga(series, this.baseUrl, this.host) : manga;
    updateSeriesSlug(newManga, seriesSlug);

    let updatedChapters: SChapter[];
    if (fetchChapters && chapterInfos != null) {
      const showPremium = this.preferences.getBoolean(PREF_SHOW_PREMIUM, false);
      const filtered = showPremium ? chapterInfos : chapterInfos.filter((it) => !isPremium(it));
      updatedChapters = filtered.map((it) => chapterInfoToSChapter(it, seriesSlug));
    } else {
      updatedChapters = chapters;
    }

    return new SMangaUpdate(newManga, updatedChapters);
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const isLocked = chapter.memo["isLocked"] === true;
    if (isLocked) {
      return [];
    }

    const url = toHttpUrl(`${this.supabaseUrl}/pages`)
      .newBuilder()
      .addQueryParameter("chapter_id", `eq.${chapter.url}`)
      .addQueryParameter("select", "image_url,page_number")
      .addQueryParameter("order", "page_number.asc")
      .build();

    const pages = (await this.client.get(url.toString(), this.supabaseHeaders)).parseAs<PageInfo[]>();
    return pages.map((page, i) => new Page(i, "", toAbsoluteUrl(page.image_url, this.baseUrl)));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new GenreFilter(), new TypeFilter(), new StatusFilter(), new SortFilter());
  }

  // ============================ Preferences ============================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new CheckBoxPreference(screen.context);
    pref.key = PREF_SHOW_PREMIUM;
    pref.title = "Show premium chapters";
    pref.summary = "Include chapters that require coins to read";
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }
}
