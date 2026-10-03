// Port of keiyoushi/extensions-source lib-multisrc/hiper/Hiper.kt (+ Dto.kt)
import {
  Filter,
  FilterList,
  Intl,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  type ClientBuilder,
  type HttpUrl,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import { messages } from "./messages.ts";

// ============================ Dto ====================================

/** Kotlin's Float.toString(): whole numbers keep ".0". */
const ktFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

interface WrapperContent {
  hits: MangaDto[];
}

interface MangaDto {
  id: number;
  slug: string;
  title: string;
  synopsis?: string | null;
  coverUrl?: string | null;
  status?: string | null;
  genres?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  type?: string | null;
  contentRating?: string | null;
}

function mangaToSManga(dto: MangaDto, mangaPath: string): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.description = dto.synopsis ?? undefined;
  manga.thumbnail_url = dto.coverUrl ?? undefined;
  manga.artist = dto.artists?.join(", ");
  manga.author = dto.authors?.join(", ");
  manga.genre = [...(dto.genres ?? []), ...[dto.type, dto.contentRating].filter((it): it is string => it != null)].join(", ");
  switch (dto.status?.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "cancelled":
      manga.status = SManga.CANCELLED;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.url = `/${mangaPath}/${dto.slug}`;
  manga.memo = { mangaId: dto.id };
  manga.initialized = true;
  return manga;
}

interface ChapterDto {
  id: number;
  number: number;
  title?: string | null;
  createdAt: string;
}

const NUMBER_REGEX = /\d+/;

function chapterToSChapter(dto: ChapterDto, mangaPath: string, isDuplicate = false): SChapter {
  const labelNumber = `Chapter ${ktFloat(dto.number).replace(".0", "")}`;
  const chapter = SChapter.create();
  chapter.name = dto.title != null ? (NUMBER_REGEX.test(dto.title) ? dto.title : `${labelNumber} ${dto.title}`) : labelNumber;
  chapter.chapter_number = dto.number;
  const t = Date.parse(dto.createdAt);
  chapter.date_upload = Number.isNaN(t) ? 0 : t;
  chapter.url = `${mangaPath}/` + (isDuplicate ? `${dto.id}` : ktFloat(dto.number));
  chapter.memo = { chapterId: dto.id };
  return chapter;
}

interface PageDto {
  pageOrder: number;
  webpUrl: string;
  avifUrl?: string | null;
}

// ============================ Filters ====================================

type Pair<T = string> = [string, T];

export class OrderByFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: Pair[],
    state = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      state,
    );
  }
  selected() {
    return this.vals[this.state][1];
  }
}

export class SortFilter extends OrderByFilter {
  constructor(intl: Intl) {
    super(intl.get("sort_by_filter_title"), [
      [intl.get("sort_by_relevance"), "relevance"],
      [intl.get("sort_by_popular"), "popular"],
      [intl.get("sort_by_score"), "score"],
      [intl.get("sort_by_recent"), "recent"],
      [intl.get("sort_by_newest"), "newest"],
      [intl.get("sort_by_oldest"), "oldest"],
      ["A-Z", "alphabetical"],
    ]);
  }
}

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: Pair<string | null>[],
    state = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      state,
    );
  }
  selected(): string | null {
    return this.vals[this.state][1];
  }
}

const MAX_RATING_PREF = "MAX_RATING";
const MAX_RATING_DEFAULT = "pornographic";
const MAX_RATING_ENTRIES = ["Pornographic", "Erotica", "Suggestive", "Safe"];
const MAX_RATING_VALUES = ["pornographic", "erotica", "suggestive", "safe"];

export class RatingFilter extends SelectFilter {
  constructor(intl: Intl) {
    super(intl.get("rating_filter_title"), [[intl.get("status_all"), null], ...MAX_RATING_ENTRIES.map((e, i): Pair<string | null> => [e, MAX_RATING_VALUES[i]])]);
  }
}

