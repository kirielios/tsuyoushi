// Port of keiyoushi/extensions-source src/en/asurascans/AsuraScans.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseAs,
  parseHtml,
  toHttpUrl,
  toHttpUrlOrNull,
  toJsonString,
  Response,
  type Chain,
  type ClientBuilder,
  type Document,
  type Filter,
  type Host,
  Canvas,
  imageSize,
  type PreferenceScreen,
  type SChapter,
  type SharedPreferences,
} from "../../../sdk/index.ts";
import {
  applyMangaUrl,
  isLocked,
  mangaToSManga,
  toSChapter,
  toSMangaDetails,
  type AvailableGenres,
  type ChapterListDto,
  type Creators,
  type DataDto,
  type FiltersDto,
  type MangaDetailsDto,
  type MangaDto,
  type MangaUrlDto,
  type PageData,
  type PageDto,
  type PageListDto,
  type PremiumPageListDto,
} from "./dto.ts";
import { CreatorFilter, GenresFilter, MinChaptersFilter, SortFilter, StatusFilter, TypeFilter, isUriFilter } from "./filters.ts";

const PER_PAGE_LIMIT = 20;
const OLD_FORMAT_MANGA_REGEX = /^\/manga\/(\d+-)?([^/]+)\/?$/;
const PREF_HIDE_PREMIUM_CHAPTERS = "pref_hide_premium_chapters";
const SLUG_MAP = "slug_map_v2";
const PAGE_TOKEN_REGEX = /pageToken\*=\*"([^"]+)"/;
const URL_RANDOM_PART = /-[a-z0-9]{8}$/;

export default class AsuraScans extends KeiSource {
  private readonly apiUrl = "https://api.asurascans.com/api";

