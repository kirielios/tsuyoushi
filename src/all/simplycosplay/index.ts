// Port of keiyoushi/extensions-source src/all/simplycosplay/SimplyCosplay.kt (+ SimplyCosplayDto.kt)
import {
  Filter,
  FilterList,
  HttpSource,
  GET,
  MangasPage,
  Page,
  SChapter,
  SManga,
  ListPreference,
  toHttpUrl,
  substringAfter,
  substringAfterLast,
  type ClientBuilder,
  type PreferenceScreen,
  type Request,
  type Response,
  type Chain,
  type HttpUrl,
  type HttpUrlBuilder,
} from "../../../sdk/index.ts";

// --- Dto
interface Data<T> {
  data: T;
}
interface Url {
  url?: string | null;
}
interface Urls {
  url?: string | null;
  thumb: Url;
}
interface Images {
  publish_date?: string | null;
  urls: Urls;
}
interface BrowseItem {
  title?: string | null;
  slug: string;
  type: string;
  preview: Images;
}
interface TagsResponse {
  aggs: { tag_names: { buckets: { key: string }[] } };
}
interface DetailsResponse {
  title?: string | null;
  slug: string;
  type: string;
  preview: Images;
  tags?: { name?: string | null }[] | null;
  image_count?: number | null;
}
interface PageResponse {
  images?: Images[] | null;
  preview: Images;
}

const titlecaseFirst = (s: string) => (s && s[0] !== s[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s);

function browseItemToSManga(item: BrowseItem): SManga {
  const manga = SManga.create();
  manga.title = item.title ?? "";
  manga.url = `/${item.type.toLowerCase().trim()}/new/${item.slug}`;
  manga.thumbnail_url = item.preview.urls.thumb.url ?? undefined;
  manga.description = item.preview.publish_date != null ? `Date: ${item.preview.publish_date}` : undefined;
  return manga;
}

function detailsToSManga(d: DetailsResponse): SManga {
  const manga = SManga.create();
  manga.title = d.title ?? "";
  manga.url = `/${d.type.toLowerCase().trim()}/new/${d.slug}`;
  manga.thumbnail_url = d.preview.urls.thumb.url ?? undefined;
  manga.genre = d.tags
    ?.flatMap((it) => (it.name != null ? [it.name.trim().split(" ").map(titlecaseFirst).join(" ")] : []))
    .join(", ");
  let description = `Type: ${d.type}\n`;
  if (d.image_count != null) description += `Images: ${d.image_count}\n`;
  if (d.preview.publish_date != null) description += `Date: ${d.preview.publish_date}\n`;
  manga.description = description;
  manga.status = SManga.COMPLETED; // update_strategy ONLY_FETCH_ONCE has no equivalent here
  return manga;
}

// --- Filters
class Tag extends Filter.CheckBox {}

class TagFilter extends Filter.Group<Tag> {
  constructor(title: string, tags: string[]) {
    super(title, tags.map((t) => new Tag(t)));
  }
  getSelected() {
    return this.state.filter((it) => it.state);
  }
}

class TypeFilter extends Filter.Select<string> {
  constructor(title: string, private readonly types: string[]) {
    super(title, types);
  }
  getValue() {
    return this.types[this.state].toLowerCase();
  }
}

class SortFilter extends Filter.Select<string> {
  constructor(title: string, private readonly sorts: string[]) {
    super(title, sorts);
  }
  getSort() {
    return this.sorts[this.state].toLowerCase();
  }
}

const LIMIT = 20;
const SEARCH_PREFIX = "url:";
const DEFAULT_TOKEN_PREF = "default_token_pref";
const DEFAULT_FALLBACK_TOKEN = "01730876";
const TOKEN_EXCEPTION = "Unable to fetch new Token";
const TokenRegex = /token\s*:\s*"([^"]+)/;
const BROWSE_TYPE_PREF_KEY = "default_browse_type_key";
const BROWSE_TYPE_TITLE = "Default Browse List";

export default class SimplyCosplay extends HttpSource {
  private readonly apiUrl = toHttpUrl("https://api.simply-porn.com/v2");

