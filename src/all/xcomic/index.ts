// Port of keiyoushi/extensions-source src/all/xcomic/XCOMIC.kt
import {
  EditTextPreference,
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  PreferenceScreen,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  graphQLBody,
  parseGraphQLAs,
  parseHtml,
  str,
  substringAfter,
  substringBefore,
  type Response,
} from "../../../sdk/index.ts";
import {
  chapterToSChapter,
  comicToSManga,
  hasNextPage,
  isLive,
  toMarkdownLinks,
  toMarkdownUrls,
  type ChapterListData,
  type ChapterListUniqData,
  type ChapterPagesData,
  type ComicNode,
  type ComicNodeData,
  type ComicProbeData,
  type ComicProbeEnvelope,
  type TitleBrowseData,
  type TitleBrowseNode,
  type TitleNodeData,
  type TitleNodeEnvelope,
} from "./dto.ts";
import {
  ContentRatingFilter,
  DemographicFilter,
  FormatFilter,
  GenreExModeFilter,
  GenreGroupFilter,
  GenreInModeFilter,
  MaxChapterFilter,
  MinChapterFilter,
  OriginalLanguageFilter,
  OriginalStatusFilter,
  SortFilter,
  TranslationLanguageFilter,
  TypeFilter,
  YearFilter,
  languages,
} from "./filters.ts";
import { CHAPTER_LIST_QUERY, CHAPTER_PAGES_QUERY, CHAPTER_UNIQ_LIST_QUERY, COMIC_NODE_QUERY, COMIC_PROBE_QUERY, TITLE_BROWSE_QUERY, TITLE_NODE_QUERY } from "./queries.ts";

const REMOVE_TITLE_VERSION_PREF = "REMOVE_TITLE_VERSION";
const REMOVE_TITLE_CUSTOM_PREF = "REMOVE_TITLE_CUSTOM";
const IGNORE_GENRE_BLOCKLIST_PREF = "IGNORE_GENRE_BLOCKLIST";
const DEDUPLICATE_CHAPTERS_PREF = "DEDUPLICATE_CHAPTERS";

const idQueryRegex = /^id\s*:?\s*([a-zA-Z0-9-_]+)\s*$/i;

// Maximum is 48
const BROWSE_PAGE_SIZE = 12;

// Fan-out shape: 3 titles concurrently, 5 comic probes each
const TITLES_IN_FLIGHT = 3;
const COMIC_PROBES_PER_TITLE = 5;

const MEMO_FETCHED_AT = "chaptersFetchedAt"; // when we last pulled the list
const MEMO_LAST_PUBLIC = "lastPublicAt"; // title.chapLastPublicAt at that time

const titleRegex =
  /\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|𖤍.+?𖤍|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/Official|\/ Official/gi;