  private migrated = false;
  protected override get preferences(): SharedPreferences {
    const prefs = super.preferences;
    if (!this.migrated) {
      this.migrated = true;
      for (const key of ["pref_url_map", "pref_base_url_host", "pref_permanent_manga_url_2_en", "pref_slug_map", "pref_dynamic_url", "pref_slug_map_2", "pref_force_high_quality"]) {
        if (prefs.contains(key)) prefs.edit().remove(key).apply();
      }
    }
    return prefs;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor((chain) => scrambledImageInterceptor(this.host, chain)).rateLimit(2, 2_000, (it) => !it.pathname.includes("/covers/"));
  }

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter("popular")));
  }

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter("latest")));
  }

  // ============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/series`).newBuilder();
    url.addQueryParameter("offset", String((page - 1) * PER_PAGE_LIMIT));
    url.addQueryParameter("limit", String(PER_PAGE_LIMIT));
    if (query.trim()) url.addQueryParameter("search", query);
    filters.filter(isUriFilter).forEach((it) => it.addToUri(url));

    const result = (await this.client.get(url.build().toString())).parseAs<DataDto<MangaDto[]>>();
    const mangas = (result.data ?? []).map((it) => mangaToSManga(it, this.baseUrl));
    return new MangasPage(mangas, result.meta!.has_more ?? false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.hostname === new URL(this.baseUrl).hostname && segments[0] === "comics") {
      const slug = segments[1];
      const tmpManga = SManga.create();
      tmpManga.url = `/series/${slug}`;
      tmpManga.memo = { slug };
      return (await this.fetchMangaUpdate(tmpManga, [], true, false)).manga;
    }
    return null;
  }

  // ============================== Details ==============================

  override getMangaUrl(manga: SManga): string {
    let randomSlug = manga.memo["slug"] as string | undefined;
    if (randomSlug == null) {
      const oldSlugMap = parseAs<Record<string, unknown>>(this.preferences.getString(SLUG_MAP, "{}")!);
      const slug = this.getMangaSlug(manga.url);
      const old = oldSlugMap[slug];
      randomSlug = typeof old === "string" ? old : slug;
    }
    return `${this.baseUrl}/comics/${randomSlug}`;
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const url = this.getMangaUrl(manga);
    let response = await this.client.get(url, undefined, { ensureSuccess: false });

    // retry without random suffix, it redirects to new random suffix
    if (!response.isSuccessful) {
      response = await this.client.get(url.replace(URL_RANDOM_PART, ""));
    }

    const document = response.asJsoup();

    const newManga = toSMangaDetails(this.extractAstroProp<MangaDetailsDto>(document, "title", "description"), this.parseBodyFragment);
    applyMangaUrl(this.extractAstroProp<MangaUrlDto>(document, "publicUrl"), newManga, this.baseUrl);
    const randomMangaSlug = newManga.memo["slug"] as string;

    const hidePremium = this.hidePremiumChapters();
    const chapters = (this.extractAstroProp<ChapterListDto>(document, "chapters").chapters ?? []).filter((it) => !(hidePremium && isLocked(it))).map((it) => toSChapter(it, randomMangaSlug));

    return new SMangaUpdate(newManga, chapters);
  }

  private readonly parseBodyFragment = (html: string): Document => parseHtml(this.host.load, html, this.baseUrl);

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return document
      .select("h2:contains(recommended) + div a[href*=/comics/]")
      .map((el) => {
        const slug = toHttpUrlOrNull(el.absUrl("href"))?.pathSegments[1];
        if (slug == null) return null;
        const m = SManga.create();
        m.url = `/series/${slug.replace(URL_RANDOM_PART, "")}`;
        m.memo = { slug };
        const title = el.selectFirst(".mt-2 span")?.ownText();
        if (title == null) return null;
        m.title = title;
        m.thumbnail_url = el.selectFirst("img")?.absUrl("src");
        return m;
      })
      .filter((it) => it != null);
  }

  override getChapterUrl(chapter: SChapter): string {
    const randomSlug = chapter.memo["mangaSlug"] as string | undefined;
    if (randomSlug == null) throw new Error("Refresh Chapter List");
    const number = chapter.url.includes("/chapter/") ? chapter.url.slice(chapter.url.indexOf("/chapter/") + "/chapter/".length) : chapter.url;
    return `${this.baseUrl}/comics/${randomSlug}/chapter/${number}`;
  }

  // =============================== Pages ===============================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = this.getChapterUrl(chapter);

    const response = await this.client.get(url);
    const document = response.asJsoup();
    let pages: PageDto[];
    try {
      pages = this.extractAstroProp<PageListDto>(document, "pages").pages ?? [];
    } catch {
      pages = [];
    }

    if (!pages.length) {
      const accessToken = this.client.cookieJar.loadForRequest(this.baseUrl).find((it) => it.name === "access_token")?.value;
      if (accessToken == null) return [];

      const data = document.selectFirst("script:containsData(pageToken)")?.data();
      const pageToken = (data != null ? PAGE_TOKEN_REGEX.exec(data)?.[1] : undefined) ?? "asura-reader-2026";

      const segments = toHttpUrl(response.url).pathSegments;
      const mangaSlug = segments[1];
      const number = segments[3];
      const premiumUrl = `${this.apiUrl}/series/${mangaSlug}/chapters/${number}`;
      const headers = this.headersBuilder();
      headers.set("Authorization", `Bearer ${accessToken}`);
      headers.set("X-Page-Token", pageToken);

      try {
        pages = (await this.client.get(premiumUrl, headers)).parseAs<PremiumPageListDto>().data.chapter.pages ?? [];
      } catch {
        pages = [];
      }
    }

    return pages.map((pageDto, index) => {
      let imageUrl: string;
      if (pageDto.tiles?.length) {
        const data: PageData = { tiles: pageDto.tiles, tileCols: pageDto.tile_cols ?? 4, tileRows: pageDto.tile_rows ?? 5 };
        imageUrl = toHttpUrl(pageDto.url).newBuilder().fragment(toJsonString(data)).toString();
      } else {
        imageUrl = pageDto.url;
      }
      return new Page(index, "", imageUrl);
    });
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const [genres, creators] = await Promise.all([
      this.client.get(`${this.baseUrl}/browse`).then((it) => this.extractAstroProp<AvailableGenres>(it.asJsoup(), "availableGenres").availableGenres),
      this.client.get(`${this.apiUrl}/creators`).then((it) => it.parseAs<DataDto<Creators>>().data!),
    ]);
    const dto: FiltersDto = { genres, authors: creators.authors, artists: creators.artists };
    return dto;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new SortFilter(), new StatusFilter(), new TypeFilter()];
    if (data != null) {
      const dto = data as FiltersDto;
      filters.push(new GenresFilter(dto.genres));
      filters.push(new CreatorFilter(dto.authors, dto.artists));
    }
    filters.push(new MinChaptersFilter());
    return filters;
  }

  // ============================= Utilities =============================

  private getMangaSlug(url: string): string {
    const after = (d: string) => {
      const s = url.slice(url.indexOf(d) + d.length);
      const i = s.indexOf("/");
      return i < 0 ? s : s.slice(0, i);
    };
    if (url.includes("/series/")) return after("/series/");
    if (url.includes("/comics/")) return after("/comics/");
    if (url.includes("/manga/")) return OLD_FORMAT_MANGA_REGEX.exec(url)?.[2] ?? after("/manga/");
    return url.replace(/^\/+|\/+$/g, "");
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_PREMIUM_CHAPTERS;
    p.title = "Hide premium chapters";
    p.summary = "Hides the chapters that require a subscription to view";
    p.setDefaultValue(true);
    screen.addPreference(p);
  }

  private hidePremiumChapters(): boolean {
    return this.preferences.getBoolean(PREF_HIDE_PREMIUM_CHAPTERS, true);
  }

  private extractAstroProp<T>(document: Document, ...key: string[]): T {
    const selector = key.map((it) => `[props*=${it}]`).join("");
    const prop = document.selectFirst(selector)?.attr("props");
    if (prop == null) throw new Error(`Unable to find prop with [${key.join(", ")}]`);
    const json = parseAs<unknown>(prop);
    return unwrapAstro(json) as T;
  }
}