  override get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor((chain) => this.tokenIntercept(chain)).rateLimit(2);
  }

  protected override configureHeaders(headers: Headers) {
    headers.set("Referer", this.baseUrl);
    return headers;
  }

  private async tokenIntercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    if (new URL(request.url).host !== this.apiUrl.host) return chain.proceed(request);

    const url = new URL(request.url);
    url.searchParams.set("token", this.getToken());
    const response = await chain.proceed({ ...request, url: url.href });

    if (!response.isSuccessful && response.code === 403) {
      const newToken = await this.fetchNewToken();
      this.putToken(newToken);
      const newUrl = new URL(request.url);
      newUrl.searchParams.set("token", newToken);
      return chain.proceed({ ...request, url: newUrl.href });
    }
    return response;
  }

  private async fetchNewToken(): Promise<string> {
    const document = (await this.client.execute(GET(this.baseUrl, this.headers))).asJsoup();
    const scriptUrl = document.selectFirst("script[src*=main]")?.attr("abs:src");
    if (!scriptUrl) throw new Error(TOKEN_EXCEPTION);
    const scriptContent = (await this.client.execute(GET(scriptUrl, this.headers))).text().replaceAll("'", '"');
    const token = TokenRegex.exec(scriptContent)?.[1];
    if (!token) throw new Error(TOKEN_EXCEPTION);
    return token;
  }

  private browseUrlBuilder(endPoint: string, sort: string, page: number): HttpUrlBuilder {
    return this.apiUrl
      .newBuilder()
      .addPathSegment(endPoint)
      .addQueryParameter("sort", sort)
      .addQueryParameter("limit", String(LIMIT))
      .addQueryParameter("page", String(page));
  }

  protected popularMangaRequest(page: number): Request {
    return GET(this.browseUrlBuilder(this.getDefaultBrowse(), "hot", page).build(), this.headers);
  }

  protected async popularMangaParse(response: Response): Promise<MangasPage> {
    await this.fetchTags().catch(() => undefined);
    const result = response.parseAs<Data<BrowseItem[]>>();
    const entries = result.data.map(browseItemToSManga);
    const hasNextPage = result.data.length >= LIMIT;
    return new MangasPage(entries, hasNextPage);
  }

  protected latestUpdatesRequest(page: number): Request {
    return GET(this.browseUrlBuilder(this.getDefaultBrowse(), "new", page).build(), this.headers);
  }

  protected latestUpdatesParse(response: Response) {
    return this.popularMangaParse(response);
  }

  // upstream handles URLs in fetchSearchManga, so bypass KeiSource's URL handling
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = toHttpUrl(query);
      if (!["simply-cosplay.com", "www.simply-cosplay.com"].includes(url.host)) throw new Error("Unsupported url");
      if (url.pathSegments.length < 3) throw new Error("Unsupported url");
      const newQuery = `${SEARCH_PREFIX}/${url.pathSegments[0]}/new/${url.pathSegments[2]}`;
      return this.fetchSearchManga(page, newQuery, filters);
    }
    if (query.startsWith(SEARCH_PREFIX)) {
      const url = substringAfter(query, SEARCH_PREFIX);
      const manga = SManga.create();
      manga.url = url;
      return new MangasPage([await this.fetchMangaDetails(manga)], false);
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const sort = (filters.find((f) => f instanceof SortFilter) as SortFilter | undefined)?.getSort() ?? "new";
    const url = this.browseUrlBuilder("search", sort, page);
    if (query.length > 0) url.addQueryParameter("query", query);
    for (const filter of filters) {
      if (filter instanceof TagFilter) {
        filter.getSelected().forEach((tag, index) => url.addQueryParameter(`filter[tag_names][${index}]`, tag.name.replaceAll(" ", "+")));
      } else if (filter instanceof TypeFilter) {
        const it = filter.getValue();
        if (it.length > 0) url.addQueryParameter("filter[type][0]", it);
      }
    }
    return GET(url.build(), this.headers);
  }

  protected searchMangaParse(response: Response) {
    return this.popularMangaParse(response);
  }

  private tagList: string[] = [];
  private tagsFetchAttempt = 0;
  private tagsFetchFailed = false;

  private async fetchTags() {
    if (this.tagsFetchAttempt < 3 && (this.tagList.length === 0 || this.tagsFetchFailed)) {
      try {
        this.tagList = this.tagsParse(await this.client.execute(this.tagsRequest()));
        this.tagsFetchFailed = false;
      } catch (e) {
        console.error("SimplyHentaiTags", e);
        this.tagsFetchFailed = true;
        this.tagList = [];
      }
      this.tagsFetchAttempt++;
    }
  }

  private tagsRequest(): Request {
    return GET(this.apiUrl.newBuilder().addPathSegment("search").build(), this.headers);
  }

  private tagsParse(response: Response): string[] {
    return response.parseAs<TagsResponse>().aggs.tag_names.buckets.map((it) => it.key.trim());
  }

  override getFilterList(): FilterList {
    const filters: Filter[] = [new SortFilter("Sort", ["New", "Hot"]), new TypeFilter("Type", ["", "Image", "Gallery"])];
    if (this.tagList.length > 0) filters.push(new TagFilter("Tags", this.tagList));
    else filters.push(new Filter.Separator(), new Filter.Header("Press 'Reset' to attempt to show tags"));
    return FilterList(...filters);
  }

  private mangaUrlBuilder(dbUrl: string): HttpUrlBuilder {
    const pathSegments = dbUrl.split("/");
    const type = pathSegments[1];
    const slug = pathSegments[3];
    return this.apiUrl.newBuilder().addPathSegment(type).addPathSegments(slug);
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(this.mangaUrlBuilder(manga.url).build(), this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    return detailsToSManga(response.parseAs<Data<DetailsResponse>>().data);
  }

  override getMangaUrl(manga: SManga) {
    return this.baseUrl + manga.url;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const chapter = SChapter.create();
    chapter.url = manga.url;
    chapter.name = titlecaseFirst(manga.url.split("/")[1]);
    chapter.date_upload = parseDate(manga.description != null ? substringAfterLast(manga.description, "Date: ") : null);
    return [chapter];
  }

  override getChapterUrl(chapter: SChapter) {
    return this.baseUrl + chapter.url;
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(this.mangaUrlBuilder(chapter.url).build(), this.headers);
  }

  protected pageListParse(response: Response): Page[] {
    const result = response.parseAs<Data<PageResponse>>();
    const images = result.data.images;
    if (images) {
      const pages: Page[] = [];
      images.forEach((image, index) => {
        if (image.urls.url) pages.push(new Page(index, "", image.urls.url));
      });
      return pages;
    }
    return [new Page(1, "", result.data.preview.urls.url ?? undefined)];
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new ListPreference(undefined);
    p.key = BROWSE_TYPE_PREF_KEY;
    p.title = BROWSE_TYPE_TITLE;
    p.entries = ["Gallery", "Image"];
    p.entryValues = ["gallery", "image"];
    p.summary = "%s";
    p.setDefaultValue("gallery");
    screen.addPreference(p);
  }

  private getDefaultBrowse() {
    return this.preferences.getString(BROWSE_TYPE_PREF_KEY, "gallery")!;
  }
  private getToken() {
    return this.preferences.getString(DEFAULT_TOKEN_PREF, DEFAULT_FALLBACK_TOKEN) ?? DEFAULT_FALLBACK_TOKEN;
  }
  private putToken(token: string) {
    this.preferences.edit().putString(DEFAULT_TOKEN_PREF, token).commit();
  }

  protected chapterListParse(): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }
  protected imageUrlParse(): string {
    throw new Error("UnsupportedOperationException");
  }
}

/** SimpleDateFormat("yyy-MM-dd'T'HH:mm:ss.SSS") in the system zone; unparseable -> 0. */
function parseDate(s: string | null): number {
  const m = s != null ? /^(\d{3,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s) : null;
  if (!m) return 0;
  const [y, mo, d, h, mi, se, ms] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, se, ms).getTime();
}
