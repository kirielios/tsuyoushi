// Port of keiyoushi/extensions-source lib-multisrc/keyoapp/Keyoapp.kt
import {
  DateTimeFormatter,
  FilterList,
  Intl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  isNotBlank,
  parseAs,
  substringAfter,
  substringBefore,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type Document,
  type Element,
  type HttpUrl,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import { GenreFilter, MultiSelectFilter, StatusFilter, TypeFilter } from "./filters.ts";
import { messages } from "./messages.ts";

const SHOW_PAID_CHAPTERS_PREF = "pref_show_paid_chap";
export const CDN_HOST_REGEX = /realUrl\s*=\s*`[^`]+\/\/([^/]+)/;
export const CDN_CLEAN_REGEX = /\$\{[^}]*\}/g;
export const IMG_REGEX = /url\(['"]?([^('")]+)/;

const selector = (sel: string, contains: string[]) => contains.map((it) => sel.replaceAll("%s", it)).join(", ");

export abstract class Keyoapp extends KeiSource {
  dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["ar", "en", "fr"], messages });

  // ============================== Popular ==============================

  override async getPopularManga(_page: number): Promise<MangasPage> {
    return this.popularMangaParse((await this.client.get(this.baseUrl)).asJsoup());
  }

  popularMangaTitleSelector = ["Popular", "Popularie", "Trending"];

  popularMangaSelector(): string {
    return selector("div:contains(%s) + div .group.overflow-hidden.grid", this.popularMangaTitleSelector);
  }

  popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.thumbnail_url = this.getElementImageUrl(element, "*[style*=background-image]") ?? undefined;
    const a = element.selectFirst("a[href]")!;
    manga.title = a.attr("title");
    manga.url = urlWithoutDomain(a.attr("abs:href"));
    return manga;
  }

  popularMangaNextPageSelector(): string | null {
    return null;
  }

  popularMangaParse(document: Document): MangasPage {
    const mangas = document
      .select(this.popularMangaSelector())
      .filter((it) => !this.isNovel(it))
      .map((it) => this.popularMangaFromElement(it));
    const next = this.popularMangaNextPageSelector();
    const hasNextPage = next != null && document.selectFirst(next) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================

  override async getLatestUpdates(_page: number): Promise<MangasPage> {
    return this.latestUpdatesParse((await this.client.get(`${this.baseUrl}/latest/`)).asJsoup());
  }

  latestUpdatesSelector(): string {
    return "div.grid > div.group";
  }

  latestUpdatesFromElement(element: Element): SManga {
    return this.popularMangaFromElement(element);
  }

  latestUpdatesNextPageSelector(): string | null {
    return null;
  }

  latestUpdatesParse(document: Document): MangasPage {
    const mangas = document
      .select(this.latestUpdatesSelector())
      .filter((it) => !this.isNovel(it))
      .map((it) => this.latestUpdatesFromElement(it));
    const next = this.latestUpdatesNextPageSelector();
    const hasNextPage = next != null && document.selectFirst(next) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Search ===============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    const segments = toHttpUrl(url.href).pathSegments[1];
    if (segments == null) return null;
    return this.mangaDetailsParse((await this.client.get(url)).asJsoup());
  }

  searchUrlBuilder(query: string, _page: number): HttpUrlBuilder {
    const b = toHttpUrl(`${this.baseUrl}/series`).newBuilder();
    if (isNotBlank(query)) b.addQueryParameter("q", query);
    return b;
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const b = this.searchUrlBuilder(query, page);
    filters.filter((it): it is MultiSelectFilter => it instanceof MultiSelectFilter).forEach((it) => it.addToUri(b));
    const url = b.build();
    return this.parseSearchManga(await this.client.get(url.toString()));
  }

  searchMangaSelector() {
    return "#searched_series_page > button";
  }

  searchMangaFromElement(element: Element): SManga {
    return this.popularMangaFromElement(element);
  }

  searchMangaNextPageSelector(): string | null {
    return null;
  }

  /** Kotlin's Element.isNovel() extension. */
  isNovel(element: Element): boolean {
    return element.select(`[data-type="novel" i], span:matchesOwn((?i)^novel$)`).length > 0;
  }

  matchesQuery(element: Element, query: string): boolean {
    return element.attr("title").toLowerCase().includes(query.toLowerCase());
  }

  matchesGenres(element: Element, genres: string[]): boolean {
    const tagsAttr = element.attr("tags").replaceAll("___", "'");
    let entryGenres: string[] = [];
    try {
      entryGenres = parseAs<string[]>(tagsAttr);
    } catch {
      entryGenres = [];
    }
    return genres.every((genre) => entryGenres.some((it) => it.toLowerCase() === genre.toLowerCase()));
  }

  matchesTypes(element: Element, types: string[]): boolean {
    return types.some((it) => it.toLowerCase() === element.attr("data-type").toLowerCase());
  }

  matchesStatuses(element: Element, statuses: string[]): boolean {
    return statuses.some((it) => it.toLowerCase() === element.attr("data-status").toLowerCase());
  }

  parseSearchManga(response: Response): MangasPage {
    const url = toHttpUrl(response.url);

    const document = response.asJsoup();
    const q = url.queryParameter("q");
    const genre = listParams(url, "genre");
    const type = listParams(url, "type");
    const status = listParams(url, "status");
    const mangaList = document
      .select(this.searchMangaSelector())
      .filter(
        (entry) =>
          !this.isNovel(entry) &&
          (q != null ? this.matchesQuery(entry, q) : true) &&
          (genre != null ? this.matchesGenres(entry, genre) : true) &&
          (type != null ? this.matchesTypes(entry, type) : true) &&
          (status != null ? this.matchesStatuses(entry, status) : true),
      )
      .map((it) => this.searchMangaFromElement(it));

    return new MangasPage(mangaList, false);
  }

  // ========================= Details + Chapters ========================

  // supportRelatedMangasBySearch = true upstream: Komikku-only, the reader has no related-by-search.

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(doc), this.chapterListParse(doc));
  }

  protected descriptionSelector = "#expand_content p";
  protected altNameSelector = "div.font-medium:containsOwn(Alternative titles) ~ div span";
  protected get altNamePrefix() {
    return `${this.intl.get("alt_names_heading")} `;
  }
  protected statusSelector = "div:has(span:containsOwn(Status)) ~ div";
  protected authorSelector = "div:has(span:containsOwn(Author)) ~ div";
  protected artistSelector = "div:has(span:containsOwn(Artist)) ~ div";
  protected genreSelector = "div:has(>h1) a[href*='genre=']";

  protected typeSelector = "div:has(span:containsOwn(Type)) ~ div";
  protected dateSelector = ".text-xs";

  mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    manga.title = document.selectFirst("div.grid > h1")!.text();
    manga.thumbnail_url = this.getElementImageUrl(document, "div[class*=photoURL], div[style*=photoURL]") ?? undefined;
    manga.status = this.parseStatus(document.selectFirst(this.statusSelector));
    manga.author = document.selectFirst(this.authorSelector)?.text();
    manga.artist = document.selectFirst(this.artistSelector)?.text();
    const genres: string[] = [];
    const type = document.selectFirst(this.typeSelector)?.text();
    if (type != null) genres.push(type.charAt(0).toUpperCase() + type.slice(1));
    document.select(this.genreSelector).forEach((it) => genres.push(it.text().replace(/^[, ]+|[, ]+$/g, "")));
    manga.genre = genres.filter(isNotBlank).join(", ");

    const synopsis = document.selectFirst(this.descriptionSelector)?.text() ?? "";
    const altNames = document
      .select(this.altNameSelector)
      .map((it) => it.text())
      .filter((it) => it.length > 0 && it !== "No alternative titles.");
    let description = synopsis;
    if (altNames.length) {
      if (description.length) description += "\n\n";
      description += this.altNamePrefix.trim();
      description += "\n";
      description += altNames.map((it) => `- ${it}`).join("\n");
    }
    manga.description = description || undefined;
    return manga;
  }

  protected paidChapterSelector = "img[alt~=Coin]";

  chapterListSelector(): string {
    if (!this.showPaidChapters) {
      return `#chapters > :is(a, div):not(:has(.text-sm span:matches(Upcoming))):not(:has(${this.paidChapterSelector}))`;
    }
    return "#chapters > :is(a, div):not(:has(.text-sm span:matches(Upcoming)))";
  }

  chapterListParse(document: Document): SChapter[] {
    return document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));
  }

  chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.selectFirst("a[href]")!.attr("abs:href"));
    chapter.name = element.selectFirst(".text-sm")!.text();
    const date = element.selectFirst(this.dateSelector);
    if (date) chapter.date_upload = this.parseDate(date.text().trim());
    if (element.select(this.paidChapterSelector).length) chapter.name = `🔒 ${chapter.name}`;
    return chapter;
  }

  // =============================== Pages ===============================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  pageListParse(document: Document): Page[] {
    const cdnUrl = this.getCdnUrl(document);
    const uids = document
      .select("#pages > img")
      .map((it) => it.attr("uid"))
      .filter((it) => it.length > 0);
    if (uids.length && cdnUrl == null) throw new Error(this.intl.get("chapter_page_url_not_found"));
    const pages = uids.map((img, index) => new Page(index, document.location(), `${cdnUrl}/${img}`));
    if (pages.length) return pages;

    // Fallback, old method
    return document
      .select("#pages > img")
      .map((it) => this.imgAttr(it))
      .filter((it) => OLD_IMG_CDN_REGEX.test(it))
      .map((img, index) => new Page(index, document.location(), img));
  }

  protected getCdnUrl(document: Document): string | null {
    const script = document.select("script").find((it) => CDN_HOST_REGEX.test(it.html()));
    if (!script) return null;
    const cdnHost = CDN_HOST_REGEX.exec(script.html())?.[1]?.replace(CDN_CLEAN_REGEX, "");
    return `https://${cdnHost}/uploads`;
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.parseGenres((await this.requestGeneres()).asJsoup());
  }

  override getFilterList(data: unknown = null): FilterList {
    const raw = data && typeof data === "object" ? (data as Record<string, string>) : {};
    // toSortedMap()
    const genres = Object.fromEntries(Object.entries(raw).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

    const types = this.getTypeList();
    const statuses = this.getStatusList();
    return FilterList(
      ...[
        Object.keys(genres).length ? new GenreFilter(genres) : null,
        Object.keys(types).length ? new TypeFilter(types) : null,
        Object.keys(statuses).length ? new StatusFilter(statuses) : null,
      ].filter((it) => it != null),
    );
  }

  requestGeneres(): Promise<Response> {
    return this.client.get(`${this.baseUrl}/series/`);
  }

  protected parseGenres(document: Document): Record<string, string> {
    const script = document.select("script:containsData(initializeDropdownMenu)").first()?.data();
    if (script == null) return {};

    const items =
      substringBefore(substringAfter(substringAfter(substringAfter(script, "initializeDropdownMenu({"), 'type: "genre",'), "items:"), "]").trim() + "]";

    // Upstream evaluates `items` with QuickJS. Site-served code is never executed here, so the object literals are read
    // with a regex instead: [{ value: "action", displayName: "Action" }, ...] -> { Action: "action" }.
    const out: Record<string, string> = {};
    for (const obj of items.match(/\{[^{}]*\}/g) ?? []) {
      const fields: Record<string, string> = {};
      for (const m of obj.matchAll(/\b(displayName|value)\s*:\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g)) fields[m[1]] = m[3].replace(/\\(.)/g, "$1");
      if (fields.displayName != null && fields.value != null) out[fields.displayName] = fields.value;
    }
    return out;
  }

  getTypeList(): Record<string, string> {
    return Object.fromEntries(["Manhwa", "Manhua", "Manga", "Mangatoon", "Comic"].map((it) => [it, it.toLowerCase()]));
  }

  getStatusList(): Record<string, string> {
    return Object.fromEntries(["Ongoing", "Completed", "Dropped", "Hiatus"].map((it) => [it, it.toLowerCase()]));
  }

  // ============================= Utilities =============================

  /** Kotlin's Element?.parseStatus() extension. */
  protected parseStatus(element: Element | null | undefined): number {
    switch (element?.text()?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "dropped":
        return SManga.CANCELLED;
      case "paused":
        return SManga.ON_HIATUS;
      case "completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // From mangathemesia
  private imgAttr(element: Element): string {
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    return element.attr("abs:src");
  }

  /** Kotlin's Element.getImageUrl(selector) extension; renamed, KeiSource.getImageUrl(page) takes the name. */
  protected getElementImageUrl(element: Element, selector: string): string | null {
    const el = element.selectFirst(selector);
    if (!el) return null;
    const url = toHttpUrlOrNull(IMG_REGEX.exec(el.attr("style"))?.[1]);
    // Keyoapp returns the dynamic size of the thumbnail to any size
    return url ? url.newBuilder().setQueryParameter("w", "480").build().toString() : null;
  }

  /** Kotlin's String.parseDate() extension. */
  parseDate(s: string): number {
    return s.includes("ago") ? parseRelativeDate(s) : this.dateFormat.tryParseDate(s);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = SHOW_PAID_CHAPTERS_PREF;
    pref.title = this.intl.get("pref_show_paid_chapter_title");
    // summaryOn / summaryOff: the settings form shows one summary, so it follows the current value
    pref.summary = this.intl.get(this.showPaidChapters ? "pref_show_paid_chapter_summary_on" : "pref_show_paid_chapter_summary_off");
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }

  protected get showPaidChapters() {
    return this.preferences.getBoolean(SHOW_PAID_CHAPTERS_PREF, false);
  }
}

const OLD_IMG_CDN_REGEX = /^(https?:)?\/\/cdn\d*\.keyoapp\.com/;

function parseRelativeDate(s: string): number {
  const now = new Date();
  now.setSeconds(0, 0);

  const first = s.split(" ")[0]?.replaceAll("one", "1").replaceAll("a", "1");
  const relativeDate = first != null && /^[+-]?\d+$/.test(first) ? Number(first) : null;
  if (relativeDate == null) return 0;

  if (s.includes("second")) now.setSeconds(now.getSeconds() - relativeDate);
  else if (s.includes("minute")) now.setMinutes(now.getMinutes() - relativeDate);
  else if (s.includes("hour")) now.setHours(now.getHours() - relativeDate);
  else if (s.includes("day")) now.setDate(now.getDate() - relativeDate);
  else if (s.includes("week")) now.setDate(now.getDate() - relativeDate * 7);
  else if (s.includes("month")) now.setMonth(now.getMonth() - relativeDate);
  else if (s.includes("year")) now.setFullYear(now.getFullYear() - relativeDate);
  return now.getTime();
}

function listParams(url: HttpUrl, name: string): string[] | null {
  const v = url.queryParameterValues(name);
  return v.length ? v : null;
}
