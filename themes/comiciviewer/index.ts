// Port of keiyoushi/extensions-source lib-multisrc/comiciviewer/ComiciViewer.kt (+ Dto.kt, Filters.kt, ImageInterceptor.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  extractNextJs,
  parseAs,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  type Chain,
  type ClientBuilder,
  type Host,
  Canvas,
  imageSize,
  type HttpUrl,
  type PreferenceScreen,
} from "../../sdk/index.ts";

const RANKING_PATH = "/ranking/manga";
const SEARCH_PAGE_SIZE = 24;
const SHOW_LOCKED_PREF_KEY = "pref_show_locked_chapters";
const SHOW_CAMPAIGN_LOCKED_PREF_KEY = "pref_show_campaign_locked_chapters";

// Dto.kt

type Json = unknown;
interface RankingImg {
  alt: string;
  src?: string | null;
  srcSet?: string | null;
}
const rankingThumbnail = (img: RankingImg) => (img.srcSet != null ? substringBefore(substringAfterLast(img.srcSet, ", "), " ") : (img.src ?? undefined));

function findImg(e: Json): Record<string, Json> | null {
  if (Array.isArray(e)) {
    for (const it of e) {
      const r = findImg(it);
      if (r) return r;
    }
    return null;
  }
  if (typeof e === "object" && e !== null) {
    const o = e as Record<string, Json>;
    if ("src" in o) return o;
    for (const it of Object.values(o)) {
      const r = findImg(it);
      if (r) return r;
    }
  }
  return null;
}

/** RankingMangaSerializer: each child is a React element tuple; hash is tuple[2], img the first object with "src". */
function rankingToSManga(tuple: Json[]) {
  const img = findImg(tuple)! as unknown as RankingImg;
  const manga = SManga.create();
  manga.url = String(tuple[2]);
  manga.title = img.alt;
  manga.thumbnail_url = rankingThumbnail(img);
  return manga;
}

interface SeriesSummary {
  id: string;
  name: string;
  description?: string | null;
  author?: { name: string }[] | null;
  images?: { url: string }[] | null;
  tag?: { name: string }[] | null;
  isCompleted?: boolean | null;
}
interface SearchApiResponse {
  searchResult: { series: { total: number; series: SeriesSummary[] } };
}
interface Episode {
  id: string;
  title: string;
  datePublished?: number | null;
}
interface ApiResponse {
  series: { summary: SeriesSummary; episodes?: Episode[] };
}
interface DescriptionChild {
  text?: string | null;
  url?: string | null;
  children?: DescriptionChild[] | null;
}
function resolveText(c: DescriptionChild): string | null {
  if (c.text != null) return c.text;
  if (c.children != null) {
    const inner = c.children.map((it) => resolveText(it) ?? "").join("");
    return c.url != null ? `[${inner}](${c.url})` : inner;
  }
  return null;
}

function summaryToSManga(s: SeriesSummary): SManga {
  const manga = SManga.create();
  manga.url = s.id;
  manga.title = s.name;
  manga.author = s.author?.map((it) => it.name).join(", ");
  manga.artist = manga.author;
  manga.description =
    s.description && s.description.trim()
      ? parseAs<{ children: DescriptionChild[] }[]>(s.description)
          .map((node) => node.children.map((it) => resolveText(it) ?? "").join(""))
          .join("\n")
      : undefined;
  manga.genre = s.tag?.map((it) => it.name).join(", ");
  manga.thumbnail_url = s.images?.[0]?.url;
  manga.status = s.isCompleted === true ? SManga.COMPLETED : SManga.ONGOING;
  return manga;
}

interface EpisodeAccessDto {
  episodeId: string;
  hasAccess: boolean;
  accessType: string;
}
const isLocked = (a: EpisodeAccessDto) => !a.hasAccess;
const needsLogin = (a: EpisodeAccessDto) => isLocked(a) && a.accessType === "memberOnlyFree";

function episodeToSChapter(e: Episode, access: EpisodeAccessDto | undefined): SChapter {
  const chapter = SChapter.create();
  chapter.url = e.id;
  const lock = access && needsLogin(access) ? "➡️ " : access && isLocked(access) ? "🔒 " : "";
  chapter.name = lock + e.title;
  if (e.datePublished != null) chapter.date_upload = e.datePublished * 1000;
  if (access && needsLogin(access)) chapter.memo = { login: true };
  return chapter;
}

interface AccessApiResponse {
  seriesAccess: { episodeAccesses: EpisodeAccessDto[] };
}
interface EpisodeContent {
  type: string;
  viewerId?: string | null;
  url?: string | null;
}
interface EpisodeDetailsApiResponse {
  episode: { content: EpisodeContent[]; contentId: number };
}
interface ViewerResponse {
  result: { imageUrl: string; scramble: string; sort: number }[];
  totalPages: number;
}
interface UserInfoApiResponse {
  user?: { id: string } | null;
}

