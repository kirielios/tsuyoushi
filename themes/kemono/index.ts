// Port of keiyoushi/extensions-source lib-multisrc/kemono/Kemono.kt (+ KemonoDto.kt)
import {
  Filter,
  FilterList,
  HttpException,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  ZoneOffset,
  atZone,
  distinctBy,
  parseAs,
  substringAfterLast,
  toHttpUrl,
  type Chain,
  type ClientBuilder,
  type PreferenceScreen,
  type Response,
  type Zone,
} from "../../sdk/index.ts";

const PAGE_POST_LIMIT = 50;
const PAGE_CREATORS_LIMIT = 50;
export const PROMPT = "You can change how many posts to load in the extension preferences.";

const POST_PAGES_PREF = "POST_PAGES";
const POST_PAGES_DEFAULT = "1";
const POST_PAGES_MAX = 75;

const USE_LOW_RES_IMG = "USE_LOW_RES_IMG";

// KemonoDto.kt

/** DateTimeFormatter.ISO_LOCAL_DATE_TIME.tryParseDateTime(text, zone) */
function tryParseIsoLocalDateTime(text: string | null | undefined, zone: Zone): number {
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/.test(text)) return 0;
  const t = Date.parse(text.replace(/(\.\d{3})\d+$/, "$1") + "Z");
  return Number.isNaN(t) ? 0 : atZone(t, zone);
}

interface KemonoFavoritesDto {
  id: string;
  name: string;
  service: string;
  faved_seq: number;
}

interface KemonoCreatorDto {
  id: string;
  name: string;
  service: string;
  updated: string | number;
  favorited?: number;
  fav?: number;
}

const creatorFavorited = (c: KemonoCreatorDto) => c.favorited ?? -1;
const creatorUpdatedDate = (c: KemonoCreatorDto) => (typeof c.updated === "string" ? tryParseIsoLocalDateTime(c.updated, undefined) : Math.trunc(c.updated * 1000));

export function serviceName(service: string) {
  switch (service) {
    case "fanbox":
      return "Pixiv Fanbox";
    case "subscribestar":
      return "SubscribeStar";
    case "dlsite":
      return "DLsite";
    case "onlyfans":
      return "OnlyFans";
    default:
      return service.charAt(0).toUpperCase() + service.slice(1);
  }
}

function creatorToSManga(c: KemonoCreatorDto, imgCdnUrl: string) {
  const manga = SManga.create();
  manga.url = `/${c.service}/user/${c.id}`; // should be /server/ for Discord but will be filtered anyway
  manga.title = c.name;
  manga.author = serviceName(c.service);
  manga.thumbnail_url = `${imgCdnUrl}/icons/${c.service}/${c.id}`;
  manga.description = PROMPT;
  manga.initialized = true;
  return manga;
}

interface KemonoFileDto {
  name?: string | null;
  path?: string | null;
}
// name might have ".jpe" extension for JPEG, path might have ".m4v" extension for MP4
interface KemonoAttachmentDto {
  name?: string | null;
  path: string;
}
interface KemonoPostDto {
  id: string;
  service: string;
  user: string;
  title: string;
  added?: string | null;
  published?: string | null;
  edited?: string | null;
  file: KemonoFileDto;
  attachments: KemonoAttachmentDto[];
}
interface KemonoPostDtoWrapped {
  post: KemonoPostDto;
}

const attachmentToString = (a: KemonoAttachmentDto) => a.path + (a.name != null ? `?f=${a.name}` : "");

function postImages(post: KemonoPostDto): string[] {
  const list: KemonoAttachmentDto[] = [];
  if (post.file.path != null) list.push({ name: post.file.name, path: post.file.path });
  list.push(...post.attachments);
  return distinctBy(
    list.filter((it) => ["png", "jpg", "gif", "jpeg", "webp"].includes(substringAfterLast(it.path, ".").toLowerCase())),
    (it) => it.path,
  ).map(attachmentToString);
}

const pad = (n: number) => String(n).padStart(2, "0");
/** chapterNameDateFormat: "yyyy-MM-dd 'at' HH:mm:ss" in the system zone */
function formatChapterNameDate(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function postToSChapter(post: KemonoPostDto, zone: Zone) {
  const chapter = SChapter.create();
  const postDate = tryParseIsoLocalDateTime(post.edited ?? post.published ?? post.added, zone);

  chapter.url = `/${post.service}/user/${post.user}/post/${post.id}`;
  chapter.date_upload = postDate;
  chapter.name = post.title.trim() ? post.title : `Post from ${postDate !== 0 ? formatChapterNameDate(postDate) : "unknown date"}`;
  chapter.chapter_number = -2;
  return chapter;
}

// Filters

export class TriFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}
export class TypeFilter extends Filter.Group<TriFilter> {
  constructor(name: string, vals: string[]) {
    super(
      name,
      vals.map((it) => new TriFilter(it, it.toLowerCase())),
    );
  }
}
export class FavoritesFilter extends Filter.Group<TriFilter> {
  constructor() {
    super("Favorites", [new TriFilter("Favorites Only", "fav")]);
  }
}
export class SortFilter extends Filter.Sort {
  constructor(
    name: string,
    selection: { index: number; ascending: boolean },
    private readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      selection,
    );
  }
  getValue() {
    return this.vals[this.state!.index][1];
  }
}

