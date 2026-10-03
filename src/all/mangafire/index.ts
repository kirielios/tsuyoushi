// Port of keiyoushi/extensions-source src/all/mangafire/MangaFire.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  PreferenceScreen,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  parseHtml,
  toHttpUrl,
  type ClientBuilder,
  type Document,
  type SChapter,
  type SManga,
} from "../../../sdk/index.ts";
import { challengeSolverInterceptor } from "./challenge.ts";
import {
  chapterToSChapter,
  mangaDetailsToSManga,
  mangaDtoToSManga,
  volumeToSChapter,
  type ApiResponse,
  type ChapterDto,
  type MangaDetailsResponse,
  type MangaDto,
  type PagesResponse,
  type TagResponse,
  type VolumeDto,
} from "./dto.ts";
import {
  AuthorFilter,
  CONTENT_RATINGS,
  ContentRatingFilter,
  GenreFilter,
  GenreModeFilter,
  MinChapterFilter,
  SortFilter,
  StatusFilter,
  ThemeFilter,
  TypeFilter,
  YearFromFilter,
  YearToFilter,
  isUriFilter,
} from "./filters.ts";
import { VrfSigner } from "./vrfsigner.ts";

const CONTENT_RATING_PREF = "pref_content_rating";
const PREF_SHOW_AS_VOLUMES = "show_as_volumes";
const PREF_MERGE_CHAPTERS = "merge_chapters";
const PREF_PREFER_OFFICIAL = "prefer_official";
const PREF_SOLVE_CAPTCHA = "solve_captcha";
const SUMMARY_MSG = "Requires Chapter List Refresh to Apply";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default class MangaFire extends KeiSource {
  private get langCode(): string {
    switch (this.lang) {
      case "es-419":
        return "es-la";
      case "pt-BR":
        return "pt-br";
      default:
        return this.lang;
    }
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .rateLimit(2)
      .addInterceptor(new VrfSigner().interceptor())
      .addChainInterceptor(challengeSolverInterceptor(() => this.solveCaptcha));
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Accept", "application/json");
    return headers;
  }

  private readonly parseBodyFragment = (html: string): Document => parseHtml(this.host.load, html, this.baseUrl);

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/titles`).newBuilder();
    url.addQueryParameter("order[views_30d]", "desc");
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", "50");
    new ContentRatingFilter(this.contentRating).addToUri(url);
    return this.parseMangaList(await this.client.get(url.build().toString()));
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/titles`).newBuilder();
    url.addQueryParameter("order[chapter_updated_at]", "desc");
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", "50");
    new ContentRatingFilter(this.contentRating).addToUri(url);
    return this.parseMangaList(await this.client.get(url.build().toString()));
  }

  private parseMangaList(response: { parseAs<T>(): T }): MangasPage {
    const data = response.parseAs<ApiResponse<MangaDto>>();
    const mangas = (data.items ?? []).map(mangaDtoToSManga);
    return new MangasPage(mangas, data.meta?.hasNext ?? false);
  }

  // ============================== Search ===============================

  // LinkedHashMap with removeEldestEntry: size > 20
  private readonly authorIdCache = new Map<string, string | null>();

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const authorQuery = (firstInstanceOrNull(filters, AuthorFilter)?.state ?? "").trim();
    let authorId: string | null = null;

    if (authorQuery.trim() !== "") {
      // getOrPut: a cached null counts as absent and is looked up again
      authorId = this.authorIdCache.get(authorQuery) ?? null;
      if (authorId === null) {
        const tagUrl = toHttpUrl(`${this.baseUrl}/api/tags`).newBuilder().addQueryParameter("keyword", authorQuery).build();
        const tags = (await this.client.get(tagUrl.toString())).parseAs<TagResponse>();
        const tag = (tags.data ?? []).find((it) => it.type === "author" || it.type === "artist");
        authorId = tag !== undefined ? String(tag.id) : null;
        this.authorIdCache.set(authorQuery, authorId);
        if (this.authorIdCache.size > 20) this.authorIdCache.delete(this.authorIdCache.keys().next().value!);
      }

      if (authorId === null) {
        return new MangasPage([], false);
      }
    }

    const url = toHttpUrl(`${this.baseUrl}/api/titles`).newBuilder();
    if (query.trim() !== "") url.addQueryParameter("keyword", query.trim());
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", "50");
    if (authorId !== null) url.addQueryParameter("authors[]", authorId);
    filters.filter(isUriFilter).forEach((it) => it.addToUri(url));

    return this.parseMangaList(await this.client.get(url.build().toString()));
  }

  // ============================== Details ==============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.hostname !== new URL(this.baseUrl).hostname || segments.length < 2) return null;
    return this.fetchMangaDetails(this.getHid(segments[1]));
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const hid = this.getHid(manga.url);
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(hid) : manga, fetchChapters ? this.fetchChapters(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(hid: string): Promise<SManga> {
    const res = (await this.client.get(`${this.baseUrl}/api/titles/${hid}`)).parseAs<MangaDetailsResponse>();
    return mangaDetailsToSManga(res.data, this.parseBodyFragment);
  }

  private async fetchChapters(manga: SManga): Promise<SChapter[]> {
    let displayVolumes = this.showAsVolumes;
    const chapters: SChapter[] = [];

    const hid = this.getHid(manga.url);

    if (displayVolumes) {
      const url = `${this.baseUrl}/api/titles/${hid}/volumes`;
      const volumes = (await this.client.get(url)).parseAs<ApiResponse<VolumeDto>>().items ?? [];
      if (volumes.length > 0) {
        volumes.filter((it) => it.language === this.langCode).forEach((it) => chapters.push(volumeToSChapter(it, manga.url)));
      } else {
        displayVolumes = false; // Fallback to chapter display
      }
    }

    if (!displayVolumes) {
      (await this.fetchAllChapters(hid)).forEach((it) => chapters.push(chapterToSChapter(it, manga.url, this.langCode)));
    }

    if (!displayVolumes && this.mergeChapters) {
      const preferOfficial = this.preferOfficial;
      const sorted = [...chapters].sort((a, b) => {
        const key = (c: SChapter) => {
          const isOfficial = c.scanlator!.toLowerCase() === "official";
          return preferOfficial ? !isOfficial : isOfficial;
        };
        return Number(key(a)) - Number(key(b));
      });
      const seen = new Set<number>();
      const distinct = sorted.filter((c) => (seen.has(c.chapter_number) ? false : (seen.add(c.chapter_number), true)));
      return distinct.sort((a, b) => b.chapter_number - a.chapter_number);
    }
    return chapters;
  }

  private async fetchAllChapters(hid: string): Promise<ChapterDto[]> {
    const chaptersUrl = (page: number) =>
      toHttpUrl(`${this.baseUrl}/api/titles/${hid}/chapters`)
        .newBuilder()
        .addQueryParameter("language", this.langCode)
        .addQueryParameter("sort", "number")
        .addQueryParameter("order", "desc")
        .addQueryParameter("page", String(page))
        .addQueryParameter("limit", "200")
        .build()
        .toString();
    const firstData = (await this.client.get(chaptersUrl(1))).parseAs<ApiResponse<ChapterDto>>();
    const lastPage = firstData.meta?.lastPage ?? 1;

    const allItems: ChapterDto[] = [...(firstData.items ?? [])];

    if (lastPage > 1) {
      const deferred = Array.from({ length: lastPage - 1 }, (_, i) => this.client.get(chaptersUrl(i + 2)).then((r) => r.parseAs<ApiResponse<ChapterDto>>().items ?? []));
      (await Promise.all(deferred)).forEach((it) => allItems.push(...it));
    }

    return allItems;
  }

  // supportRelatedMangasBySearch = true: Komikku-only, the reader does not ask for related titles

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const segments = new URL(this.baseUrl + chapter.url).pathname.slice(1).split("/");
    const last = segments[segments.length - 1];

    let url: string;
    if (segments.includes("volume")) {
      url = `${this.baseUrl}/api/volumes/${last}`;
    } else {
      const head = last.split("-")[0];
      const chapterId = /^-?\d+$/.test(head) ? Number(head) : null;
      if (chapterId === null) throw new Error("Refresh manga");
      url = `${this.baseUrl}/api/chapters/${chapterId}`;
    }

    const data = (await this.client.get(url)).parseAs<PagesResponse>();
    return data.data.pages.map((page, index) => new Page(index, "", page.url));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new ContentRatingFilter(this.contentRating),
      new Filter.Separator(),
      new TypeFilter(),
      new Filter.Separator(),
      new GenreModeFilter(),
      new GenreFilter(),
      new Filter.Separator(),
      new ThemeFilter(),
      new Filter.Separator(),
      new StatusFilter(),
      new Filter.Separator(),
      new AuthorFilter(),
      new YearFromFilter(),
      new YearToFilter(),
      new MinChapterFilter(),
      new Filter.Separator(),
      new SortFilter(),
    );
  }

  // ============================= Utilities =============================

  private getHid(url: string): string {
    const lastPart = url.replace(/\/$/, "").split("/").pop()!;
    if (lastPart.includes(".")) return lastPart.slice(lastPart.lastIndexOf(".") + 1);
    if (lastPart.includes("-")) return lastPart.slice(0, lastPart.indexOf("-"));
    return lastPart;
  }

  // ========================= Preferences =========================

  private get contentRating(): string[] {
    return this.preferences.getStringSet(CONTENT_RATING_PREF, []);
  }
  private get showAsVolumes(): boolean {
    return this.preferences.getBoolean(PREF_SHOW_AS_VOLUMES, false);
  }
  private get mergeChapters(): boolean {
    return this.preferences.getBoolean(PREF_MERGE_CHAPTERS, false);
  }
  private get preferOfficial(): boolean {
    return this.preferences.getBoolean(PREF_PREFER_OFFICIAL, true);
  }
  private get solveCaptcha(): boolean {
    return this.preferences.getBoolean(PREF_SOLVE_CAPTCHA, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const ratings = new MultiSelectListPreference(screen.context);
    ratings.key = CONTENT_RATING_PREF;
    ratings.title = "Content Rating (All by default)";
    ratings.entries = CONTENT_RATINGS.map(capitalize);
    ratings.entryValues = [...CONTENT_RATINGS];
    ratings.summary = this.contentRating.map(capitalize).join(", ");
    ratings.setDefaultValue([]);
    screen.addPreference(ratings);

    const volumes = new SwitchPreferenceCompat(screen.context);
    volumes.key = PREF_SHOW_AS_VOLUMES;
    volumes.title = "Prefer Volume Release";
    volumes.summary = SUMMARY_MSG;
    volumes.setDefaultValue(false);
    screen.addPreference(volumes);

    const merge = new SwitchPreferenceCompat(screen.context);
    merge.key = PREF_MERGE_CHAPTERS;
    merge.title = "Merge duplicate chapters";
    merge.summary = SUMMARY_MSG;
    merge.setDefaultValue(false);
    screen.addPreference(merge);

    // setEnabled(mergeChapters) / the change listener that toggles it: the app's preference form has no enabled state
    const official = new SwitchPreferenceCompat(screen.context);
    official.key = PREF_PREFER_OFFICIAL;
    official.title = "Prefer official chapters";
    official.setDefaultValue(true);
    screen.addPreference(official);

    const captcha = new SwitchPreferenceCompat(screen.context);
    captcha.key = PREF_SOLVE_CAPTCHA;
    captcha.title = "Automatically solve shape-selecting captcha";
    captcha.setDefaultValue(false);
    screen.addPreference(captcha);
  }
}