// Filters.kt

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  get value() {
    return this.vals[this.state][1];
  }
}
export class CategoryFilter extends SelectFilter {
  constructor(options: [string, string][]) {
    super("Filter by", options);
  }
}

// ImageInterceptor.kt

const GRID_SIZE = 4;

async function imageIntercept(host: Host, chain: Chain): Promise<Response> {
  const request = chain.request();
  const response = await chain.proceed(request);
  const scrambleData = toHttpUrl(request.url).fragment;

  if (!scrambleData || !scrambleData.startsWith("scramble=") || !response.isSuccessful) return response;

  const tiles = substringAfter(scrambleData, "scramble=")
    .replace(/^\[+|\]+$/g, "")
    .split(",")
    .map((it) => Number.parseInt(decodeURIComponent(it).trim(), 10));
  const body = await unscrambleImage(host, response.bytes(), tiles);
  return new Response(host, { status: response.code, url: response.url, headers: { "content-type": "image/jpeg" }, body });
}

async function unscrambleImage(host: Host, bytes: Uint8Array, tiles: number[]): Promise<Uint8Array> {
  const { width, height } = await imageSize(host, bytes);

  const canvas = new Canvas(host, width, height);

  const tileWidth = Math.trunc(width / GRID_SIZE);
  const tileHeight = Math.trunc(height / GRID_SIZE);
  const tileAreaWidth = tileWidth * GRID_SIZE;
  const tileAreaHeight = tileHeight * GRID_SIZE;

  tiles.forEach((sourceIndex, destIndex) => {
    const destX = Math.trunc(destIndex / GRID_SIZE) * tileWidth;
    const destY = (destIndex % GRID_SIZE) * tileHeight;
    const sourceX = Math.trunc(sourceIndex / GRID_SIZE) * tileWidth;
    const sourceY = (sourceIndex % GRID_SIZE) * tileHeight;
    canvas.drawImage(bytes, sourceX, sourceY, tileWidth, tileHeight, destX, destY);
  });

  if (tileAreaWidth < width) canvas.drawImage(bytes, tileAreaWidth, 0, width - tileAreaWidth, height, tileAreaWidth, 0);
  if (tileAreaHeight < height) canvas.drawImage(bytes, 0, tileAreaHeight, tileAreaWidth, height - tileAreaHeight, 0, tileAreaHeight);

  return canvas.encode("jpeg", 90);
}

// ComiciViewer.kt

export abstract class ComiciViewer extends KeiSource {
  protected get apiUrl() {
    return `${this.baseUrl}/api`;
  }
  protected get rscHeaders() {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor((chain) => imageIntercept(this.host, chain));
  }

  override async getPopularManga(_page: number): Promise<MangasPage> {
    const result = extractNextJs<{ children?: Json[][] }>(
      await this.client.get(`${this.baseUrl}${RANKING_PATH}`, this.rscHeaders),
      (it) => typeof it === "object" && it !== null && !Array.isArray(it) && (it as Record<string, Json>).className === "series-list mode-ranking",
    );

    const mangas = (result?.children ?? []).map((it) => rankingToSManga(it));
    return new MangasPage(mangas, false);
  }

  override async getLatestUpdates(page: number) {
    return this.toMangasPage(await this.client.get(`${this.baseUrl}/series/list/up/${page}`));
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.trim()) {
      const url = toHttpUrl(`${this.apiUrl}/search`).newBuilder().addQueryParameter("q", query).addQueryParameter("page", String(page)).addQueryParameter("size", String(SEARCH_PAGE_SIZE)).build();

      const result = (await this.client.get(url.toString())).parseAs<SearchApiResponse>().searchResult.series;
      const mangas = result.series.map((it) => summaryToSManga(it));
      const hasNextPage = result.total > page * SEARCH_PAGE_SIZE;
      return new MangasPage(mangas, hasNextPage);
    }

    const filter = filters.find((it) => it instanceof CategoryFilter) as CategoryFilter | undefined;
    if (!filter) throw new Error("List contains no element matching the predicate.");
    const path = filter.value;

    if (path === RANKING_PATH) return this.getPopularManga(page);

