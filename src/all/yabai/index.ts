// Port of keiyoushi/extensions-source src/all/yabai/Yabai.kt (+ Dto.kt, Filters.kt)
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
  ZoneOffset,
  firstInstanceOrNull,
  type Chain,
  type ClientBuilder,
  type Response,
} from "../../../sdk/index.ts";

// --- Dto.kt
const createdAtFormat = DateTimeFormatter.ofPattern("yyyy-M-d HH:mm", Locale.ENGLISH);

interface QueryDto {
  cat: string;
  lng: string;
  qry: string;
  tag: string;
  cursor: string | null;
}
interface DataResponse<T> {
  props: T;
}
interface IndexProps {
  post_list: PostList;
}
interface PostList {
  data: GalleryItem[];
  meta: Meta;
}
interface GalleryItem {
  slug: string;
  name: string;
  cover: string;
}
function galleryItemToSManga(item: GalleryItem): SManga {
  const manga = SManga.create();
  manga.title = item.name;
  manga.url = `/g/${item.slug}`;
  manga.thumbnail_url = item.cover;
  manga.status = SManga.COMPLETED;
  return manga;
}
interface Meta {
  next_cursor: string | null;
}
interface DetailProps {
  post: { data: Gallery };
}
interface Tag {
  name: string;
  full_name?: string | null;
}
interface Gallery {
  slug: string;
  name: string;
  cover: string;
  tags?: Record<string, Tag[]> | null;
  date?: { default: string } | null;
}
function galleryToSManga(g: Gallery): SManga {
  const manga = SManga.create();
  manga.title = g.name;
  manga.url = `/g/${g.slug}`;
  manga.thumbnail_url = g.cover;
  manga.author = g.tags?.Group?.map((it) => it.name).join(", ");
  manga.artist = g.tags?.Artist?.map((it) => it.name).join(", ");
  manga.genre = g.tags
    ? Object.entries(g.tags)
        .filter(([k]) => k !== "Group" && k !== "Artist")
        .flatMap(([, v]) => v)
        .map((it) => it.full_name ?? it.name)
        .join(", ")
    : undefined;
  manga.status = SManga.COMPLETED;
  return manga;
}
function galleryToSChapter(g: Gallery): SChapter {
  const chapter = SChapter.create();
  chapter.name = "Chapter";
  chapter.url = `/g/${g.slug}`;
  chapter.date_upload = g.date ? createdAtFormat.tryParseDateTime(g.date.default, ZoneOffset.UTC) : 0;
  return chapter;
}
interface ReaderProps {
  pages: { data: { list: PagesList } };
}
interface PagesList {
  root: string;
  code: number;
  head: string[];
  hash: string[];
  rand: string[];
  type: string[];
}
function toPages(l: PagesList): Page[] {
  return l.head
    .map((pageNumber, index) => [pageNumber, index] as const)
    .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
    .map(([pageNumber, originalIndex], sortedIndex) => new Page(sortedIndex, "", `${l.root}/${l.code}/${pageNumber.padStart(4, "0")}-${l.hash[originalIndex]}-${l.rand[originalIndex]}.${l.type[originalIndex]}`));
}

// --- Filters.kt
const categories: Record<string, string | number> = {
  All: "",
  Doujinshi: 1,
  Manga: 2,
  "Artist CG": 3,
  "Game CG": 4,
  Western: 5,
  "Non-H": 6,
  "Image Set": 7,
  Cosplay: 8,
  Misc: 9,
  "Asian Porn": 10,
  Private: 11,
};

const languages: Record<string, string> = {
  All: "",
  Japanese: "jp",
  English: "gb",
  Korean: "kr",
  Russian: "ru",
  Chinese: "cn",
  French: "fr",
  Italian: "it",
  Spanish: "es",
  Portuguese: "pt",
  German: "de",
  Thai: "th",
  Arabic: "sa",
  Turkish: "tr",
  Hebrew: "il",
  Tagalog: "ph",
  Ukrainian: "ua",
  Bulgarian: "bg",
  Dutch: "nl",
  Mongolian: "mn",
  Vietnamese: "vn",
  Macedonian: "mk",
  Polish: "pl",
  Hungarian: "hu",
  Norwegian: "no",
  Indonesian: "id",
  Lithuanian: "lt",
  Serbian: "rs",
  Persian: "ir",
  Croatian: "hr",
  Czech: "cz",
  Slovak: "sk",
  Romanian: "ro",
  Finnish: "fi",
  Greek: "gr",
  Swedish: "se",
  Latin: "va",
};

class SelectFilter extends Filter.Select<string> {
  constructor(name: string, readonly vals: string[], state = 0) {
    super(name, vals, state);
  }
}
class CategoryFilter extends SelectFilter {
  constructor() {
    super("Category", Object.keys(categories));
  }
}
class LanguageFilter extends SelectFilter {
  constructor() {
    super("Language", Object.keys(languages));
  }
}

