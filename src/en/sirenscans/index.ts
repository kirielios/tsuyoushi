// Port of keiyoushi/extensions-source src/en/sirenscans/SirenScans.kt (+ Filters.kt, SirenScansDto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  ifBlank,
  isBlank,
  parseHtml,
  toHttpUrl,
  urlWithoutDomain,
  type Element,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

// --- SirenScansDto.kt
interface ChaptersResponseDto {
  rows_html: string;
}
interface GenreResponseDto {
  genres: { name: string; slug: string }[];
}

// --- Filters.kt
const uppercaseFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

class StatusFilter extends Filter.Select<string> {
  private static readonly ENTRIES: [string, string][] = [
    ["All", ""],
    ["Ongoing", "ongoing"],
    ["Completed", "completed"],
  ];
  constructor() {
    super("Status", StatusFilter.ENTRIES.map((it) => it[0]));
  }
  get selected() {
    return StatusFilter.ENTRIES[this.state][1];
  }
}

class SortFilter extends Filter.Select<string> {
  private static readonly ENTRIES: [string, string][] = [
    ["Latest", "latest"],
    ["Trending", "trending"],
    ["Popular", "popular"],
    ["Most Viewed", "views"],
    ["Top Rated", "rating"],
    ["A-Z", "az"],
    ["Z-A", "za"],
  ];
  constructor() {
    super("Sort by", SortFilter.ENTRIES.map((it) => it[0]));
  }
  get selected() {
    return SortFilter.ENTRIES[this.state][1];
  }
}

class TypeFilter extends Filter.Select<string> {
  private static readonly ENTRIES: [string, string][] = [
    ["All", ""],
    ["Manhwa", "manhwa"],
    ["Manhua", "manhua"],
    ["Mangatoon", "mangatoon"],
    ["Manga", "manga"],
    ["Novel", "novel"],
  ];
  constructor() {
    super("Type", TypeFilter.ENTRIES.map((it) => it[0]));
  }
  get selected() {
    return TypeFilter.ENTRIES[this.state][1];
  }
}

class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

interface Genre {
  name: string;
  value: string;
}

class GenreFilter extends Filter.Group<GenreCheckBox> {
  constructor(genres: Genre[]) {
    super("Genres", genres.map((it) => new GenreCheckBox(it.name, it.value)));
  }
}

function parseGenreData(document: Element): unknown {
  const genres = document.select("div#search-genres-list a.genre-tag[data-tag]").map((el) => ({ name: uppercaseFirst(el.text().trim()), slug: el.attr("data-tag") }));
  return { genres };
}

function getGenreList(data: unknown = null): Genre[] {
  let items: GenreResponseDto["genres"] = [];
  try {
    items = (data as GenreResponseDto | null)?.genres ?? [];
  } catch {
    items = [];
  }
  return items.map((item) => ({ name: item.name, value: item.slug }));
}

const SHOW_LOCKED_CHAPTERS_PREF = "pref_show_locked_chap";
const DATE_FORMAT = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

export default class SirenScans extends KeiSource {
  override get supportsFilterFetching() {
    return true;
  }