const sortBy = <T>(list: T[], key: (it: T) => number | string, desc: boolean) =>
  [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return desc ? -c : c;
  });

export abstract class Kemono extends KeiSource {
  override get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder) {
    return (
      builder
        .addInterceptor((request) => {
          if (toHttpUrl(request.url).pathSegments[0] === "api") {
            const headers = new Headers(request.headers);
            headers.set("Accept", "text/css");
            return { ...request, headers };
          }
          return request;
        })
        .addChainInterceptor((chain) => this.thumbnailFallbackInterceptor(chain))
        // Cache(50 MiB) is not ported: the /creators list is kept in memory instead, see creatorsCache
        .readTimeout(5 * 60_000)
        .rateLimit(1)
    );
  }

  // Full-size files redirect to the nX file servers, which are often unreachable;
  // the thumbnail server still works, so fall back to it. Once they fail to connect, skip them
  // for the rest of the session so every page doesn't wait for the connect timeout.
  private fileServersUnreachable = false;

  private async thumbnailFallbackInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const url = toHttpUrl(request.url);
    if (url.pathSegments[0] !== this.dataPath) return chain.proceed(request);

    if (!this.fileServersUnreachable) {
      try {
        const response = await chain.proceed(request);
        if (response.isSuccessful) return response;
      } catch {
        this.fileServersUnreachable = true;
      }
    }

    const thumbnailUrl = url.newBuilder().encodedPath(`/thumbnail${url.encodedPath}`).build();
    return chain.proceed({ ...request, url: thumbnailUrl.toString() });
  }

  private readonly apiPath = "api/v1";

  private readonly dataPath = "data";

  private get imgCdnUrl() {
    return this.baseUrl.replace("//", "//img.");
  }

  private formatAvatarUrl(s: string): string {
    const rest = s.startsWith("https://") ? s.slice(8) : s;
    const i = rest.indexOf("/");
    return i < 0 ? rest : this.imgCdnUrl + rest.slice(i);
  }

  override getPopularManga(page: number) {
    return this.searchMangas(page, "", null, ["pop", "desc"]);
  }

  override getLatestUpdates(page: number) {
    return this.searchMangas(page, "", null, ["lat", "desc"]);
  }

  override getSearchMangaList(page: number, query: string, filters: FilterList) {
    return this.searchMangas(page, query, filters);
  }

  // CacheControl maxStale(30.minutes) on the creators request
  private creatorsCache?: { at: number; text: string };
  private async getCreators(): Promise<KemonoCreatorDto[]> {
    if (!this.creatorsCache || Date.now() - this.creatorsCache.at > 30 * 60_000) {
      const text = (await this.client.get(`${this.baseUrl}/${this.apiPath}/creators`, this.headers)).text();
      this.creatorsCache = { at: Date.now(), text };
    }
    return parseAs<KemonoCreatorDto[]>(this.creatorsCache.text);
  }

  private async searchMangas(page = 1, title = "", filters: FilterList | null = null, sortBy_: [string, string] = ["", ""]): Promise<MangasPage> {
    let sort = sortBy_;
    const typeIncluded: string[] = [];
    const typeExcluded: string[] = [];
    let fav: boolean | null = null;
    for (const filter of filters ?? []) {
      if (filter instanceof SortFilter) {
        sort = [filter.getValue(), filter.state!.ascending ? "asc" : "desc"];
      } else if (filter instanceof TypeFilter) {
        filter.state.filter((s) => s.isIncluded()).forEach((tri) => typeIncluded.push(tri.value));
        filter.state.filter((s) => s.isExcluded()).forEach((tri) => typeExcluded.push(tri.value));
      } else if (filter instanceof FavoritesFilter) {
        fav = filter.state[0].state === 0 ? null : filter.state[0].state === 1;
      }
    }

    let favorites: KemonoFavoritesDto[] = [];
    if (fav != null) {
      const response = await this.client.get(`${this.baseUrl}/${this.apiPath}/account/favorites`, undefined, { ensureSuccess: false });
      if (response.isSuccessful) {
        favorites = response.parseAs<KemonoFavoritesDto[]>().filter((it) => it.service.toLowerCase() !== "discord");
      } else {
        const message = response.code === 401 ? "You are not logged in" : `HTTP error ${response.code}`;
        throw new Error(`Failed to fetch favorites: ${message}`);
      }
    }

    const allCreators = (await this.getCreators()).filter((it) => it.service.toLowerCase() !== "discord");
    const lowerTitle = title.toLowerCase();
    const mangas = allCreators.filter((it) => {
      const includeType = typeIncluded.length === 0 || typeIncluded.includes(serviceName(it.service).toLowerCase());
      const excludeType = typeExcluded.length !== 0 && typeExcluded.includes(serviceName(it.service).toLowerCase());

      const regularSearch = it.name.toLowerCase().includes(lowerTitle);

      let isFavorited: boolean;
      if (fav === true) {
        isFavorited = favorites.some((f) => {
          it.fav = f.faved_seq;
          return f.id === it.id;
        });
      } else if (fav === false) isFavorited = !favorites.some((f) => f.id === it.id);
      else isFavorited = true;

      return includeType && !excludeType && isFavorited && regularSearch;
    });

    const desc = sort[1] === "desc";
    let sorted: KemonoCreatorDto[];
    switch (sort[0]) {
      case "pop":
        sorted = sortBy(mangas, creatorFavorited, desc);
        break;
      case "tit":
        sorted = sortBy(mangas, (it) => it.name, desc);
        break;
      case "new":
        sorted = sortBy(mangas, (it) => it.id, desc);
        break;
      case "fav":
        if (fav !== true) throw new Error("Please check 'Favorites Only' Filter");
        sorted = sortBy(mangas, (it) => it.fav ?? 0, desc);
        break;
      default:
        sorted = sortBy(mangas, creatorUpdatedDate, desc);
    }
    const maxIndex = mangas.length;
    const fromIndex = (page - 1) * PAGE_CREATORS_LIMIT;
    const toIndex = Math.min(maxIndex, fromIndex + PAGE_CREATORS_LIMIT);

    const final = sorted.slice(fromIndex, toIndex).map((it) => creatorToSManga(it, this.imgCdnUrl));
    return new MangasPage(final, toIndex !== maxIndex);
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (fetchDetails) manga.thumbnail_url = this.formatAvatarUrl(manga.thumbnail_url!);
    return new SMangaUpdate(manga, fetchChapters ? await this.fetchChapterList(manga) : chapters);
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}${chapter.url.replace(`${this.apiPath}/`, "")}`;
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const zone = manga.author === "Pixiv Fanbox" || manga.author === "Fantia" ? ZoneOffset.ofHours(9) : ZoneOffset.UTC;
    const prefMaxPost = Math.min(Number(this.preferences.getString(POST_PAGES_PREF, POST_PAGES_DEFAULT)!), POST_PAGES_MAX) * PAGE_POST_LIMIT;
    let offset = 0;
    let hasNextPage = true;
    const result: SChapter[] = [];
    while (offset < prefMaxPost && hasNextPage) {
      const page = (await this.retry(`${this.baseUrl}/${this.apiPath}${manga.url}/posts?o=${offset}`)).parseAs<KemonoPostDto[]>();
      page.forEach((post) => {
        if (postImages(post).length) result.push(postToSChapter(post, zone));
      });
      offset += PAGE_POST_LIMIT;
      hasNextPage = page.length === PAGE_POST_LIMIT;
    }
    return result;
  }

  private async retry(url: string): Promise<Response> {
    let code = 0;
    for (let i = 0; i < 5; i++) {
      const response = await this.client.get(url, undefined, { ensureSuccess: false });
      if (response.isSuccessful) return response;
      code = response.code;
      if (code === 429) await new Promise((r) => setTimeout(r, 10000));
    }
    throw new HttpException(code, url);
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const postData = (await this.client.get(`${this.baseUrl}/${this.apiPath}${chapter.url}`)).parseAs<KemonoPostDtoWrapped>();
    return postImages(postData.post).map((path, i) => new Page(i, "", `${this.baseUrl}/${this.dataPath}${path}`));
  }

  override imageRequest(page: Page) {
    const imageUrl = page.imageUrl!;

    if (!this.preferences.getBoolean(USE_LOW_RES_IMG, false)) return { url: imageUrl, headers: this.headers };

    const index = imageUrl.indexOf("/", 8);
    const url = imageUrl.slice(0, index) + "/thumbnail" + imageUrl.slice(index);
    return { url, headers: this.headers };
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pages = new ListPreference(screen.context);
    pages.key = POST_PAGES_PREF;
    pages.title = "Maximum posts to load";
    pages.summary = "Loading more posts costs more time and network traffic.\nCurrently: %s";
    pages.entryValues = Array.from({ length: POST_PAGES_MAX }, (_, it) => String(it + 1));
    pages.entries = Array.from({ length: POST_PAGES_MAX }, (_, it) => `${it + 1} pages (${(it + 1) * PAGE_POST_LIMIT} posts)`);
    pages.setDefaultValue(POST_PAGES_DEFAULT);
    screen.addPreference(pages);

    const lowRes = new SwitchPreferenceCompat(screen.context);
    lowRes.key = USE_LOW_RES_IMG;
    lowRes.title = "Use low resolution images";
    lowRes.summary = "Reduce load time significantly. When turning off, clear chapter cache to remove cached low resolution images.";
    lowRes.setDefaultValue(false);
    screen.addPreference(lowRes);
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter("Sort by", { index: 0, ascending: false }, this.getSortsList), new TypeFilter("Types", this.getTypes), new FavoritesFilter());
  }

  get getTypes(): string[] {
    return [];
  }

  get getSortsList(): [string, string][] {
    return [
      ["Popularity", "pop"],
      ["Date Indexed", "new"],
      ["Date Updated", "lat"],
      ["Alphabetical Order", "tit"],
      ["Service", "serv"],
      ["Date Favorited", "fav"],
    ];
  }
}