export default class Yabai extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor((chain) => this.tokenInterceptor(chain));
  }

  private get inertiaHeaders() {
    const h = this.headers;
    h.append("Inertia-Req", "true");
    return h;
  }

  private popularCursors = new Map<number, string>();
  private searchCursors = new Map<number, string>();

  private inertiaVersion: string | null = null;
  private xsrfToken: string | null = null;

  private async tokenInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();

    // Only process requests marked for Inertia.
    if (request.headers.get("Inertia-Req") == null) return chain.proceed(request);

    if (this.inertiaVersion == null || this.xsrfToken == null) await this.updateTokens();

    let response = await this.proceedWithTokens(chain, request);

    // 409 = Inertia Version out of date, 419 = CSRF Token expired, 403 = DDOS-Guard
    if (response.code === 409 || response.code === 419 || response.code === 403) {
      await this.updateTokens();
      response = await this.proceedWithTokens(chain, request);
    }

    return response;
  }

  private proceedWithTokens(chain: Chain, request: ReturnType<Chain["request"]>): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.delete("Inertia-Req");
    headers.append("X-Requested-With", "XMLHttpRequest");
    headers.append("X-Inertia", "true");

    if (this.inertiaVersion) headers.append("X-Inertia-Version", this.inertiaVersion);

    if (request.method === "POST" || request.method === "PUT") {
      headers.set("Content-Type", "application/json");
      if (this.xsrfToken) headers.append("X-XSRF-TOKEN", this.xsrfToken);
    }

    return chain.proceed({ ...request, headers });
  }

  // upstream is @Synchronized: concurrent callers share one refresh
  private tokenUpdate: Promise<void> | null = null;
  private updateTokens(): Promise<void> {
    return (this.tokenUpdate ??= this.doUpdateTokens().finally(() => (this.tokenUpdate = null)));
  }

  private async doUpdateTokens() {
    // We do a normal GET to baseUrl (without X-Requested-With) so that client
    // can successfully handle the DDOS-Guard challenge via WebView if needed.
    const response = await this.client.get(this.baseUrl, this.headers, { ensureSuccess: false });

    // Extract CSRF token and URL Decode it (Fixes Laravel 419 mismatch)
    const cookie = this.client.cookieJar.loadForRequest(response.url).find((it) => it.name === "XSRF-TOKEN");
    if (cookie) this.xsrfToken = decodeURIComponent(cookie.value);

    // Extract current Inertia version
    const body = response.text();
    const match = /&quot;version&quot;:&quot;([^&]+)&quot;/.exec(body) ?? /"version":"([^"]+)"/.exec(body);
    if (match) this.inertiaVersion = match[1];

    if (this.xsrfToken == null || this.inertiaVersion == null) throw new Error("Failed to fetch tokens. Check if the site is accessible.");
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new CategoryFilter(), new LanguageFilter());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categoryFilter = firstInstanceOrNull(filters, CategoryFilter);
    const languageFilter = firstInstanceOrNull(filters, LanguageFilter);

    const catVal = categoryFilter ? String(categories[categoryFilter.vals[categoryFilter.state]] ?? "") : "";
    const lngVal = languageFilter ? (languages[languageFilter.vals[languageFilter.state]] ?? "") : "";

    return this.fetchGalleries(page, catVal, lngVal, query, this.searchCursors);
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchGalleries(page, "", "", "", this.popularCursors);
  }

  private async fetchGalleries(page: number, cat: string, lng: string, qry: string, cursors: Map<number, string>): Promise<MangasPage> {
    if (page === 1) cursors.clear();

    const queryBody: QueryDto = { cat, lng, qry, tag: "[]", cursor: page === 1 ? null : (cursors.get(page) ?? null) };

    // explicitNulls = false: a null cursor is left out
    const data = (await this.client.post(`${this.baseUrl}/g`, this.inertiaHeaders, JSON.stringify(queryBody, (_k, v: unknown) => (v === null ? undefined : v)))).parseAs<DataResponse<IndexProps>>();

    const galleries = data.props.post_list.data.map(galleryItemToSManga);

    const nextCursor = data.props.post_list.meta.next_cursor;
    if (nextCursor != null) cursors.set(page + 1, nextCursor);

    return new MangasPage(galleries, nextCursor != null);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const gallery = (await this.client.get(`${this.baseUrl}${manga.url}`, this.inertiaHeaders)).parseAs<DataResponse<DetailProps>>().props.post.data;
    return new SMangaUpdate(galleryToSManga(gallery), [galleryToSChapter(gallery)]);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return toPages((await this.client.get(`${this.baseUrl}${chapter.url}/read`, this.inertiaHeaders)).parseAs<DataResponse<ReaderProps>>().props.pages.data.list);
  }
}