    return this.toMangasPage(await this.client.get(`${this.baseUrl}${path}/${page}`));
  }

  protected toMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("div.series-list-item").map((it) => {
      const manga = SManga.create();
      manga.url = this.seriesHash(toHttpUrl(it.selectFirst("a.series-list-item-link")!.absUrl("href")));
      manga.title = it.selectFirst("div.series-list-item-h span[data-e2e=sliTitle]")!.text();
      manga.thumbnail_url = it.selectFirst("img.series-list-item-img")?.absUrl("src");
      return manga;
    });

    const hasNextPage = document.selectFirst("a.g-pager-link.mode-active + a.g-pager-link") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  /** Series links come as `/series/<hash>`, `/series/<hash>/new` or `/<magazine>/series/<hash>`. */
  protected seriesHash(url: HttpUrl): string {
    const segments = url.pathSegments;
    const index = segments.indexOf("series");
    if (index === -1) throw new Error(`Unrecognized series url: ${url}`);
    return segments[index + 1];
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  // CacheControl.FORCE_NETWORK: the host has no HTTP cache, every request goes to the network
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const hash = substringAfter(manga.url, "/series/"); // for old url compatibility
    const [series, accessList] = await Promise.all([
      this.client.get(this.seriesApiUrl("episodes", hash)).then((r) => r.parseAs<ApiResponse>().series),
      this.client.get(this.seriesApiUrl("series/access", hash)).then((r) => r.parseAs<AccessApiResponse>().seriesAccess.episodeAccesses),
    ]);
    const accesses = new Map(accessList.map((it) => [it.episodeId, it]));

    const showLocked = this.preferences.getBoolean(SHOW_LOCKED_PREF_KEY, true);
    const showCampaignLocked = this.preferences.getBoolean(SHOW_CAMPAIGN_LOCKED_PREF_KEY, true);
    const chapterList = (series.episodes ?? [])
      .flatMap((it) => {
        const access = accesses.get(it.id);
        const isVisible = access == null || !isLocked(access) ? true : needsLogin(access) ? showCampaignLocked : showLocked;
        return isVisible ? [episodeToSChapter(it, access)] : [];
      })
      .reverse();

    return new SMangaUpdate(summaryToSManga(series.summary), chapterList);
  }

  protected seriesApiUrl(path: string, seriesHash: string) {
    return toHttpUrl(`${this.apiUrl}/${path}`).newBuilder().addQueryParameter("seriesHash", seriesHash).addQueryParameter("episodeFrom", "1").addQueryParameter("episodeTo", "9999").build().toString();
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/episodes/${chapter.url}`;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.memo?.login === true) throw new Error("This chapter is free but you need to log in via WebView and refresh the entry.");

    const episode = (await this.client.get(`${this.apiUrl}/episodes/${chapter.url}`)).parseAs<EpisodeDetailsApiResponse>().episode;
    const viewerId = episode.content.find((it) => it.type === "viewer")?.viewerId;
    if (viewerId == null) {
      const pages = episode.content.flatMap((it) => (it.type === "image" && it.url != null ? [it.url] : [])).map((url, index) => new Page(index, "", url));
      if (!pages.length) throw new Error("Log in via WebView and purchase this chapter to read.");
      return pages;
    }

    let memberJwt: string | null = null;
    try {
      memberJwt = (await this.client.get(`${this.apiUrl}/user/info`)).parseAs<UserInfoApiResponse>().user?.id ?? null;
    } catch {
      memberJwt = null;
    }

    const contentsInfoUrl = toHttpUrl(`${this.apiUrl}/book/contentsInfo`).newBuilder().addQueryParameter("comici-viewer-id", viewerId).addQueryParameter("contentId", String(episode.contentId));
    contentsInfoUrl.addQueryParameter("user-id", memberJwt).addQueryParameter("page-from", "0");

    const totalPages = (await this.client.get(contentsInfoUrl.addQueryParameter("page-to", "0").build().toString())).parseAs<ViewerResponse>().totalPages;

    const result = (await this.client.get(contentsInfoUrl.setQueryParameter("page-to", String(totalPages)).build().toString())).parseAs<ViewerResponse>().result;

    return result.map((it) => new Page(it.sort, "", `${it.imageUrl}#scramble=${it.scramble}`));
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const locked = new SwitchPreferenceCompat(screen.context);
    locked.key = SHOW_LOCKED_PREF_KEY;
    locked.title = "Show Locked Chapters";
    locked.setDefaultValue(true);
    screen.addPreference(locked);

    const campaign = new SwitchPreferenceCompat(screen.context);
    campaign.key = SHOW_CAMPAIGN_LOCKED_PREF_KEY;
    campaign.title = "Show 'Require Login' Chapters";
    campaign.summary = "Shows chapters that are free but require login.";
    campaign.setDefaultValue(true);
    screen.addPreference(campaign);
  }

  protected get extraFilterOptions(): [string, string][] {
    return [];
  }

  protected getFilterOptions(): [string, string][] {
    return [
      ["ランキング", RANKING_PATH],
      ["更新順", "/series/list/up"],
      ["新作順", "/series/list/new"],
      ["読み切り", "/category/manga/oneShot"],
      ["完結", "/category/manga/complete"],
      ["月曜日", "/category/manga/day/1"],
      ["火曜日", "/category/manga/day/2"],
      ["水曜日", "/category/manga/day/3"],
      ["木曜日", "/category/manga/day/4"],
      ["金曜日", "/category/manga/day/5"],
      ["土曜日", "/category/manga/day/6"],
      ["日曜日", "/category/manga/day/7"],
      ["その他", "/category/manga/day/8"],
      ...this.extraFilterOptions,
    ];
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new CategoryFilter(this.getFilterOptions()));
  }
}
