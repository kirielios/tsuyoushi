// Port of keiyoushi/extensions-source src/all/pawchive/Pawchive.kt (with Dto.kt)
import {
  ClientBuilder,
  FilterList,
  HttpClient,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  distinctBy,
  isBlank,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { FavoritesFilter, SortFilter, TypeFilter, getDefaultFilterList, getLatestUpdatesFilterList } from "./filters.ts";

// --- Dto.kt
interface PawchiveFavoritesDto {
  id: string;
  faved_seq: number;
}
interface PawchiveCreatorDto {
  id: string;
  name: string;
  service: string;
  updated: string | number; // JsonPrimitive
  favorited?: number;
  /** @Transient var fav */
  fav?: number;
}
interface PawchiveFileDto {
  path?: string;
}
interface PawchivePostDto {
  id: string;
  service: string;
  user: string;
  title: string;
  added?: string | null;
  published?: string | null;
  edited?: string | null;
  file?: PawchiveFileDto | null;
  attachments?: PawchiveFileDto[];
}

const PAGE_POST_LIMIT = 50;
const PAGE_CREATORS_LIMIT = 50;
const PROMPT = "You can change how many posts to load in the extension preferences.";

const POST_PAGES_PREF = "POST_PAGES";
const POST_PAGES_DEFAULT = "1";
const POST_PAGES_MAX = 75;

const USE_LOW_RES_IMG = "USE_LOW_RES_IMG";
const FALLBACK_LOW_RES_IMG = "FALLBACK_LOW_RES_IMG";

const POST_DATE_PREF = "POST_DATE_PREF";
const POST_DATE_ADDED = "added";
const POST_DATE_PUBLISHED = "published";
const POST_DATE_EDITED = "edited";

const validImageExtensions = new Set(["png", "jpg", "gif", "jpeg", "webp"]);

const serviceName = (s: string) => (s === "fanbox" ? "Pixiv Fanbox" : s.charAt(0).toUpperCase() + s.slice(1));

const updatedDate = (c: PawchiveCreatorDto): number => (typeof c.updated === "string" ? tryParseInstant(c.updated) : Math.trunc(c.updated * 1000));

function creatorToSManga(c: PawchiveCreatorDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = `/${c.service}/user/${c.id}`;
  manga.title = c.name;
  manga.author = serviceName(c.service);
  manga.thumbnail_url = `${baseUrl}/icons/${c.service}/${c.id}`;
  manga.description = PROMPT;
  manga.initialized = true;
  return manga;
}

const postImages = (post: PawchivePostDto): string[] =>
  distinctBy(
    [...(post.file != null ? [post.file] : []), ...(post.attachments ?? [])].map((it) => it.path ?? "").filter((p) => !isBlank(p) && validImageExtensions.has(substringAfterLast(p, ".").toLowerCase())),
    (p) => p,
  );

function postToSChapter(post: PawchivePostDto, svcName: string | undefined, datePref: string): SChapter {
  const chapter = SChapter.create();
  let dateStr: string | null | undefined;
  switch (datePref) {
    case "added":
      dateStr = post.added ?? post.published ?? post.edited;
      break;
    case "edited":
      dateStr = post.edited ?? post.published ?? post.added;
      break;
    default:
      dateStr = post.published ?? post.added ?? post.edited; // Default to published
  }

  let postDate = 0;
  if (dateStr != null) {
    const dateWithTz = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : dateStr + (svcName === "Pixiv Fanbox" ? "+09:00" : "Z");
    postDate = tryParseInstant(dateWithTz) || 0;
  }

  chapter.url = `/${post.service}/user/${post.user}/post/${post.id}`;
  chapter.date_upload = postDate;

  chapter.name = !isBlank(post.title)
    ? post.title
    : `Post from ${
        postDate !== 0 && dateStr != null
          ? // Strips any unexpected timezone markers and recreates "yyyy-MM-dd 'at' HH:mm:ss" natively
            substringBefore(substringBefore(dateStr, "+"), "Z").replaceAll("T", " at ")
          : "unknown date"
      }`;
  chapter.chapter_number = -2;
  return chapter;
}

/** Kotlin's sortedBy / sortedByDescending: stable. */
function sortedBy<T, K extends number | string>(list: T[], key: (it: T) => K, desc: boolean): T[] {
  return [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
  });
}

export default class Pawchive extends KeiSource {
  private readonly apiPath = "api/v1";
  private readonly dataPath = "data";

  private get fileUrl() {
    return this.baseUrl.replace("//", "//file.");
  }
  private get imgUrl() {
    return this.baseUrl.replace("//", "//img.");
  }

  private clientBuilder!: ClientBuilder;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    this.clientBuilder = builder;
    return builder
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const url = new URL(request.url);