export class TypeFilter extends SelectFilter {
  constructor(intl: Intl) {
    super(intl.get("type_filter_title"), [
      [intl.get("status_all"), null],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Novel", "novel"],
      ["Webtoon", "webtoon"],
      ["One Shot", "one_shot"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor(intl: Intl) {
    super(intl.get("status_filter_title"), [
      [intl.get("status_all"), null],
      [intl.get("status_ongoing"), "ongoing"],
      [intl.get("status_completed"), "completed"],
      [intl.get("status_onhiatus"), "hiatus"],
      [intl.get("status_canceled"), "cancelled"],
    ]);
  }
}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(readonly value: string) {
    super(value);
  }
}

export class GenresFilter extends Filter.Group<GenreCheckBox> {
  constructor(entries: string[], intl: Intl) {
    super(
      intl.get("genre_filter_title"),
      entries.map((it) => new GenreCheckBox(it)),
    );
  }
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

// ============================ Source ====================================

type Json = unknown[];
const dataJson = (element: unknown): unknown => (element as { result?: { data?: { json?: unknown } } })?.result?.data?.json;

export abstract class Hiper extends KeiSource {
  protected mangaPath = "manga";

  private wvHeaders: Headers | null = null;

  protected addHiperAuthInterceptor(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      let request = chain.request();

      if (this.wvHeaders) request = { ...request, headers: this.wvHeaders };

      const response = await chain.proceed(request);

      // Fetch baseUrl with accept headers which then populates a cookie
      if (response.code === 401) {
        const acceptHeaders = this.headersBuilder();
        acceptHeaders.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        await chain.proceed({ url: this.baseUrl, method: "GET", headers: acceptHeaders });
        return chain.proceed(chain.request());
      }
      return response;
    });
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return this.addHiperAuthInterceptor(builder);
  }

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "pt-BR"], messages });

  // ============================ Popular ====================================

  protected get popularFilter(): FilterList {
    return FilterList(new OrderByFilter("", [["", "popular"]]));
  }

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.popularFilter);
  }

  // ============================ Latest ====================================
  protected get latestFilter(): FilterList {
    return FilterList(new OrderByFilter("", [["", "recent"]]));
  }

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.latestFilter);
  }

  // ============================ Search ====================================
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const limit = 30;
    const typeValue = filters.find((it): it is TypeFilter => it instanceof TypeFilter)?.selected() ?? null;
    const statusValue = filters.find((it): it is StatusFilter => it instanceof StatusFilter)?.selected() ?? null;
    const ratingValue = filters.find((it): it is RatingFilter => it instanceof RatingFilter)?.selected() ?? null;
    const genresValue = filters.find((it): it is GenresFilter => it instanceof GenresFilter)?.checked ?? [];

    const json: Record<string, unknown> = { q: query };
    filters.forEach((filter) => {
      if (filter instanceof OrderByFilter) json.sort = filter.selected();
    });
    json.filters = {
      genres: genresValue.length ? genresValue : null,
      type: typeValue,
      status: statusValue,
      contentRating: ratingValue,
      author: null,
      artist: null,
      year: null,
    };
    json.limit = limit;
    json.offset = (page - 1) * limit;
    json.maxRating = this.preferences.getString(MAX_RATING_PREF, MAX_RATING_DEFAULT);

    const values: Record<string, string[]> = {};
    if (!genresValue.length) values["filters.genres"] = ["undefined"];
    if (typeValue == null) values["filters.type"] = ["undefined"];
    if (statusValue == null) values["filters.status"] = ["undefined"];
    if (ratingValue == null) values["filters.contentRating"] = ["undefined"];
    values["filters.author"] = ["undefined"];
    values["filters.artist"] = ["undefined"];
    values["filters.year"] = ["undefined"];

    const input = JSON.stringify({ "0": { json, meta: { values } } });

    const url = toHttpUrl(`${this.baseUrl}/api/trpc/search.query`).newBuilder().addQueryParameter("batch", "1").addQueryParameter("input", input).build();

    return this.parseSearchMangaList(await this.client.get(url.toString()));
  }

  protected parseSearchMangaList(response: Response): MangasPage {
    const element = response.parseAs<Json>()[0];
    const dto = dataJson(element) as WrapperContent | undefined;
    if (dto == null) return new MangasPage([], false);
    return new MangasPage(
      dto.hits.map((it) => mangaToSManga(it, this.mangaPath)),
      dto.hits.length > 0,
    );
  }

  // ============================ Details ===================================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  protected getMangaDetails(manga: SManga): Promise<SManga | null> {
    const slug = this.getSlug(manga.url);
    return this.getMangaBySlug(slug);
  }

  protected override getMangaByUrl(url: URL): Promise<SManga | null> {
    const slug = this.getSlug(url.toString());
    return this.getMangaBySlug(slug);
  }

  protected async getMangaBySlug(slug: string): Promise<SManga | null> {
    if (!slug.trim()) return null;

    const input = {
      "0": { json: null, meta: { values: ["undefined"] } },
      "1": { json: { slug } },
    };

    const url = toHttpUrl(`${this.baseUrl}/api/trpc/auth.me,series.bySlugWithGenres`).newBuilder().addQueryParameter("batch", "1").addQueryParameter("input", JSON.stringify(input)).build();

    return this.parseMangaDetails(await this.client.get(url.toString()));
  }

  protected parseMangaDetails(response: Response): SManga {
    const element = response.parseAs<Json>().at(-1);
    return mangaToSManga(dataJson(element) as MangaDto, this.mangaPath);
  }

  // ============================ Chapters ==================================

  override getChapterUrl(chapter: SChapter): string {
    const slug = this.getSlug(chapter.url);
    return removeSuffix(`${this.baseUrl}/${this.mangaPath}/${slug}/${ktFloat(this.getNumber(chapter))}`, ".0");
  }

  protected async getChapterList(manga: SManga): Promise<SChapter[] | null> {
    const memoId = manga.memo?.mangaId;
    const fallback = substringAfterLast(manga.url, "#"); // Fallback for old manga URLs
    const mangaId = typeof memoId === "number" ? memoId : /^[+-]?\d+$/.test(fallback) ? Number(fallback) : null;
    if (mangaId == null) return null;

    const input = {
      "0": { json: { values: ["undefined"] } },
      "1": {
        json: { seriesId: mangaId, chapterId: null, sort: "best", page: 1, limit: 20 },
        meta: { values: { chapterId: ["undefined"] } },
      },
      "2": { json: { seriesId: mangaId } },
    };

    const url = toHttpUrl(`${this.baseUrl}/api/trpc/auth.me,series.chapters`).newBuilder().addQueryParameter("batch", "1").addQueryParameter("input", JSON.stringify(input)).build();

    const response = await this.client.get(url.toString());
    const element = response.parseAs<Json>().at(-1);
    const chaptersDTO = dataJson(element) as ChapterDto[];

    // Make chapter url unique only when needed
    const seen = new Set<number>();
    return chaptersDTO.map((it) => {
      const dup = seen.has(it.number);
      seen.add(it.number);
      return chapterToSChapter(it, manga.url, dup);
    });
  }

  // ============================ Manga updates =============================

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let updatedManga = fetchDetails ? (await this.getMangaDetails(manga))! : manga;
    let updatedChapters: SChapter[];
    if (fetchChapters) {
      let list = await this.getChapterList(updatedManga);
      if (list == null) {
        // Auto migrate
        updatedManga = (await this.getMangaDetails(manga))!;
        list = await this.getChapterList(updatedManga);
      }
      updatedChapters = list!;
    } else {
      updatedChapters = chapters;
    }

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  // ============================ Pages =====================================

  protected pageListUrl(chapter: SChapter): HttpUrl {
    const slug = this.getSlug(chapter.url);

    const json2: Record<string, unknown> = { seriesSlug: slug, chapterNumber: this.getNumber(chapter) };
    if (chapter.memo?.chapterId != null) json2.chapterId = chapter.memo.chapterId;
    const input = {
      "0": { json: null, meta: { values: ["undefined"] } },
      "1": { json: { slug } },
      "2": { json: json2 },
      "3": { json: { position: "footer_bottom" } },
    };

    return toHttpUrl(`${this.baseUrl}/api/trpc/auth.me,series.bySlug,reader.chapterPages`).newBuilder().addQueryParameter("batch", "1").addQueryParameter("input", JSON.stringify(input)).build();
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const url = this.pageListUrl(chapter);

    const pages = this.parsePages(await this.client.get(url.toString(), undefined, { ensureSuccess: false }));
    if (pages?.length) return pages;

    await this.fetchHeadersWv(chapterUrl);

    if (this.wvHeaders) return this.parsePages(await this.client.get(url.toString(), undefined, { ensureSuccess: false })) ?? [];
    throw new Error("Failed to get headers");
  }

  protected parsePages(response: Response): Page[] | null {
    const elements = response.parseAs<Json>();

    for (const element of elements) {
      if (element != null && typeof element === "object" && "error" in element) return null;
    }

    const pages = dataJson(elements.at(-1)) as PageDto[] | null | undefined;
    if (pages == null) return [];
    return pages.map((it) => new Page(it.pageOrder, "", it.avifUrl ?? it.webpUrl));
  }

  /**
   * Upstream loads the chapter in a WebView (runWebView) and copies the headers the site's own scripts put on its API
   * calls. Running site code is not ported, so this only fails, as upstream does when no headers were captured.
   */
  protected async fetchHeadersWv(_url: string): Promise<void> {
    throw new Error("Failed to get headers");
  }

  // ============================ Preferences ================================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new ListPreference(screen.context);
    p.key = MAX_RATING_PREF;
    p.title = this.intl.get("pref_rating_title");
    p.summary = `${this.intl.get("pref_rating_summary")} %s`;
    p.entries = MAX_RATING_ENTRIES;
    p.entryValues = MAX_RATING_VALUES;
    p.setDefaultValue(MAX_RATING_DEFAULT);
    screen.addPreference(p);
  }

  // ============================ Filters ====================================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(this.intl), new RatingFilter(this.intl), new TypeFilter(this.intl), new StatusFilter(this.intl), new GenresFilter(this.genresList, this.intl));
  }

  protected get genresList(): string[] {
    return [];
  }

  // Old (New)
  // manga: /manga/<slug|(#ID)>
  // chapter: /manga/slug(#ID)/<chapter-XX|(XX.X)>

  getSlug(s: string): string {
    const slug = substringBefore(substringBefore(substringAfterLast(s, `${this.mangaPath}/`), "/"), "#");
    if (!slug.trim()) throw new Error(`Migrate from ${this.name} to ${this.name}`);
    return slug;
  }

  getNumber(chapter: SChapter): number {
    if (chapter.chapter_number > 0) return chapter.chapter_number;
    const s = substringAfter(substringAfterLast(chapter.url.replace(/^\/+|\/+$/g, ""), "/"), "-");
    const n = s.trim() ? Number(s) : NaN; // toFloatOrNull
    return Number.isNaN(n) ? 1 : n;
  }
}
