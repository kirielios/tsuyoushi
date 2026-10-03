// Port of keiyoushi/extensions-source src/all/onisaga/OniSaga.kt (+ Dto.kt)
import {
  ClientBuilder,
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  distinctBy,
  firstInstanceOrNull,
  parseHtml,
  substringAfterLast,
  substringBefore,
  substringBeforeLast,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type Document,
  type Element,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import {
  GenreFilter,
  GenreTriState,
  GroupFilter,
  MinChaptersFilter,
  ReleaseEndFilter,
  ReleaseStartFilter,
  SortFilter,
  StatusFilter,
  TypeFilter,
  genreList,
} from "./filters.ts";

// ================================== Dto.kt ===================================
interface LivewireCall {
  type: string;
  path: string;
  method: string;
  params: string[];
}
/** LivewireCall(method = ...) with its defaults; livewireJson has encodeDefaults = true. */
const livewireCall = (method: string, params: string[] = []): LivewireCall => ({ type: "call", path: "", method, params });

interface LivewireResponse {
  components?: { effects?: { html?: string | null }; snapshot?: string }[];
}

/** PostFilterUpdatesDto: every field is sent (encodeDefaults = true, nulls included). */
interface PostFilterUpdatesDto {
  platform: string;
  status: string;
  sort: string;
  min_chapters: string;
  group: string | null;
  release_start: string | null;
  release_end: string | null;
  genre: string[];
  excludeGenre: string[];
}
const postFilterUpdates = (o: Partial<PostFilterUpdatesDto> = {}): PostFilterUpdatesDto => ({
  platform: o.platform ?? "",
  status: o.status ?? "",
  sort: o.sort ?? "created_at",
  min_chapters: o.min_chapters ?? "",
  group: o.group ?? null,
  release_start: o.release_start ?? null,
  release_end: o.release_end ?? null,
  genre: o.genre ?? [],
  excludeGenre: o.excludeGenre ?? [],
});

interface PageApiResponse {
  url?: string | null;
  order?: number | null;
  message?: string | null;
}

class LivewireState {
  constructor(
    readonly snapshot: string,
    readonly token: string,
  ) {}
}

// ================================= Constants =================================
const PREF_NSFW_KEY = "pref_nsfw";
const PREF_TYPE_KEY = "pref_type";
const PREF_STATUS_KEY = "pref_status";
const PREF_EXCLUDE_GENRE = "pref_exclude_genre";
const PREF_EXCLUDE_GENRE_ADULT = "pref_exclude_genre_adult";
const PREF_RATE_LIMIT_KEY = "pref_rate_limit";

const READER_TOKEN_REGEX = /readerToken["']?\s*:\s*["']([^"']+)["']/;
const PAGE_ORDER_REGEX = /["']?order["']?\s*:\s*(\d+)/g;
const CHAPTER_NUMBER_REGEX = /Chapter\s+([\d.]+)/;
const RELATIVE_DATE_REGEX = /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/;
const ORIGIN_REGEX = /(Japanese|Korean|Chinese|English)/i;
const YEAR_REGEX = /^\d{4}$/;
const RATING_REGEX = /(\d)\.0(?=[/ ])/g;
const INTERPUNCT_REGEX = /\s*·\s*/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toFloatOrNull = (s: string | undefined) => (s != null && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null);

/** Element.closest(css) */
function closest(el: Element, css: string): Element | null {
  for (let e: Element | null = el; e != null && e.tagName(); e = e.parent()) if (e.is(css)) return e;
  return null;
}
/** Element.parents(): ancestors, nearest first */
function parents(el: Element): Element[] {
  const out: Element[] = [];
  for (let e = el.parent(); e != null && e.tagName(); e = e.parent()) out.push(e);
  return out;
}

export default class OniSaga extends KeiSource {
  // Returns the uppercase language code required by the Livewire updates payload
  private get langCode(): string | null {
    switch (this.lang) {
      case "en":
        return "EN";
      case "fr":
        return "FR";
      case "ja":
        return "JA";
      case "pt-BR":
        return "PT-BR";
      case "pt":
        return "PT";
      case "es-419":
        return "ES-LA";
      case "es":
        return "ES";
      default:
        return null;
    }
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(4);
  }

  private cachedStateUrl: string | null = null;
  private cachedState: LivewireState | null = null;

  /** kotlinx Mutex apiLock */
  private apiLockTail: Promise<unknown> = Promise.resolve();
  private withApiLock<T>(block: () => Promise<T>): Promise<T> {
    const run = this.apiLockTail.then(block);
    this.apiLockTail = run.catch(() => undefined);
    return run;
  }

  private lastRequestTime = 0;

  private buildLivewireHeaders(referer: string): Headers {
    const h = this.headersBuilder();
    h.set("X-Livewire", "");
    h.set("Accept", "application/json");
    h.set("X-Requested-With", "XMLHttpRequest");
    h.set("Origin", this.baseUrl);
    h.set("Referer", referer);
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  // =============================== Popular Manga ===============================

  override getPopularManga(page: number): Promise<MangasPage> {
    const updates = postFilterUpdates({ platform: this.typePref(), status: this.statusPref(), sort: "view" });
    return this.fetchMangaLivewirePage(`${this.baseUrl}/browse`, page, updates);
  }

  // ================================ Latest Manga ================================

  override getLatestUpdates(page: number): Promise<MangasPage> {
    const updates = postFilterUpdates({ platform: this.typePref(), status: this.statusPref() });
    return this.fetchMangaLivewirePage(`${this.baseUrl}/browse`, page, updates);
  }

  // ========================= Livewire Pagination Logic ==========================

  private async fetchMangaLivewirePage(url: string, page: number, updates: PostFilterUpdatesDto | null = null): Promise<MangasPage> {
    const prefExcluded = this.excludedGenresPref();

    let state: LivewireState;
    if (this.cachedStateUrl === url && this.cachedState != null) {
      state = this.cachedState;
    } else {
      const doc = (await this.client.get(url)).asJsoup();

      if (page === 1 && updates == null && !prefExcluded.length) return this.parseMangaList(doc);

      const newState = this.extractLivewireState(doc, "post-filter");
      if (newState == null) throw new Error("Could not find Livewire state for pagination");

      this.cachedStateUrl = url;
      this.cachedState = newState;
      state = newState;
    }

    const effectiveUpdates = updates ?? postFilterUpdates();
    if (prefExcluded.length) effectiveUpdates.excludeGenre = [...new Set([...effectiveUpdates.excludeGenre, ...prefExcluded])];

    const request = {
      _token: state.token,
      components: [{ snapshot: state.snapshot, updates: effectiveUpdates, calls: [livewireCall("gotoPage", [String(page)])] }],
    };

    const dto = (await this.client.post(`${this.baseUrl}/livewire/update`, this.buildLivewireHeaders(substringBefore(url, "?")), JSON.stringify(request))).parseAs<LivewireResponse>();

    const newSnapshot = dto.components?.[0]?.snapshot;
    if (newSnapshot != null) this.cachedState = new LivewireState(newSnapshot, state.token);

    const html = dto.components?.[0]?.effects?.html ?? "";

    return this.parseMangaList(parseHtml(this.host.load, html, this.baseUrl));
  }

  private parseMangaList(doc: Document): MangasPage {
    const showNsfw = this.preferences.getBoolean(PREF_NSFW_KEY, false);
    const mangas = doc
      .select("div.relative.group")
      .map((it) => this.toSManga(it, showNsfw))
      .filter((it): it is SManga => it != null);

    const hasNextPage = doc.select("[wire:click*=nextPage]").some((it) => !it.hasAttr("disabled"));

    return new MangasPage(mangas, hasNextPage);
  }

  // =================================== Search ===================================

  override getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = query.trim() ? HttpUrl.parse(this.baseUrl).newBuilder().addPathSegment("search").addPathSegment(query).build().toString() : `${this.baseUrl}/browse`;
    const updates = this.buildUpdatesFromFilters(filters);
    return this.fetchMangaLivewirePage(url, page, updates);
  }

  private buildUpdatesFromFilters(filters: FilterList): PostFilterUpdatesDto | null {
    const typeFilter = firstInstanceOrNull(filters, TypeFilter);
    const statusFilter = firstInstanceOrNull(filters, StatusFilter);
    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const minChaptersFilter = firstInstanceOrNull(filters, MinChaptersFilter);
    const groupFilter = firstInstanceOrNull(filters, GroupFilter);
    const releaseStartFilter = firstInstanceOrNull(filters, ReleaseStartFilter);
    const releaseEndFilter = firstInstanceOrNull(filters, ReleaseEndFilter);

    const genreFilter = firstInstanceOrNull(filters, GenreFilter);
    const includeGenres = (genreFilter?.state ?? []).filter((it) => it.state === Filter.TriState.STATE_INCLUDE).map((it) => it.id);
    const excludeGenres = (genreFilter?.state ?? []).filter((it) => it.state === Filter.TriState.STATE_EXCLUDE).map((it) => it.id);

    const dto = postFilterUpdates({
      platform: typeFilter?.toUriPart() ?? "",
      status: statusFilter?.toUriPart() ?? "",
      sort: sortFilter?.toUriPart() ?? "created_at",
      min_chapters: minChaptersFilter?.toUriPart() ?? "",
      group: groupFilter?.state?.trim() || null,
      release_start: releaseStartFilter?.state?.trim() || null,
      release_end: releaseEndFilter?.state?.trim() || null,
      genre: includeGenres,
      excludeGenre: excludeGenres,
    });

    const isDefault =
      !dto.platform &&
      !dto.status &&
      dto.sort === "created_at" &&
      !dto.min_chapters &&
      dto.group == null &&
      dto.release_start == null &&
      dto.release_end == null &&
      !dto.genre.length &&
      !dto.excludeGenre.length;
    return isDefault ? null : dto;
  }

  // ================================== Filters ===================================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new TypeFilter(),
      new GenreFilter(genreList.map((it) => new GenreTriState(it[0], it[1]))),
      new StatusFilter(),
      new MinChaptersFilter(),
      new GroupFilter(),
      new ReleaseStartFilter(),
      new ReleaseEndFilter(),
      new SortFilter(),
    );
  }

  // =============================== Manga Details ===============================

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const url = this.getMangaUrl(manga);
    const doc = (await this.client.get(url)).asJsoup();

    const details = this.mangaDetailsParse(doc);
    const chapterList = fetchChapters ? await this.fetchChapterList(doc) : chapters;

    return new SMangaUpdate(details, chapterList);
  }

  private mangaDetailsParse(doc: Document): SManga {
    const nsfwSpan = doc.selectFirst("span:containsOwn(18+)");
    if (nsfwSpan) closest(nsfwSpan, "div.absolute.inset-0.z-20")?.remove();

    const badgeRow = doc.selectFirst("div.flex.items-center.gap-2.justify-center.mb-2");

    const bannerImg = doc.selectFirst("img.absolute");
    let bannerUrl = bannerImg ? this.resolveImageUrl(bannerImg) : null;

    const slug = HttpUrl.parse(doc.location())
      .pathSegments.filter((it) => it.trim())
      .at(-1);

    const manga = SManga.create();
    const title = doc.selectFirst("h1")?.text() ?? doc.selectFirst("[data-flux-heading]")?.text();
    if (title == null) throw new Error("Could not find manga title");
    manga.title = title;

    const thumb = doc.selectFirst(".w-32 > picture:nth-child(1) > img:nth-child(3)");
    manga.thumbnail_url = (thumb ? this.resolveImageUrl(thumb) : null) ?? undefined;

    // If banner and cover are the same, do not display banner
    if (bannerUrl == (manga.thumbnail_url ?? null)) bannerUrl = null;

    manga.memo = slug != null ? { slug } : {};

    const infoSection = doc.selectFirst("div.flex.flex-col.md\\:flex-row");

    manga.author = infoSection
      ?.select('a[href*="/author/"]')
      .map((it) => it.text())
      .join(", ");

    {
      let genre = "";
      const types = (badgeRow?.select("div[data-flux-badge]") ?? [])
        .map((badge) => {
          const text = badge.text().toLowerCase();
          return ["manga", "manhwa", "manhua", "shounen", "seinen", "shoujo", "josei"].includes(text) ? text.charAt(0).toUpperCase() + text.slice(1) : null;
        })
        .filter((it) => it != null);
      genre += types.join(", ");

      const tags = (infoSection?.select('a[href*="/genre/"]') ?? []).map((it) => it.text());
      if (tags.length) {
        if (genre) genre += ", ";
        genre += tags.join(", ");
      }
      manga.genre = genre;
    }

    manga.status = this.parseStatus(doc);

    {
      let description = "";
      const meta: string[] = [];

      const status = badgeRow?.selectFirst("span:has(> span.size-1\\.5)")?.text();
      if (status != null) meta.push(`**Status:** ${status}`);

      const origin = badgeRow?.select("span").find((it) => ORIGIN_REGEX.test(it.text()))?.text();
      if (origin != null) meta.push(`**Origin:** ${origin}`);

      const year = badgeRow?.select("span").find((it) => YEAR_REGEX.test(it.text()))?.text();
      if (year != null) meta.push(`**Year:** ${year}`);

      const rating = doc.selectFirst("span.text-xs:matchesOwn(^\\d+\\.\\d+)")?.text();
      if (rating != null) meta.push(`**Rating:** ${rating.replace(RATING_REGEX, "$1")}`);

      const trackers: string[] = [];
      const anilist = doc.selectFirst('a[href*="anilist.co"]');
      if (anilist) trackers.push(`[AniList](${anilist.attr("abs:href")})`);
      const mal = doc.selectFirst('a[href*="myanimelist.net"]');
      if (mal) trackers.push(`[MAL](${mal.attr("abs:href")})`);
      if (trackers.length) meta.push(`**Trackers:** ${trackers.join(" | ")}`);

      if (meta.length) {
        description += meta.join(" | ");
        description += "\n\n---\n\n";
      }

      const synopsis = doc.selectFirst("p.leading-relaxed")?.text();
      if (synopsis != null) description += synopsis;

      const altText = doc.selectFirst('p[class*="text-[13px]"]')?.text();
      if (altText) {
        const altTitles = altText.split(INTERPUNCT_REGEX).filter((it) => it);
        if (altTitles.length) {
          description += "\n\n**Alternative Titles:**\n";
          for (const t of altTitles) description += `- ${t}\n`;
        }
      }

      if (bannerUrl && bannerUrl.trim()) description += `\n\n![Banner](${bannerUrl})`;
      manga.description = description;
    }
    return manga;
  }

  private parseStatus(doc: Document): number {
    const statusText = (doc.selectFirst("span:has(> span.size-1\\.5)")?.text() ?? doc.selectFirst("span.inline-flex:matchesOwn(Completed|Ongoing|Hiatus|Cancelled)")?.text())?.toLowerCase();
    if (statusText == null) return SManga.UNKNOWN;

    if (statusText.includes("ongoing") || statusText.includes("releasing")) return SManga.ONGOING;
    if (statusText.includes("completed")) return SManga.COMPLETED;
    if (statusText.includes("hiatus")) return SManga.ON_HIATUS;
    if (statusText.includes("cancelled") || statusText.includes("dropped")) return SManga.CANCELLED;
    return SManga.UNKNOWN;
  }

  private resolveImageUrl(img: Element): string | null {
    const src = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src");
    if (!src || src.startsWith("data:")) return null;
    return HttpUrl.parse(this.baseUrl).resolve(src)?.toString() ?? null;
  }

  private toSManga(el: Element, showNsfw: boolean): SManga | null {
    const nsfwSpan = el.selectFirst("span:containsOwn(18+)");
    if (nsfwSpan != null && !showNsfw) return null;
    if (nsfwSpan) closest(nsfwSpan, "div.absolute.inset-0.z-20")?.remove();

    const linkEl = el.tagName() === "a" ? el : el.selectFirst('a[href*="/manga/"]');
    if (linkEl == null) return null;

    const href = linkEl.absUrl("href");
    const httpUrl = toHttpUrlOrNull(href);
    if (httpUrl == null) return null;
    const pathSegments = httpUrl.pathSegments.filter((it) => it.trim());
    if (pathSegments[0]?.toLowerCase() !== "manga" || pathSegments.length < 2) return null;

    const slug = pathSegments[1];

    const titleEl = el.selectFirst("div[data-flux-heading], h3, h4") ?? el.selectFirst("a[title]") ?? linkEl;
    const currentTitle = titleEl.attr("title") || titleEl.text();
    if (!currentTitle) return null;

    const altImg = el.selectFirst("img[alt]:not([alt=''])");
    const anyImg = el.selectFirst("img");
    const currentThumb = (altImg ? this.resolveImageUrl(altImg) : null) ?? (anyImg ? this.resolveImageUrl(anyImg) : null);

    const manga = SManga.create();
    manga.title = currentTitle;
    manga.thumbnail_url = currentThumb ?? undefined;
    manga.url = urlWithoutDomain(href);
    manga.memo = { slug };
    return manga;
  }

  // =============================== Related Manga ===============================

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const doc = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    return this.relatedMangaListParse(doc);
  }

  private relatedMangaListParse(doc: Document): SManga[] {
    const currentUrl = HttpUrl.parse(doc.location()).encodedPath;
    const showNsfw = this.preferences.getBoolean(PREF_NSFW_KEY, false);

    const heading = doc.select("div[data-flux-heading], h3, h2").find((it) => {
      const text = it.text().toLowerCase();
      return text.includes("recommended") || text.includes("related") || text.includes("you may also like");
    });
    if (heading == null) return [];

    const section = parents(heading).find((it) => it.select("div.relative.group, a[href*='/manga/']").length > 1);
    if (section == null) return [];

    return distinctBy(
      section
        .select("div.relative.group, a[href*='/manga/']:has(img)")
        .map((it) => this.toSManga(it, showNsfw))
        .filter((it): it is SManga => it != null)
        .filter((it) => it.url !== currentUrl),
      (it) => it.url,
    );
  }

  // ================================= Chapters ==================================

  private async fetchChapterList(doc: Document): Promise<SChapter[]> {
    const nsfwSpan = doc.selectFirst("span:containsOwn(18+)");
    if (nsfwSpan) closest(nsfwSpan, "div.absolute.inset-0.z-20")?.remove();

    const state = this.extractLivewireState(doc, "manga.chapter-list");
    if (state == null) return [];

    // If langCode is null (the "all" source), loop through all 7 languages in parallel
    const langCodes = this.langCode != null ? [this.langCode] : ["EN", "FR", "JA", "PT-BR", "PT", "ES-LA", "ES"];

    const perLang = await Promise.all(
      langCodes.map(async (code) => {
        let currentSnapshot = state.snapshot;
        let prevChapterCount = 0;
        let langChapters: SChapter[] = [];

        for (;;) {
          const request = {
            _token: state.token,
            components: [{ snapshot: currentSnapshot, updates: { language: code }, calls: [livewireCall("loadMoreChapters")] }],
          };

          const dto = (await this.client.post(`${this.baseUrl}/livewire/update`, this.buildLivewireHeaders(doc.location()), JSON.stringify(request))).parseAs<LivewireResponse>();

          const html = dto.components?.[0]?.effects?.html;
          if (html == null) break;
          const chapterDoc = parseHtml(this.host.load, html, this.baseUrl);

          langChapters = this.parseChaptersFromDoc(chapterDoc, code, this.langCode == null);

          if (langChapters.length <= prevChapterCount) break;

          prevChapterCount = langChapters.length;
          const next = dto.components?.[0]?.snapshot;
          if (next == null) break;
          currentSnapshot = next;
        }
        return langChapters;
      }),
    );

    const num = (c: SChapter) => toFloatOrNull(CHAPTER_NUMBER_REGEX.exec(c.name)?.[1]) ?? 0;
    return distinctBy(perLang.flat(), (it) => it.url).sort((a, b) => num(b) - num(a));
  }

  private parseChaptersFromDoc(doc: Document, langCode: string, isAllSource: boolean): SChapter[] {
    const chapters: SChapter[] = [];

    // langCode is already uppercase ("EN", "FR", etc.)
    const langDisplay = langCode;

    const dateOf = (textEl: Element | null) => {
      const details = textEl?.text().replaceAll(" - ", " · ").split(INTERPUNCT_REGEX).filter((it) => it) ?? [];
      return (
        details.find((it) => {
          const lower = it.toLowerCase();
          return lower.includes("ago") || lower.includes("today") || lower.includes("yesterday");
        }) ?? ""
      );
    };

    // Pattern 1: Direct chapter links (no dropdown)
    for (const el of doc.select("a.gap-4:has(div[data-flux-heading])")) {
      const headingText = el.selectFirst("div[data-flux-heading]")?.text().replaceAll("Chapter ", "");
      const number = (headingText && headingText.trim() ? headingText : null) ?? el.selectFirst("div.w-10")?.text();
      if (number == null) continue;

      const url = el.absUrl("href") || el.attr("href");
      if (!url || !url.includes("/read/")) continue;

      const dateStr = dateOf(el.selectFirst("p[data-flux-text]"));

      const chapter = SChapter.create();
      chapter.name = `Chapter ${number}`;
      chapter.scanlator = isAllSource ? langCode : undefined;
      chapter.date_upload = this.parseChapterDate(dateStr);
      chapter.url = urlWithoutDomain(url);
      chapters.push(chapter);
    }

    // Pattern 2: Dropdowns (multiple versions/groups)
    for (const dropdown of doc.select("ui-dropdown:has(button div[data-flux-heading])")) {
      const button = dropdown.selectFirst("button");
      if (button == null) continue;

      const headingText = button.selectFirst("div[data-flux-heading]")?.text().replaceAll("Chapter ", "");
      const number = (headingText && headingText.trim() ? headingText : null) ?? button.selectFirst("div.w-10")?.text();
      if (number == null) continue;

      const dateStr = dateOf(button.selectFirst("p[data-flux-text]"));

      const links = dropdown.select("ui-menu a[data-flux-menu-item]");
      let unknownCount = 1;

      for (const linkEl of links) {
        const url = linkEl.absUrl("href") || linkEl.attr("href");
        if (!url || !url.includes("/read/")) continue;

        // Extract group name from the span inside the menu item
        const group = linkEl.selectFirst("span.text-sm")?.text() ?? linkEl.selectFirst("div.flex.items-center.gap-2 > span:not(.ml-auto)")?.text() ?? "";

        // If group is missing or "Unknown group", name them Unknown 1, Unknown 2...
        const unknown = !group.trim() || group.toLowerCase() === "unknown group";
        const groupName = unknown ? `Unknown ${unknownCount}` : group;
        if (unknown) unknownCount++;

        const chapter = SChapter.create();
        chapter.name = `Chapter ${number}`;
        // Append language to scanlator if it's the "all" source
        chapter.scanlator = isAllSource ? `${langDisplay} - ${groupName}` : groupName;
        chapter.date_upload = this.parseChapterDate(dateStr);
        chapter.url = urlWithoutDomain(url);
        chapters.push(chapter);
      }
    }

    return chapters;
  }

  private parseChapterDate(dateStr: string): number {
    const date = dateStr.toLowerCase();
    if (!date) return 0;

    const now = Date.now();

    if (date.includes("today")) return now;
    if (date.includes("yesterday")) return now - 86_400_000;

    const match = RELATIVE_DATE_REGEX.exec(date);
    if (match == null) return 0;

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "minute":
        return now - value * 60_000;
      case "hour":
        return now - value * 3_600_000;
      case "day":
        return now - value * 86_400_000;
      case "week":
        return now - value * 604_800_000;
      case "month":
        return now - value * 2_592_000_000;
      case "year":
        return now - value * 31_536_000_000;
      default:
        return 0;
    }
  }

  // ============================== Pages & Images ===============================

  private currentReaderToken = "";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.baseUrl + chapter.url;
    const body = (await this.client.get(chapterUrl)).text();

    const token = READER_TOKEN_REGEX.exec(body)?.[1] ?? "";
    if (!token.trim()) throw new Error("Could not find readerToken in chapter page");

    this.currentReaderToken = token;

    const pageCount = [...body.matchAll(PAGE_ORDER_REGEX)].length;

    return Array.from({ length: pageCount }, (_, index) => new Page(index, `${chapterUrl}#${index}`));
  }

  override async getImageUrl(page: Page): Promise<string> {
    const chapterUrl = substringBefore(page.url, "#");
    const cid = HttpUrl.parse(chapterUrl).pathSegments.at(-1)!;
    const order = page.index;
    const apiUrl = `${this.baseUrl}/api/chapter/${cid}/page/${order}`;

    let token = this.currentReaderToken;
    let attempt = 0;

    while (attempt < 3) {
      attempt++;

      await this.withApiLock(async () => {
        const rateLimitDelay = this.rateLimitDelay();
        const now = Date.now();
        const waitTime = Math.max(rateLimitDelay - (now - this.lastRequestTime), 0);
        // Using rateLimit from keiyoushi.network.rateLimit was too aggressive, leading to 429 errors when it was fine after the rest of the images loaded
        // Note: Error 429 lasts for approximately 15-30 minutes. Had to jump between many VPN servers to reach this conclusion
        if (waitTime > 0) await sleep(waitTime);
        this.lastRequestTime = Date.now();
      });

      const response = await this.client.get(apiUrl, this.apiHeaders(token, chapterUrl), { ensureSuccess: false });

      // Handle 429 just in case (still holding the lock)
      if (response.code === 429) {
        const retryHeader = Number.parseInt(response.header("retry-after") ?? "", 10);
        const retryAfter = Number.isNaN(retryHeader) ? this.rateLimitDelay() : retryHeader * 1000;
        await this.withApiLock(async () => {
          await sleep(retryAfter);
          this.lastRequestTime = Date.now();
        });
        continue;
      }

      // Update token globally if the server provides a new one
      const next = response.header("x-reader-token-next");
      if (next && next.trim()) this.currentReaderToken = next;

      const dto = response.parseAs<PageApiResponse>();

      if (dto.url != null) return dto.url;

      if (!response.isSuccessful || dto.message?.toLowerCase().includes("expired") === true) {
        const refreshBody = (await this.client.get(chapterUrl)).text();
        const newToken = READER_TOKEN_REGEX.exec(refreshBody)?.[1];

        if (!newToken || !newToken.trim()) throw new Error(`Failed to refresh reader token (HTTP ${response.code})`);

        token = newToken;
        this.currentReaderToken = newToken;
        continue;
      }

      throw new Error(`API Error: ${dto.message}`);
    }

    throw new Error("Failed to fetch image after 3 retries.");
  }

  private rateLimitDelay(): number {
    const v = Number.parseInt(this.preferences.getString(PREF_RATE_LIMIT_KEY, "2000") ?? "", 10);
    return Number.isNaN(v) ? 2000 : v;
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const referer = substringBeforeLast(page.url, "#");
    const h = this.headersBuilder();
    h.set("Referer", referer);
    return { url: page.imageUrl!, headers: h };
  }

  // ================================== Helpers ===================================

  private apiHeaders(token: string, referer: string): Headers {
    const h = this.headersBuilder();
    h.set("X-Reader-Token", token);
    h.set("Sec-Fetch-Mode", "cors");
    h.set("Sec-Fetch-Site", "same-origin");
    h.set("Referer", referer);
    return h;
  }

  private extractLivewireState(doc: Document, componentName: string): LivewireState | null {
    const token = doc.selectFirst("meta[name=csrf-token]")?.attr("content")?.trim() ? doc.selectFirst("meta[name=csrf-token]")!.attr("content") : doc.selectFirst("input[name=_token]")?.attr("value");
    if (!token || !token.trim()) return null;

    for (const el of doc.select("*")) {
      const attribs = (el.node as { attribs?: Record<string, string> }).attribs ?? {};
      const snapshotKey = Object.keys(attribs).find((it) => it.endsWith("snapshot"));
      if (snapshotKey != null) {
        const snapshot = attribs[snapshotKey];
        if (snapshot.includes(componentName)) return new LivewireState(snapshot, token);
      }
    }
    return null;
  }

  override getMangaUrl(manga: SManga): string {
    const memoSlug = manga.memo?.slug;
    const slug = typeof memoSlug === "string" ? memoSlug : substringAfterLast(manga.url, "/");
    return `${this.baseUrl}/manga/${slug}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.split("/").filter((it) => it.trim());
    let mangaUrl: string;
    if (pathSegments[0]?.toLowerCase() === "manga" && pathSegments.length >= 2) {
      mangaUrl = `${url.protocol}//${url.hostname}/manga/${pathSegments[1]}`;
    } else if (pathSegments[0]?.toLowerCase() === "read") {
      const doc = (await this.client.get(url.toString())).asJsoup();
      const link = doc.selectFirst('a[href*="/manga/"]')?.absUrl("href");
      if (link == null) return null;
      mangaUrl = link;
    } else {
      return null;
    }

    const doc = (await this.client.get(mangaUrl)).asJsoup();
    const manga = this.mangaDetailsParse(doc);
    manga.url = urlWithoutDomain(mangaUrl);
    return manga;
  }

  private excludedGenresPref(): string[] {
    const showNsfw = this.preferences.getBoolean(PREF_NSFW_KEY, false);
    return showNsfw ? this.preferences.getStringSet(PREF_EXCLUDE_GENRE_ADULT, []) : this.preferences.getStringSet(PREF_EXCLUDE_GENRE, []);
  }

  private typePref(): string {
    return this.preferences.getString(PREF_TYPE_KEY, "")!;
  }
  private statusPref(): string {
    return this.preferences.getString(PREF_STATUS_KEY, "")!;
  }

  // =============================== Preferences =================================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const genreNames = genreList.map((it) => it[0]);
    const genreIds = genreList.map((it) => it[1]);

    const nsfwPref = new SwitchPreferenceCompat();
    nsfwPref.key = PREF_NSFW_KEY;
    nsfwPref.title = "Show NSFW / 18+ Content";
    nsfwPref.summary = "Shows manga marked as 18+. Otherwise, they are hidden from lists.";
    nsfwPref.setDefaultValue(false);
    screen.addPreference(nsfwPref);

    const typePref = new ListPreference();
    typePref.key = PREF_TYPE_KEY;
    typePref.title = "Type Filter";
    typePref.entries = ["All", "Manga", "Manhwa", "Manhua", "Novel", "One-Shot", "Doujinshi"];
    typePref.entryValues = ["", "MANGA", "MANHWA", "MANHUA", "NOVEL", "ONE-SHOT", "DOUJINSHI"];
    typePref.setDefaultValue("");
    typePref.summary = "Applies to Popular & Latest";
    screen.addPreference(typePref);

    const statusPref = new ListPreference();
    statusPref.key = PREF_STATUS_KEY;
    statusPref.title = "Status Filter";
    statusPref.entries = ["All", "Ongoing", "Completed", "Hiatus", "Releasing"];
    statusPref.entryValues = ["", "ongoing", "completed", "hiatus", "releasing"];
    statusPref.setDefaultValue("");
    statusPref.summary = "Applies to Popular & Latest";
    screen.addPreference(statusPref);

    // setEnabled(!showNsfw / showNsfw) and the NSFW switch's listener toggling them have no equivalent in the app's form
    const normalGenrePref = new MultiSelectListPreference();
    normalGenrePref.key = PREF_EXCLUDE_GENRE;
    normalGenrePref.title = "Genre Blacklist";
    normalGenrePref.summary = "Exclude genres when browsing without 18+ content.";
    normalGenrePref.entries = genreNames;
    normalGenrePref.entryValues = genreIds;
    normalGenrePref.setDefaultValue([]);
    screen.addPreference(normalGenrePref);

    const adultGenrePref = new MultiSelectListPreference();
    adultGenrePref.key = PREF_EXCLUDE_GENRE_ADULT;
    adultGenrePref.title = "Genre Blacklist (Adult)";
    adultGenrePref.summary = "Exclude genres when browsing with 18+ content.";
    adultGenrePref.entries = genreNames;
    adultGenrePref.entryValues = genreIds;
    adultGenrePref.setDefaultValue([]);
    screen.addPreference(adultGenrePref);

    const rateLimitPref = new ListPreference();
    rateLimitPref.key = PREF_RATE_LIMIT_KEY;
    rateLimitPref.title = "Image Requests Limit";
    rateLimitPref.entries = ["1 image per 1.50 seconds", "1 image per 1.75 seconds", "1 image per 2.00 seconds", "1 image per 2.25 seconds", "1 image per 2.50 seconds"];
    rateLimitPref.entryValues = ["1500", "1750", "2000", "2250", "2500"];
    rateLimitPref.setDefaultValue("2000");
    rateLimitPref.summary = "%s\nWarning: Lowering this might cause 429 errors.";
    screen.addPreference(rateLimitPref);
  }
}