        let modifiedRequest = request;
        if (url.pathname.slice(1).split("/")[0] === "api") {
          const headers = new Headers(request.headers);
          headers.set("Accept", "text/css");
          modifiedRequest = { ...request, headers };
        } else if (request.url.startsWith(this.fileUrl) || request.url.startsWith(this.imgUrl)) {
          const headers = new Headers(request.headers);
          headers.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
          headers.set("Sec-Fetch-Dest", "image");
          headers.set("Sec-Fetch-Mode", "no-cors");
          headers.set("Sec-Fetch-Site", "same-site");
          modifiedRequest = { ...request, headers };
        }

        let response = await chain.proceed(modifiedRequest);

        if (response.code === 404 && request.url.startsWith(this.fileUrl)) {
          if (this.preferences.getBoolean(FALLBACK_LOW_RES_IMG, true)) {
            response = await chain.proceed({ ...request, url: this.toThumbnailUrl(request.url) });
          }
        }

        return response;
      })
      .connectTimeout(15_000)
      .readTimeout(30_000);
  }

  private _apiClient?: HttpClient;
  /** client.newBuilder().rateLimit(2).build() */
  private get apiClient(): HttpClient {
    if (!this._apiClient) {
      this.client; // builds clientBuilder
      const b = new ClientBuilder();
      b.interceptors.push(...this.clientBuilder.interceptors);
      b.chainInterceptors.push(...this.clientBuilder.chainInterceptors);
      b.limiters.push(...this.clientBuilder.limiters);
      b.rateLimit(2);
      this._apiClient = new HttpClient(this.host, () => this.headers, b);
    }
    return this._apiClient;
  }

  // ponytail: the creators list is big; upstream asks OkHttp's cache for a 30 minute stale copy (CacheControl maxStale), kept here in memory
  private creatorsCache: { at: number; list: PawchiveCreatorDto[] } | null = null;
  private async getCreators(): Promise<PawchiveCreatorDto[]> {
    if (this.creatorsCache && Date.now() - this.creatorsCache.at < 30 * 60_000) return this.creatorsCache.list;
    const response = await this.apiClient.get(`${this.baseUrl}/${this.apiPath}/creators`, undefined, { ensureSuccess: false });
    if (!response.isSuccessful) throw new Error(`HTTP error ${response.code}`);
    const list = response.parseAs<PawchiveCreatorDto[]>();
    this.creatorsCache = { at: Date.now(), list };
    return list;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.getFilterList(null));
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", getLatestUpdatesFilterList());
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let sort: [string, string] = ["", ""];
    const typeIncluded: string[] = [];
    const typeExcluded: string[] = [];
    let fav: boolean | null = null;

    for (const filter of filters) {
      if (filter instanceof SortFilter) {
        sort = [filter.getValue(), filter.state!.ascending ? "asc" : "desc"];
      } else if (filter instanceof TypeFilter) {
        for (const tri of filter.state) {
          if (tri.isIncluded()) typeIncluded.push(tri.value);
          if (tri.isExcluded()) typeExcluded.push(tri.value);
        }
      } else if (filter instanceof FavoritesFilter) {
        fav = filter.state[0].state === 1 ? true : filter.state[0].state === 2 ? false : null;
      }
    }

    if (sort[0] === "") sort = ["pop", "desc"];

    const favoritesDeferred = (async (): Promise<PawchiveFavoritesDto[]> => {
      if (fav != null) {
        const response = await this.apiClient.get(`${this.baseUrl}/${this.apiPath}/account/favorites`, undefined, { ensureSuccess: false });
        if (response.isSuccessful) return response.parseAs<PawchiveFavoritesDto[]>();
        const message = response.code === 401 ? "You are not logged in" : `HTTP error ${response.code}`;
        throw new Error(`Failed to fetch favorites: ${message}`);
      }
      return [];
    })();
    const creatorsDeferred = this.getCreators();

    const [favorites, allCreators] = await Promise.all([favoritesDeferred, creatorsDeferred]);

    const mangas = allCreators.filter((creator) => {
      const sName = serviceName(creator.service).toLowerCase();
      const includeType = typeIncluded.length === 0 || typeIncluded.includes(sName);
      const excludeType = typeExcluded.length > 0 && typeExcluded.includes(sName);
      const regularSearch = creator.name.toLowerCase().includes(query.toLowerCase());

      const favEntry = favorites.find((f) => f.id === creator.id);
      creator.fav = favEntry?.faved_seq ?? 0;

      const isFavorited = fav === true ? favEntry != null : fav === false ? favEntry == null : true;

      return includeType && !excludeType && isFavorited && regularSearch;
    });

    const desc = sort[1] === "desc";
    let sorted: PawchiveCreatorDto[];
    switch (sort[0]) {
      case "pop":
        sorted = sortedBy(mangas, (it) => it.favorited ?? -1, desc);
        break;
      case "tit":
        sorted = sortedBy(mangas, (it) => it.name.toLowerCase(), desc);
        break;
      case "new":
        sorted = sortedBy(mangas, (it) => (/^-?\d+$/.test(it.id) ? Number(it.id) : 0), desc);
        break;
      case "fav":
        if (fav !== true) throw new Error("Please check 'Favorites Only' Filter");
        sorted = sortedBy(mangas, (it) => it.fav ?? 0, desc);
        break;
      default:
        sorted = sortedBy(mangas, updatedDate, desc);
    }

    const startIndex = (page - 1) * PAGE_CREATORS_LIMIT;
    const endIndex = Math.min(startIndex + PAGE_CREATORS_LIMIT, sorted.length);

    if (startIndex >= sorted.length) return new MangasPage([], false);

    const pageItems = sorted.slice(startIndex, endIndex);
    const final = pageItems.map((it) => creatorToSManga(it, this.baseUrl));
    const hasNextPage = endIndex < sorted.length;

    return new MangasPage(final, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;

    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== "creators" || segments.length < 2) return null;

    const id = segments[1];
    if (isBlank(id)) return null;

    const response = await this.apiClient.get(`${this.baseUrl}/${this.apiPath}/creators`, undefined, { ensureSuccess: false });
    if (!response.isSuccessful) return null;
    const allCreators = response.parseAs<PawchiveCreatorDto[]>();
    const creator = allCreators.find((it) => it.id === id);
    if (creator == null) return null;
    return creatorToSManga(creator, this.baseUrl);
  }

  // ============================== Details ==============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let updatedChapters: SChapter[];
    if (fetchChapters) {
      const prefMaxPost = Math.min(Number.parseInt(this.preferences.getString(POST_PAGES_PREF, POST_PAGES_DEFAULT)!, 10), POST_PAGES_MAX) * PAGE_POST_LIMIT;

      const datePref = this.preferences.getString(POST_DATE_PREF, POST_DATE_PUBLISHED)!;

      let offset = 0;
      let hasNextPage = true;
      const result: SChapter[] = [];

      while (offset < prefMaxPost && hasNextPage) {
        const url = `${this.baseUrl}/${this.apiPath}${manga.url}/posts?o=${offset}`;

        const page = (await this.apiClient.get(url)).parseAs<PawchivePostDto[]>();

        for (const post of page) {
          if (postImages(post).length > 0) result.push(postToSChapter(post, manga.author, datePref));
        }

        offset += PAGE_POST_LIMIT;
        hasNextPage = page.length === PAGE_POST_LIMIT;
      }
      updatedChapters = result;
    } else {
      updatedChapters = chapters;
    }

    return new SMangaUpdate(manga, updatedChapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = `${this.baseUrl}/${this.apiPath}${chapter.url}`;

    const postData = (await this.apiClient.get(url)).parseAs<PawchivePostDto>();

    const useLowRes = this.preferences.getBoolean(USE_LOW_RES_IMG, false);

    return postImages(postData).map((path, i) => {
      const originalUrl = `${this.fileUrl}/${this.dataPath}${path}`;
      return new Page(i, "", useLowRes ? this.toThumbnailUrl(originalUrl) : originalUrl);
    });
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return getDefaultFilterList();
  }

  // ============================= Utilities =============================

  private toThumbnailUrl(url: string): string {
    const pathIndex = url.indexOf("/", 8); // Skips the `https://`
    return `${this.imgUrl}/thumbnail${url.substring(pathIndex)}`;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pages = new ListPreference();
    pages.key = POST_PAGES_PREF;
    pages.title = "Maximum posts to load";
    pages.summary = "Loading more posts costs more time and network traffic.\nCurrently: %s";
    pages.entryValues = Array.from({ length: POST_PAGES_MAX }, (_, i) => String(i + 1));
    pages.entries = Array.from({ length: POST_PAGES_MAX }, (_, i) => `${i + 1} pages (${(i + 1) * PAGE_POST_LIMIT} posts)`);
    pages.setDefaultValue(POST_PAGES_DEFAULT);
    screen.addPreference(pages);

    const date = new ListPreference();
    date.key = POST_DATE_PREF;
    date.title = "Preferred Post Date";
    date.summary = "Choose which date to use for chapters.\nCurrently: %s";
    date.entries = ["Added Date", "Published Date", "Edited Date"];
    date.entryValues = [POST_DATE_ADDED, POST_DATE_PUBLISHED, POST_DATE_EDITED];
    date.setDefaultValue(POST_DATE_PUBLISHED);
    screen.addPreference(date);

    const lowRes = new SwitchPreferenceCompat();
    lowRes.key = USE_LOW_RES_IMG;
    lowRes.title = "Use low resolution images";
    lowRes.summary = "Reduce load time significantly. When turning off, clear chapter cache to remove cached low resolution images.";
    lowRes.setDefaultValue(false);
    screen.addPreference(lowRes);

    const fallback = new SwitchPreferenceCompat();
    fallback.key = FALLBACK_LOW_RES_IMG;
    fallback.title = "Fallback to low resolution images";
    fallback.summary = "If a full size image fails to load (e.g. 404 Not Found), automatically try loading the low resolution thumbnail instead.";
    fallback.setDefaultValue(true);
    screen.addPreference(fallback);
  }
}