const chunked = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
/** sortedByDescending: stable, like Kotlin's. */
const sortedByDescending = <T>(list: T[], key: (it: T) => number) => [...list].sort((a, b) => key(b) - key(a));
const toIntOrNull = (s: string) => (/^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

class DefaultSortFilter extends Filter.Header {
  constructor(readonly sort: string) {
    super("");
  }
}

interface ChapterListPage {
  chapters: SChapter[];
  total: number | null | undefined;
  hasNextPage: boolean;
}

type Row = [titleId: string, comicId: string, probe: ComicProbeData];

export default class XCOMIC extends KeiSource {
  private readonly probeCache = new Map<string, ComicProbeData>();

  private readonly titleFreshness = new Map<string, number>();

  // ========================= Popular & Latest ==========================
  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new DefaultSortFilter("field_score")));
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new DefaultSortFilter("field_update")));
  }

  private get extLang(): string | null {
    return this.lang === "all" ? null : this.mapLangCode(this.lang);
  }

  private async postQuery(query: string, variables: unknown): Promise<Response> {
    const headers = this.headersBuilder();
    headers.set("Content-Type", "application/json; charset=utf-8");
    return this.client.post(`${this.baseUrl}/query/`, headers, graphQLBody({ query, variables }));
  }

  // ============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const idMatch = idQueryRegex.exec(query.trim());
    if (idMatch != null) {
      const id = substringBefore(idMatch[1], "-");
      const extLang = this.extLang;

      const node = await this.fetchTitleNode(id);
      if (node != null) {
        const browseNode = this.toBrowseNode(node);
        const rows = await this.flattenTitle(browseNode, extLang, true);
        if (rows.length) {
          const mangas = rows.map(([tid, cid, p]) => this.toBrowseSManga(p, this.baseUrl, tid, cid, browseNode, extLang, (s) => this.cleanTitleIfNeeded(s)));
          return new MangasPage(mangas, false);
        }
      }
      try {
        return new MangasPage([await this.legacyComicDetails(id)], false);
      } catch {
        return new MangasPage([], false);
      }
    }

    let sort: string | null = null;
    let contentRating: string[] = [];
    let types: string[] = [];
    let demographics: string[] = [];
    const incGenres: string[] = [];
    const excGenres: string[] = [];
    let incGenresMode: string | null = null;
    let excGenresMode: string | null = null;
    let releaseYearMin: number | null = null;
    let releaseYearMax: number | null = null;
    let incOLangs: string[] = [];
    let incTLangs: string[] = this.lang === "all" ? [] : [this.mapLangCode(this.lang)];
    let origStatus: string[] = [];
    let chapMin = "";
    let chapMax = "";

    for (const filter of filters) {
      if (filter instanceof DefaultSortFilter) sort = filter.sort;
      else if (filter instanceof ContentRatingFilter) contentRating = filter.selected;
      else if (filter instanceof TypeFilter) types = filter.selected;
      else if (filter instanceof DemographicFilter) demographics = filter.selected;
      else if (filter instanceof FormatFilter || filter instanceof GenreGroupFilter) {
        incGenres.push(...filter.included);
        excGenres.push(...filter.excluded);
      } else if (filter instanceof GenreInModeFilter) incGenresMode = filter.selected;
      else if (filter instanceof GenreExModeFilter) excGenresMode = filter.selected;
      else if (filter instanceof YearFilter) {
        const year = filter.state;
        if (year) {
          if (year.includes("-")) {
            releaseYearMin = toIntOrNull(substringBefore(year, "-").trim());
            releaseYearMax = toIntOrNull(substringAfter(year, "-").trim());
          } else {
            const y = toIntOrNull(year.trim());
            releaseYearMin = y;
            releaseYearMax = y;
          }
        }
      } else if (filter instanceof OriginalLanguageFilter) incOLangs = filter.selected;
      else if (filter instanceof TranslationLanguageFilter) {
        if (filter.selected.length && this.lang === "all") incTLangs = filter.selected;
      } else if (filter instanceof OriginalStatusFilter) origStatus = filter.selected;
      else if (filter instanceof SortFilter) sort = filter.selected;
      else if (filter instanceof MinChapterFilter) chapMin = filter.state.trim();
      else if (filter instanceof MaxChapterFilter) chapMax = filter.state.trim();
    }
    // NOTE: no UploadStatusFilter — Title_Browse_Select has no siteStatus.

    const chapMinNum = toIntOrNull(chapMin);
    const chapMaxNum = toIntOrNull(chapMax);

    const chapCount =
      chapMinNum != null && chapMaxNum != null
        ? `${Math.max(chapMinNum, 1)}-${Math.max(chapMaxNum, 1)}`
        : chapMinNum != null
          ? `${Math.max(chapMinNum, 1)}`
          : chapMaxNum != null
            ? `1-${Math.max(chapMaxNum, 1)}`
            : null;

    // ApiTitleBrowseVariables; kotlinx leaves out fields at their default (encodeDefaults = false)
    const nonDefault = (list: string[]) => (list.length ? list : undefined);
    const variables = {
      word: query || undefined,
      page,
      size: BROWSE_PAGE_SIZE,
      init: (page - 1) * BROWSE_PAGE_SIZE,
      sortby: sort,
      where: "browse",
      releaseYearMin,
      releaseYearMax,
      incTypes: nonDefault(types),
      incDemographics: nonDefault(demographics),
      incContentRatings: nonDefault(contentRating),
      incOLangs: nonDefault(incOLangs),
      incTLangs: nonDefault(incTLangs),
      incGenres: nonDefault(incGenres),
      excGenres: nonDefault(excGenres),
      incGenresMode: incGenresMode || null,
      excGenresMode: excGenresMode || null,
      origStatus: nonDefault(origStatus),
      chapCount: chapCount || null,
      ignoreGlobalGenres: this.isIgnoreGenreBlocklist() || undefined,
    };

    const response = await this.postQuery(TITLE_BROWSE_QUERY, { select: variables });
    return this.parseSearchManga(response);
  }

  /**
   * Flatten: title page → concurrent per-title probing (TITLES_IN_FLIGHT
   * titles at a time, COMIC_PROBES_PER_TITLE probes each) → one row per
   * live source in the extension language.
   */
  private async parseSearchManga(response: Response): Promise<MangasPage> {
    const titles = parseGraphQLAs<TitleBrowseData>(response.text()).get_title_browse_items ?? [];
    if (!titles.length) return new MangasPage([], false);
    const extLang = this.extLang;

    const flattened: Row[] = [];
    for (const batch of chunked(titles, TITLES_IN_FLIGHT)) {
      for (const rows of await Promise.all(batch.map((t) => this.flattenTitle(t, extLang)))) flattened.push(...rows);
    }

    const mangas = flattened.map(([titleId, cid, p]) => {
      const t = titles.find((it) => it.id === titleId)!;
      return this.toBrowseSManga(p, this.baseUrl, titleId, cid, t, extLang, (s) => this.cleanTitleIfNeeded(s));
    });

    return new MangasPage(mangas, titles.length >= BROWSE_PAGE_SIZE);
  }

  private async flattenTitle(t: TitleBrowseNode, extLang: string | null, forceFresh = false): Promise<Row[]> {
    const titleId = t.id?.trim() ? t.id : null;
    if (titleId == null) return [];
    const ids = (t.data?.comic_ids ?? []).filter((it) => it.trim());
    if (!ids.length) return [];

    const nowPublic = t.data?.chap_last_public_at ?? 0;
    const unchanged = !forceFresh && nowPublic >= 1 && nowPublic <= (this.titleFreshness.get(titleId) ?? 0);

    const wanted = (p: ComicProbeData) => isLive(p) && (extLang == null || p.translatedLanguage === extLang);

    if (unchanged && ids.every((it) => this.probeCache.has(it))) {
      const rows = ids.flatMap((cid): Row[] => {
        const p = this.probeCache.get(cid);
        return p && wanted(p) ? [[titleId, cid, p]] : [];
      });
      return sortedByDescending(rows, (it) => it[2].chaps_normal ?? 0);
    }

    const probes = new Map<string, ComicProbeData>();
    for (const chunk of chunked(ids, COMIC_PROBES_PER_TITLE)) {
      await Promise.all(
        chunk.map(async (cid) => {
          const p = await this.fetchComicProbe(cid);
          if (p != null) probes.set(cid, p);
        }),
      );
    }
    if (nowPublic > 0) this.titleFreshness.set(titleId, nowPublic);
    const rows = [...probes.entries()].filter(([, p]) => wanted(p)).map(([cid, p]): Row => [titleId, cid, p]);
    return sortedByDescending(rows, (it) => it[2].chaps_normal ?? 0);
  }

  // ============================== Filters ==============================
  override get supportsFilterFetching(): boolean {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const response = await this.client.get(`${this.baseUrl}/search`);
    const document = response.asJsoup();

    const filterMap: Record<string, { name: string; value: string }[]> = { genres: [], types: [], demographics: [], contentRatings: [] };

    for (const details of document.select("details.group")) {
      const summaryText = details.selectFirst("summary")?.text()?.toLowerCase();
      if (summaryText == null) continue;
      const container = details.selectFirst("div.columns-2") ?? details.selectFirst("div.w-full.overflow-y-auto");
      const category = summaryText.includes("genre")
        ? "genres"
        : summaryText.includes("type")
          ? "types"
          : summaryText.includes("demographic")
            ? "demographics"
            : summaryText.includes("content rating")
              ? "contentRatings"
              : null;

      if (category != null) {
        container?.select("div")?.forEach((div) => {
          const slug = div.attr(":");
          const name = div.selectFirst("span")?.text()?.trim();
          if (slug && name) filterMap[category].push({ name, value: slug });
        });
      }
    }

    if (!filterMap.genres.length && !filterMap.types.length) throw new Error("Failed to fetch filters dynamically");

    const cleanMap: typeof filterMap = {};
    for (const [k, v] of Object.entries(filterMap)) {
      const seen = new Set<string>();
      cleanMap[k] = v.filter((it) => !seen.has(it.value) && (seen.add(it.value), true));
    }
    return cleanMap;
  }

  override getFilterList(data: unknown = null): FilterList {
    const parsed = (data ?? {}) as Record<string, Record<string, string>[] | undefined>;

    const extractList = (key: string): [string, string][] =>
      (parsed[key] ?? []).flatMap((map): [string, string][] => {
        const name = map.name;
        const value = map.value;
        return name != null && value != null ? [[name, value]] : [];
      });

    const dynamicGenres = extractList("genres");
    const dynamicTypes = extractList("types");
    const dynamicDemographics = extractList("demographics");
    const dynamicContentRatings = extractList("contentRatings");

    const list: Filter[] = [];
    list.push(new SortFilter());
    if (dynamicContentRatings.length) list.push(new ContentRatingFilter(dynamicContentRatings));
    if (dynamicTypes.length) list.push(new TypeFilter(dynamicTypes));
    list.push(new Filter.Separator());
    if (dynamicDemographics.length) list.push(new DemographicFilter(dynamicDemographics));
    if (dynamicGenres.length) list.push(new GenreGroupFilter(undefined, dynamicGenres));
    list.push(new FormatFilter());
    list.push(new GenreInModeFilter());
    list.push(new GenreExModeFilter());
    list.push(new Filter.Separator());
    list.push(new OriginalStatusFilter());
    list.push(new OriginalLanguageFilter());
    if (this.lang === "all") list.push(new TranslationLanguageFilter());
    list.push(new MinChapterFilter());
    list.push(new MaxChapterFilter());
    list.push(new YearFilter());
    return list;
  }

  // ============================== Details ==============================
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let details: SManga;
    let gate: boolean;
    if (fetchDetails) {
      [details, gate] = await this.getMangaDetails(manga);
    } else {
      details = manga;
      gate = false;
    }
    const chapterList = fetchChapters && !gate ? await this.getChapterList(manga) : chapters;
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchTitleNode(id: string): Promise<TitleNodeData | null> {
    try {
      return parseGraphQLAs<TitleNodeEnvelope>((await this.postQuery(TITLE_NODE_QUERY, { id })).text()).get_title_titleNode?.data ?? null;
    } catch {
      return null;
    }
  }

  private async fetchComicNode(id: string): Promise<ComicNode | null> {
    try {
      return parseGraphQLAs<ComicNodeData>((await this.postQuery(COMIC_NODE_QUERY, { id })).text()).get_comicNode.data ?? null;
    } catch {
      return null;
    }
  }

  private async fetchComicProbe(id: string): Promise<ComicProbeData | null> {
    const cached = this.probeCache.get(id);
    if (cached) return cached;
    let fetched: ComicProbeData | null = null;
    try {
      fetched = parseGraphQLAs<ComicProbeEnvelope>((await this.postQuery(COMIC_PROBE_QUERY, { id })).text()).get_comicNode?.data ?? null;
    } catch {
      fetched = null;
    }
    if (fetched != null) this.probeCache.set(id, fetched);
    return fetched;
  }

  /**
   * Browse rows pin their source in the URL ("<titleId>:<sourceId>").
   * Unpinned (legacy/id:) URLs fall back to pick-over-comic_ids,
   * then to the legacy comic path.
   */
  private async getMangaDetails(manga: SManga): Promise<[SManga, boolean]> {
    const extLang = this.extLang;
    const [titleId, pinned] = this.splitMangaUrl(manga.url);

    const title = await this.fetchTitleNode(titleId);
    if (title == null) {
      const legacy = await this.legacyComicDetails(manga.url);
      legacy.url = manga.url;
      return [legacy, false];
    }
    const resolved = title.is_merged === true && title.merged_to && title.merged_to !== titleId ? ((await this.fetchTitleNode(title.merged_to)) ?? title) : title;

    let picked: [string, ComicNode] | null = null;
    if (pinned != null) {
      const node = await this.fetchComicNode(pinned);
      if (node && isLive(node)) picked = [pinned, node];
    }
    picked ??= await this.pickComic((resolved.comic_ids ?? []).filter((it) => it.trim()), extLang);
    if (picked == null) throw new Error(`Failed to load '${this.lang}' uploads for this source`);
    const [comicId, comic] = picked;

    const sourceLatest = comic.chapterNode_up_to?.data?.datePublic ?? 0;
    const prevFetchedAt = Number(str(manga.memo[MEMO_FETCHED_AT]) ?? "") || 0;
    const prevLastPublic = Number(str(manga.memo[MEMO_LAST_PUBLIC]) ?? "") || 0;

    const chaptersCurrent =
      prevFetchedAt > 0 &&
      (title.chap_last_public_at ?? 0) <= prevLastPublic && // main unchanged
      sourceLatest <= prevFetchedAt; // our source unchanged

    const base = comicToSManga(comic, this.baseUrl, (s) => this.cleanTitleIfNeeded(s));
    base.url = manga.url;
    this.overlayOnto(resolved, base, this.baseUrl);

    const labelText = comic.subName?.trim() ? comic.subName : str(manga.memo.label)?.trim() ? str(manga.memo.label) : undefined;
    if (labelText != null) base.title = `${base.title} · ${this.unescapeHtml(labelText)}`;

    const memo: Record<string, unknown> = {};
    if (base.memo.urlPath != null) memo.urlPath = base.memo.urlPath;
    memo.sourceId = comicId;
    if (!chaptersCurrent) {
      memo[MEMO_FETCHED_AT] = String(Date.now());
      memo[MEMO_LAST_PUBLIC] = String(title.chap_last_public_at ?? 0);
    }
    base.memo = memo;
    return [base, chaptersCurrent];
  }

  /** Probes comic_ids (COMIC_PROBES_PER_TITLE at a time); full nodes. */
  private async pickComic(ids: string[], extLang: string | null): Promise<[string, ComicNode] | null> {
    if (!ids.length) return null;
    const all: [string, ComicNode][] = [];
    for (const chunk of chunked(ids, COMIC_PROBES_PER_TITLE)) {
      const got = await Promise.all(chunk.map(async (cid) => ((node) => (node ? ([cid, node] as [string, ComicNode]) : null))(await this.fetchComicNode(cid))));
      for (const it of got) if (it) all.push(it);
    }
    const nodes = all.filter((it) => isLive(it[1]));
    const matching = nodes.filter((it) => extLang == null || it[1].translatedLanguage === extLang);
    // maxByOrNull: the first of the largest
    let best: [string, ComicNode] | null = null;
    for (const it of matching) if (best == null || (it[1].chaps_normal ?? 0) > (best[1].chaps_normal ?? 0)) best = it;
    return best ?? (extLang == null ? (nodes[0] ?? null) : null);
  }

  private async legacyComicDetails(id: string): Promise<SManga> {
    const comic = await this.fetchComicNode(id);
    if (comic == null) throw new Error(`Comic not found: ${id}`);
    const m = comicToSManga(comic, this.baseUrl, (s) => this.cleanTitleIfNeeded(s));
    if (comic.subName?.trim()) m.title = `${m.title} · ${this.unescapeHtml(comic.subName)}`;
    return m;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const seg = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (seg.length < 2) return null;
    const id = substringBefore(seg[1], "-");
    switch (seg[0]) {
      case "title": {
        const m = SManga.create();
        m.url = id;
        return this.getMangaDetails(m).then(
          (it) => it[0],
          () => null,
        );
      }
      case "source":
        return this.legacyComicDetails(id).catch(() => null);
      default:
        return null;
    }
  }

  override getMangaUrl(manga: SManga): string {
    const urlPath = str(manga.memo.urlPath);
    if (urlPath != null) return `${this.baseUrl}${urlPath}`;
    return manga.url.includes(":") ? `${this.baseUrl}/title/${substringBefore(manga.url, ":")}` : `${this.baseUrl}/source/${manga.url}`;
  }

  // ============================= Chapters ==============================
  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const comicId = await this.resolveComicId(manga);
    if (comicId == null) return [];
    const deduplicate = this.isDeduplicateChapters();
    const pageSize = deduplicate ? 1000 : 100;

    const firstPage = await this.fetchChapterListPage(comicId, 1, deduplicate, pageSize);
    const allChapters = [...firstPage.chapters];
    const totalItems = firstPage.total ?? 0;

    if (totalItems > pageSize && firstPage.hasNextPage) {
      const totalPages = Math.trunc((totalItems + (pageSize - 1)) / pageSize);
      const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      for (const batch of chunked(pages, 3)) {
        const results = await Promise.all(batch.map(async (pageNum) => (await this.fetchChapterListPage(comicId, pageNum, deduplicate, pageSize)).chapters));
        allChapters.push(...results.flat());
      }
    }

    return allChapters;
  }

  /** URL pin → memo pin → title's comic_ids probe → legacy fallback. */
  private async resolveComicId(manga: SManga): Promise<string | null> {
    const [titleId, pinned] = this.splitMangaUrl(manga.url);
    if (pinned != null) return pinned;
    const memoId = str(manga.memo.sourceId);
    if (memoId != null) return memoId;
    const ids = (await this.fetchTitleNode(titleId))?.comic_ids?.filter((it) => it.trim());
    if (ids == null) return manga.url; // legacy entry: url is already a comic id
    return (await this.pickComic(ids, this.extLang))?.[0] ?? null;
  }

  private async fetchChapterListPage(comicId: string, page: number, deduplicate: boolean, pageSize: number): Promise<ChapterListPage> {
    // ApiChapterListSelect: sortby keeps its default "chapter_desc", which kotlinx does not encode
    const select = { comic_id: comicId, page, size: pageSize };

    const query = deduplicate ? CHAPTER_UNIQ_LIST_QUERY : CHAPTER_LIST_QUERY;
    const response = await this.postQuery(query, { select });

    const data = deduplicate ? parseGraphQLAs<ChapterListUniqData>(response.text()).get_comic_chapterList_uniqList : parseGraphQLAs<ChapterListData>(response.text()).get_comic_chapterList_fullList;

    return {
      chapters: data.items.map((it) => chapterToSChapter(it.data)),
      total: data.paging.total,
      hasNextPage: hasNextPage(data.paging),
    };
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = this.getChapterId(chapter.url);

    const response = await this.postQuery(CHAPTER_PAGES_QUERY, { id: chapterId });
    const data = parseGraphQLAs<ChapterPagesData>(response.text()).get_chapterNode.data;

    return data.imageUrls.map((url, index) => new Page(index, "", url.startsWith("http") ? url : `${this.baseUrl}${url}`));
  }

  override getChapterUrl(chapter: SChapter): string {
    const urlPath = str(chapter.memo.urlPath);
    return urlPath != null ? `${this.baseUrl}${urlPath}` : `${this.baseUrl}/chapter/${chapter.url}`;
  }

  private getChapterId(url: string): string {
    return url;
  }

  // ==================== URL splitting + browse row mapper ====================
  private splitMangaUrl(url: string): [string, string | null] {
    const i = url.indexOf(":");
    return i < 0 ? [url, null] : [url.slice(0, i), url.slice(i + 1)];
  }

  /**
   * One browse row per source: "Title · <subName> · N ch" (+ [lang] when
   * language is "all"). Label = subName only.
   */
  private toBrowseSManga(p: ComicProbeData, baseUrl: string, titleId: string, comicId: string, t: TitleBrowseNode, extLang: string | null, cleanTitle: (s: string) => string): SManga {
    const m = SManga.create();
    m.url = `${titleId}:${comicId}`;
    const displayTitle = cleanTitle(t.data?.title ?? "").trim() ? cleanTitle(t.data?.title ?? "") : titleId;
    let title = displayTitle;
    if (p.subName?.trim()) title += ` · ${this.unescapeHtml(p.subName)}`;
    if (extLang == null && p.translatedLanguage != null) title += ` [${this.langDisplayName(p.translatedLanguage)}]`;
    m.title = title;

    m.memo = {
      titleId,
      sourceId: comicId,
      label: p.subName ?? "",
      tlang: p.translatedLanguage ?? "",
      lastPublicAt: "0",
    };

    const cover = t.data?.cover_local_url ?? t.data?.cover_url ?? p.urlCover;
    m.thumbnail_url = cover != null ? (cover.startsWith("http") ? cover : `${baseUrl}${cover}`) : undefined;
    return m;
  }

  // =================== Title overlay (main identity) ====================
  private overlayOnto(td: TitleNodeData, m: SManga, baseUrl: string) {
    const tTitle = td.title;
    const tAlt = (td.alt_titles ?? []).filter((it): it is string => it != null);
    const tOLang = td.original_language;
    const tLangs = td.translated_languages?.filter((it): it is string => it != null);
    const tYear = td.year;
    const tType = td.type;
    const tDesc = td.description;
    const tCover = td.cover_local_url ?? td.cover_url;
    const tGenres = td.genre_ids ?? [];
    const tDemos = td.demographic_ids ?? [];
    const tCR = td.content_rating_id;
    const tFormats = td.format_ids ?? [];

    const cleaned = this.cleanTitleIfNeeded(tTitle ?? "");
    if (cleaned.trim()) m.title = cleaned;

    if (td.authors?.length) m.author = td.authors.join(", ");
    if (td.artists?.length) m.artist = td.artists.join(", ");

    if (tCover?.trim()) m.thumbnail_url = tCover.startsWith("http") ? tCover : baseUrl + tCover;

    const genre = new Set<string>();
    m.genre
      ?.split(", ")
      .filter((it) => it.trim())
      .forEach((it) => genre.add(it));
    if (tType != null) genre.add(this.toTagCase(tType));
    tDemos.forEach((it) => genre.add(this.toTagCase(it)));
    if (tCR != null) genre.add(this.toTagCase(tCR));
    tGenres.forEach((it) => genre.add(this.toTagCase(it)));
    tFormats.forEach((it) => genre.add(this.toTagCase(it)));
    m.genre = [...genre].join(", ");

    let block = "";
    const meta: string[] = [];
    if (tOLang != null) meta.push("**Original**: " + this.langDisplayName(tOLang));
    if (tLangs?.length) meta.push("**Translated**: " + tLangs.map((it) => this.langDisplayName(it)).join(", "));
    if (tYear != null && tYear > 0) meta.push(`**Released**: ${tYear}`);
    if (tType != null) meta.push("**Type**: " + this.toTagCase(tType));
    if (tDesc?.trim()) meta.push("**Description**:\n" + toMarkdownUrls(tDesc));
    if (td.chap_last_public_at != null && td.chap_last_public_at > 0) meta.push("\n\n**Updated**: " + formatYmd(td.chap_last_public_at));
    const stats: string[] = [];
    if (td.vote_avg != null && td.vote_avg > 0) stats.push("**Score**: " + td.vote_avg.toFixed(1));
    if (td.vote_users != null && td.vote_users > 0) stats.push(`**Votes**: ${td.vote_users}`);
    if (td.total_follows != null && td.total_follows > 0) stats.push(`**Follows**: ${td.total_follows}`);
    if (td.total_comments != null && td.total_comments > 0) stats.push(`**Comments**: ${td.total_comments}`);
    if (td.total_reviews != null && td.total_reviews > 0) stats.push(`**Reviews**: ${td.total_reviews}`);
    if (meta.length) block += meta.join("\n");
    if (stats.length) {
      if (block) block += "\n";
      block += "**Statistics**\n" + stats.join(" · ");
    }
    const alt = [...new Set(tAlt.map((it) => it.trim()).filter((it) => it && it !== tTitle))];
    if (alt.length) {
      if (block) block += "\n";
      block += "**Alternative Titles**:\n" + alt.map((it) => `- ${it}`).join("\n");
    }

    let description = "";
    if (block) description += block + "\n\n---\n\n";
    description += m.description ?? "";
    const tLinks = toMarkdownLinks(td.tracking_sites);
    if (tLinks.length) {
      description += "\n\n**External Links**:\n";
      description += tLinks.map((it) => `- ${it}`).join("\n");
    }
    m.description = description;
  }

  /** Converts a title node into the browse-node shape flattenTitle consumes. */
  private toBrowseNode(td: TitleNodeData): TitleBrowseNode {
    return {
      id: td.id,
      data: {
        title: td.title,
        native_title: td.native_title,
        romanized_title: td.romanized_title,
        original_language: td.original_language,
        translated_languages: td.translated_languages,
        type: td.type,
        chap_last_public_at: td.chap_last_public_at,
        cover_local_url: td.cover_local_url,
        cover_url: td.cover_url,
        comic_ids: td.comic_ids,
      },
    };
  }

  // ============================ Title cleaning ============================
  private cleanTitleIfNeeded(title: string): string {
    let tempTitle = title;
    const customRegex = this.customRemoveTitle();
    if (customRegex) {
      try {
        tempTitle = tempTitle.replace(new RegExp(customRegex, "g"), "");
      } catch {
        // runCatching: an invalid pattern leaves the title as is
      }
    }
    if (this.isRemoveTitleVersion()) tempTitle = tempTitle.replace(titleRegex, "");
    return tempTitle.trim();
  }

  // ============================ Preferences ============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const removeVersion = new SwitchPreferenceCompat(screen.context);
    removeVersion.key = REMOVE_TITLE_VERSION_PREF;
    removeVersion.title = "Remove Version Information From Entry Titles";
    removeVersion.summary =
      "This removes version tags like '(Official)' or '(Yaoi)' from entry titles.\n" + "To update existing entries, enable 'Update library manga titles' in advanced settings and refresh manually.";
    removeVersion.setDefaultValue(false);
    screen.addPreference(removeVersion);

    // Upstream validates the pattern while typing (TextWatcher/Toast); an invalid one is ignored by cleanTitleIfNeeded
    const custom = new EditTextPreference(screen.context);
    custom.key = REMOVE_TITLE_CUSTOM_PREF;
    custom.title = "Custom Regex To Be Removed From Title";
    custom.summary = this.customRemoveTitle();
    custom.setDefaultValue("");
    screen.addPreference(custom);

    const ignore = new SwitchPreferenceCompat(screen.context);
    ignore.key = IGNORE_GENRE_BLOCKLIST_PREF;
    ignore.title = "Ignore WebView Genre Blocklist";
    ignore.setDefaultValue(false);
    screen.addPreference(ignore);

    const dedup = new SwitchPreferenceCompat(screen.context);
    dedup.key = DEDUPLICATE_CHAPTERS_PREF;
    dedup.title = "Deduplicate Chapter List";
    dedup.summary = "Use a deduplicated chapter list from server side.\nNote: May hide other scanlator uploads.";
    dedup.setDefaultValue(true);
    screen.addPreference(dedup);
  }

  private isRemoveTitleVersion(): boolean {
    return this.preferences.getBoolean(REMOVE_TITLE_VERSION_PREF, false);
  }
  private customRemoveTitle(): string {
    return this.preferences.getString(REMOVE_TITLE_CUSTOM_PREF, "")!;
  }
  private isIgnoreGenreBlocklist(): boolean {
    return this.preferences.getBoolean(IGNORE_GENRE_BLOCKLIST_PREF, false);
  }
  private isDeduplicateChapters(): boolean {
    return this.preferences.getBoolean(DEDUPLICATE_CHAPTERS_PREF, true);
  }

  // ========================= Helpers =========================
  private toTagCase(s: string): string {
    return s
      .replace(/_/g, " ")
      .split(" ")
      .map((word) => {
        const w = word.toLowerCase();
        return w ? w[0].toUpperCase() + w.slice(1) : w;
      })
      .join(" ");
  }

  private langDisplayName(code: string): string {
    return languages.find((it) => it[1] === code)?.[0] ?? code.toUpperCase();
  }

  /** Parser.unescapeEntities(this, false): a textarea is RCDATA, so entities are decoded and tags left alone. */
  private unescapeHtml(s: string): string {
    return parseHtml(this.host.load, `<textarea>${s.replace(/<\/textarea/gi, "&lt;/textarea")}</textarea>`, this.baseUrl)
      .selectFirst("textarea")!
      .text();
  }

  private mapLangCode(code: string): string {
    switch (code) {
      case "pt-BR":
        return "pt_br";
      case "es-419":
        return "es_419";
      case "zh-Hant":
        return "zh_hk";
      case "other":
        return "_t";
      default:
        return code;
    }
  }
}

/** SimpleDateFormat("yyyy-MM-dd", Locale.ROOT) in the default zone. */
function formatYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