function isIntPrimitive(v: unknown) {
  return (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && /^[+-]?\d+$/.test(v));
}

function unwrapAstro(json: unknown): unknown {
  if (Array.isArray(json)) {
    if (!json.length) return null;
    if (json.length === 1 && isIntPrimitive(json[0])) return null;
    if (json.length === 2 && isIntPrimitive(json[0])) return unwrapAstro(json[1]);
    return json.map(unwrapAstro);
  }
  if (json !== null && typeof json === "object") return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, unwrapAstro(v)]));
  return json;
}

async function scrambledImageInterceptor(host: Host, chain: Chain): Promise<Response> {
  const request = chain.request();
  const response = await chain.proceed(request);
  const hash = new URL(request.url).hash;
  if (!hash) return response;
  const fragment = decodeURIComponent(hash.slice(1));
  if (!fragment.startsWith("{")) return response;

  const pageData = parseAs<PageData>(fragment);
  const body = await descramble(host, response.bytes(), pageData);
  return new Response(host, { status: response.code, url: response.url, headers: { "content-type": "image/webp" }, body });
}

async function descramble(host: Host, bytes: Uint8Array, pageData: PageData): Promise<Uint8Array> {
  const source = await imageSize(host, bytes).catch(() => {
    throw new Error("Failed to decode image");
  });

  const tileW = Math.trunc(source.width / pageData.tileCols);
  const tileH = Math.trunc(source.height / pageData.tileRows);

  const canvas = new Canvas(host, tileW * pageData.tileCols, tileH * pageData.tileRows);

  pageData.tiles.forEach((j, w) => {
    const srcCol = w % pageData.tileCols;
    const srcRow = Math.trunc(w / pageData.tileCols);
    const dstCol = j % pageData.tileCols;
    const dstRow = Math.trunc(j / pageData.tileCols);
    canvas.drawImage(bytes, srcCol * tileW, srcRow * tileH, tileW, tileH, dstCol * tileW, dstRow * tileH);
  });

  return canvas.encode("webp", 100);
}