  // ========================= Preference =========================
  private get showLockedChapters(): boolean {
    return this.preferences.getBoolean(SHOW_LOCKED_CHAPTERS_PREF, false);
  }
  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = SHOW_LOCKED_CHAPTERS_PREF;
    p.title = "Show locked chapters";
    // summaryOn / summaryOff: the settings form shows one summary, so it follows the current value
    p.summary = this.showLockedChapters ? "Locked chapters will be shown in the chapter list" : "Locked chapters will be hidden from the chapter list";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  // =========================Popular===========================
  // At this point the site only loads like 40 manga for latest, popular or any filter
  // and I couldn't find a way to load anymore on the site
  // so this will need to be updated if site starts using pagination
  async getPopularManga(page: number): Promise<MangasPage> {
    if (page > 1) return new MangasPage([], false);
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/?browse=1&sort=popular`)).asJsoup());
  }

  // ==========================Latest============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    if (page > 1) return new MangasPage([], false);
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/?browse=1`)).asJsoup());
  }

  // ========================= Search =========================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (page > 1) return new MangasPage([], false);
    const response = await this.client.get(this.buildSearchMangaUrl(query, filters));
    return this.parseMangaList(response.asJsoup());
  }

  private buildSearchMangaUrl(query: string, filters: FilterList): string {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    if (!isBlank(query)) b.addQueryParameter("q", query);
    b.addQueryParameter("browse", "1");

    for (const filter of filters) {
      if (filter instanceof TypeFilter) {
        if (filter.state > 0) b.addQueryParameter("type", filter.selected);
      } else if (filter instanceof StatusFilter) {
        if (filter.state > 0) b.addQueryParameter("status", filter.selected);
      } else if (filter instanceof GenreFilter) {
        filter.state.filter((it) => it.state).forEach((it) => b.addQueryParameter("tag[]", it.value));
      } else if (filter instanceof SortFilter) {
        if (filter.state !== 0) b.addQueryParameter("sort", filter.selected);
      }
    }
    return b.build().toString();
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;

    const newUrl = new URL(this.baseUrl);
    newUrl.pathname = url.pathname;
    newUrl.search = url.search;

    const response = await this.client.get(newUrl.href);

    return this.parseMangaDetails(response.asJsoup(), newUrl.pathname);
  }

  // ========================= Details =========================
  private parseMangaDetails(document: Element, mangaUrl: string): SManga {
    const manga = SManga.create();
    manga.url = mangaUrl;
    manga.title = document.selectFirst("h1")!.text().trim();

    manga.description = document
      .selectFirst("p#series-desc")
      ?.text()
      .trim()
      .replace(/^["\s]+|["\s]+$/g, "")
      .trim();

    const thumb = document.selectFirst("div[style*=aspect-ratio] img");
    manga.thumbnail_url = thumb ? ifBlank(thumb.attr("abs:data-src"), thumb.attr("abs:src")) : undefined;

    const sidebarGenres = document.select("div.flex.flex-wrap.-mx-1 a[href*=tag]").eachText();
    if (sidebarGenres.length) manga.genre = sidebarGenres.join(", ");

    manga.author = this.metaValue(document, "Author") ?? undefined;
    manga.artist = this.metaValue(document, "Artist") ?? undefined;
    switch (this.statValue(document, "Status")?.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    const chaptersDiv = document.selectFirst("div#chapters-list");
    const seriesUid = chaptersDiv?.attr("data-series-uid") ?? "";
    const seriesSlug = chaptersDiv?.attr("data-series-slug") ?? "";
    if (!isBlank(seriesUid) && !isBlank(seriesSlug)) manga.memo = { uid: seriesUid, slug: seriesSlug };
    return manga;
  }

  // ========================= Chapters =========================
  private async parseChapterList(seriesUid: string, seriesSlug: string): Promise<SChapter[]> {
    const apiUrl = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("_chapters_html", "1").addQueryParameter("series_uid", seriesUid).addQueryParameter("series_slug", seriesSlug).build();

    const json = (await this.client.get(apiUrl.toString())).parseAs<ChaptersResponseDto>();
    const rowsDocument = parseHtml(this.host.load, json.rows_html, this.baseUrl);

    return rowsDocument
      .select("a.chapter-row[href]")
      .filter((it) => this.showLockedChapters || it.attr("data-ch-locked") !== "1")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(element.attr("abs:href"));
        chapter.name = element.attr("data-ch-label").trim();
        chapter.date_upload = DATE_FORMAT.tryParseDate(element.selectFirst(".ch-date-row span:last-child")?.text());
        return chapter;
      });
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let uid = (manga.memo.uid as string | undefined) ?? null;
    let slug = (manga.memo.slug as string | undefined) ?? null;
    let updatedManga = manga;

    if (fetchDetails || (fetchChapters && (uid == null || slug == null))) {
      const parsed = this.parseMangaDetails((await this.client.get(this.baseUrl + manga.url)).asJsoup(), manga.url);
      uid = (parsed.memo.uid as string | undefined) ?? uid;
      slug = (parsed.memo.slug as string | undefined) ?? slug;
      if (fetchDetails) updatedManga = parsed;
      else {
        manga.memo = parsed.memo;
        updatedManga = manga;
      }
    }

    let updatedChapters = chapters;
    if (fetchChapters) {
      if (uid == null) throw new Error(`Could not find series ID for: ${manga.url}`);
      if (slug == null) throw new Error(`Could not find series slug for: ${manga.url}`);
      updatedChapters = await this.parseChapterList(uid, slug);
    }

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  // ========================= Pages =========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    return this.parsePageList(document);
  }

  private parsePageList(document: Element): Page[] {
    return document.select("div#strip-reader img.reader-page").map((element, i) => new Page(i, "", element.attr("abs:src")));
  }

  // ========================= Filters =========================
  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/?browse=1`)).asJsoup();
    return parseGenreData(document);
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = getGenreList(data);

    const filters: Filter[] = [new TypeFilter(), new StatusFilter(), new SortFilter()];
    if (genres.length) filters.push(new GenreFilter(genres));
    return FilterList(...filters);
  }

  // ========================= Helper =========================
  private parseMangaList(document: Element): MangasPage {
    const mangas = document.select("div.grid a.group[href]").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.attr("abs:href"));
      manga.title = element.selectFirst("h2")!.text().trim();
      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? ifBlank(img.attr("abs:data-src"), img.attr("abs:src")) : undefined;
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  private metaValue(document: Element, label: string): string | null {
    const labelSpan = document.select("div.flex.items-center.justify-between span").find((it) => it.text().trim().toLowerCase() === label.toLowerCase());
    return labelSpan?.parent()?.nextElementSibling()?.text().trim() ?? null;
  }

  private statValue(document: Element, label: string): string | null {
    const labelDiv = document.select("div").find((it) => it.children().length === 0 && it.text().trim().toLowerCase() === label.toLowerCase());
    return labelDiv?.nextElementSibling()?.select("span").last()?.text().trim() ?? null;
  }
}
