// Port of keiyoushi/extensions-source src/all/koharu/Koharu.kt
import {
  ClientBuilder,
  EditTextPreference,
  FilterList,
  GET,
  HttpClient,
  HttpSource,
  ListPreference,
  MangasPage,
  POST,
  Page,
  SChapter,
  SManga,
  SwitchPreferenceCompat,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { toSManga, toTag, type Books, type Entry, type Filter, type ImagesInfo, type MangaData, type MangaDetail, type DataKey } from "./dto.ts";
import {
  Artist,
  CategoryFilter,
  Circle,
  Female,
  Genre,
  GenreConditionFilter,
  Male,
  Mixed,
  Other,
  Parody,
  SortFilter,
  TagFilter,
  TextFilter,
  getFilters,
  type TagLists,
} from "./filters.ts";
import { KoharuTags } from "./tags.ts";

const PREFIX_ID_KEY_SEARCH = "id:";
const API_DOMAIN = "https://api.schale.network";
const PREF_IMAGERES = "pref_image_quality";
const PREF_REM_ADD = "pref_remove_additional";
const PREF_EXCLUDE_TAGS = "pref_exclude_tags";

export default class Koharu extends HttpSource {
  private get searchLang(): string {
    switch (this.lang) {
      case "en":
        return "english";
      case "ja":
        return "japanese";
      case "zh":
        return "chinese";
      default:
        return "";
    }
  }

  private readonly apiUrl = API_DOMAIN;

  private readonly apiBooksUrl = `${this.apiUrl}/books`;

  private readonly shortenTitleRegex = /(\[[^\]]*]|[({][^)}]*[)}])/g;
  private shortenTitle(s: string) {
    return s.replace(this.shortenTitleRegex, "").trim();
  }

  private quality() {
    return this.preferences.getString(PREF_IMAGERES, "1280")!;
  }

  private remadd() {
    return this.preferences.getBoolean(PREF_REM_ADD, false);
  }

  private alwaysExcludeTags() {
    return this.preferences.getString(PREF_EXCLUDE_TAGS, "");
  }

  private domainUrlCache: Promise<string> | null = null;
  private get domainUrl(): Promise<string> {
    return (this.domainUrlCache ??= this.getDomain());
  }

  /**
   * Upstream reads the Location header with a no-redirect client; the host always follows redirects, so the final
   * URL's host stands in for it (same result for schale.network's single 302 to the current mirror).
   */
  private async getDomain(): Promise<string> {
    try {
      const response = await this.client.execute(GET(this.baseUrl, this.headers));
      const host = toHttpUrlOrNull(response.url)?.host;
      if (host == null || host === toHttpUrl(this.baseUrl).host) return this.baseUrl;
      return `https://${host}`;
    } catch {
      return this.baseUrl;
    }
  }

  private resolvedLazyHeaders: Headers | null = null;
  private lazyHeadersCache: Promise<Headers> | null = null;
  private get lazyHeaders(): Promise<Headers> {
    return (this.lazyHeadersCache ??= this.domainUrl.then((domainUrl) => {
      const headers = this.headersBuilder();
      headers.set("Referer", `${domainUrl}/`);
      headers.set("Origin", domainUrl);
      return (this.resolvedLazyHeaders = headers);
    }));
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  private _clearanceClient?: HttpClient;
  private get clearanceClient(): HttpClient {
    return (this._clearanceClient ??= new HttpClient(
      this.host,
      () => this.headers,
      new ClientBuilder()
        .addChainInterceptor(async (chain) => {
          const request = chain.request();
          const url = request.url;
          const clearance = this.getClearance();
          if (clearance == null) throw new Error("Open webview to refresh token");

          const newUrl = toHttpUrl(url).newBuilder().setQueryParameter("crt", clearance).build();
          const newRequest = { ...request, url: newUrl.toString() };

          const response = await chain.proceed(newRequest);

          if (![400, 403].includes(response.code)) {
            return response;
          }
          this._clearance = null;
          throw new Error("Open webview to refresh token");
        })
        .rateLimit(3),
    ));
  }

  private _clearance: string | null = null;

  /**
   * Upstream loads "$domainUrl/" in a WebView, lets the site's scripts run and reads localStorage 'clearance'.
   * Executing the site's code is not ported, so no token is ever obtained and the clearance client throws
   * "Open webview to refresh token" (page lists and related titles).
   */
  getClearance(): string | null {
    return this._clearance;
  }

  private getManga(book: Entry): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(`${book.id}/${book.key}`);
    manga.title = this.remadd() ? this.shortenTitle(book.title) : book.title;
    manga.thumbnail_url = book.thumbnail.path;
    return manga;
  }

  private async getImagesByMangaData(entry: MangaData, entryId: string, entryKey: string): Promise<[ImagesInfo, string]> {
    const data = entry.data;
    const getIPK = (...keys: (DataKey | null | undefined)[]): [number | null, string | null] => [
      keys.map((k) => k?.id).find((it) => it != null) ?? null,
      keys.map((k) => k?.key).find((it) => it != null) ?? null,
    ];
    let ipk: [number | null, string | null];
    switch (this.quality()) {
      case "1600":
        ipk = getIPK(data["1600"], data["1280"], data["0"], data["980"], data["780"]);
        break;
      case "1280":
        ipk = getIPK(data["1280"], data["1600"], data["0"], data["980"], data["780"]);
        break;
      case "980":
        ipk = getIPK(data["980"], data["1280"], data["0"], data["1600"], data["780"]);
        break;
      case "780":
        ipk = getIPK(data["780"], data["980"], data["0"], data["1280"], data["1600"]);
        break;
      default:
        ipk = getIPK(data["0"], data["1600"], data["1280"], data["980"], data["780"]);
    }
    const [id, public_key] = ipk;

    if (id == null || public_key == null) {
      throw new Error("No Images Found");
    }

    let realQuality: string;
    if (id === data["1600"]?.id) realQuality = "1600";
    else if (id === data["1280"]?.id) realQuality = "1280";
    else if (id === data["980"]?.id) realQuality = "980";
    else if (id === data["780"]?.id) realQuality = "780";
    else realQuality = "0";

    const imagesResponse = await this.clearanceClient.execute(GET(`${this.apiBooksUrl}/data/${entryId}/${entryKey}/${id}/${public_key}/${realQuality}`, await this.lazyHeaders));
    return [imagesResponse.parseAs<ImagesInfo>(), realQuality];
  }

  private alwaysExcludeTagsList(): string[] {
    return (
      this.alwaysExcludeTags()
        ?.split(",")
        .map((it) => it.trim())
        .filter((it) => it.trim() !== "") ?? []
    );
  }

  // Latest

  protected async latestUpdatesRequest(page: number): Promise<Request> {
    const url = toHttpUrl(this.apiBooksUrl).newBuilder();
    url.addQueryParameter("page", String(page));

    const terms: string[] = [];
    if (this.lang !== "all") terms.push(`language:"^${this.searchLang}$"`);
    const alwaysExcludeTags = this.alwaysExcludeTagsList();
    if (alwaysExcludeTags.length) {
      terms.push(`tag:"${alwaysExcludeTags.map((it) => `-${it}`).join(",")}"`);
    }
    if (terms.length) url.addQueryParameter("s", terms.join(" "));
    return GET(url.build(), await this.lazyHeaders);
  }

  protected latestUpdatesParse(response: Response) {
    return this.popularMangaParse(response);
  }

  // Popular

  protected async popularMangaRequest(page: number): Promise<Request> {
    const url = toHttpUrl(this.apiBooksUrl).newBuilder();
    url.addQueryParameter("sort", "8");
    url.addQueryParameter("page", String(page));

    const terms: string[] = [];
    if (this.lang !== "all") terms.push(`language:"^${this.searchLang}$"`);
    const alwaysExcludeTags = this.alwaysExcludeTagsList();
    if (alwaysExcludeTags.length) {
      terms.push(`tag:"${alwaysExcludeTags.map((it) => `-${it}`).join(",")}"`);
    }
    if (terms.length) url.addQueryParameter("s", terms.join(" "));
    return GET(url.build(), await this.lazyHeaders);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const data = response.parseAs<Books>();
    return new MangasPage((data.entries ?? []).map((it) => this.getManga(it)), data.page * (data.limit ?? 0) < (data.total ?? 0));
  }

  // Search

  /** KeiSource routes pasted URLs here before fetchSearchManga; hand them to upstream's URL branch. */
  protected override getMangasByUrl(url: URL, page: number): Promise<MangasPage> {
    return this.fetchSearchManga(page, url.toString(), this.getFilterList());
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = toHttpUrl(query);
      const id = `${url.pathSegments[1]}/${url.pathSegments[2]}`;
      return this.fetchSearchManga(page, `${PREFIX_ID_KEY_SEARCH}${id}`, filters);
    }
    if (query.startsWith(PREFIX_ID_KEY_SEARCH)) {
      const ipk = query.slice(PREFIX_ID_KEY_SEARCH.length);
      const response = await this.client.execute(GET(`${this.apiBooksUrl}/detail/${ipk}`, await this.lazyHeaders));
      return new MangasPage([this.mangaDetailsParse(response)], false);
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected async searchMangaRequest(page: number, query: string, filters: FilterList): Promise<Request> {
    const url = toHttpUrl(this.apiBooksUrl).newBuilder();
    const terms: string[] = [];
    const includedTags: number[] = [];
    const excludedTags: number[] = [];

    if (this.lang !== "all") terms.push(`language:"^${this.searchLang}$"`);
    const alwaysExcludeTags = this.alwaysExcludeTagsList();
    if (alwaysExcludeTags.length) {
      terms.push(`tag:"${alwaysExcludeTags.map((it) => `-${it}`).join(",")}"`);
    }

    for (const filter of filters) {
      if (filter instanceof SortFilter) url.addQueryParameter("sort", filter.getValue());
      else if (filter instanceof CategoryFilter) {
        const activeFilter = filter.state.filter((it) => it.state);
        if (activeFilter.length) {
          url.addQueryParameter("cat", String(activeFilter.reduce((sum, it) => sum + it.value, 0)));
        }
      } else if (filter instanceof TagFilter) {
        includedTags.push(...filter.state.filter((it) => it.isIncluded()).map((it) => it.id));
        excludedTags.push(...filter.state.filter((it) => it.isExcluded()).map((it) => it.id));
      } else if (filter instanceof GenreConditionFilter) {
        if (filter.state > 0) {
          url.addQueryParameter(filter.param, filter.toUriPart());
        }
      } else if (filter instanceof TextFilter) {
        if (filter.state.length) {
          const tags = filter.state
            .split(",")
            .filter((it) => it.trim() !== "")
            .join(",");
          if (tags.trim() !== "") {
            terms.push(`${filter.type}:` + (filter.type === "pages" ? tags : `"${tags}"`));
          }
        }
      }
    }

    if (includedTags.length) {
      url.addQueryParameter("include", includedTags.join(","));
    }
    if (excludedTags.length) {
      url.addQueryParameter("exclude", excludedTags.join(","));
    }

    if (query.length) terms.push(`title:"${query}"`);
    if (terms.length) url.addQueryParameter("s", terms.join(" "));
    url.addQueryParameter("page", String(page));

    return GET(url.build(), await this.lazyHeaders);
  }

  protected searchMangaParse(response: Response) {
    return this.popularMangaParse(response);
  }

  /**
   * Upstream's getFilterList launches fetchTags() (at most 3 attempts) and replaces KoharuFilters' lists when it
   * succeeds; here the host fetches through fetchFilterData and passes the result back as `data`.
   */
  override get supportsFilterFetching() {
    return true;
  }

  /** fetchTags(): the genres from the source to be used in the filters. */
  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.execute(GET(`${this.apiBooksUrl}/tags/filters`, await this.lazyHeaders))).parseAs<Filter[]>();
  }

  override getFilterList(data: unknown = null): FilterList {
    let lists: TagLists = KoharuTags;
    if (Array.isArray(data) && data.length) {
      const tags = (data as Filter[]).map(toTag);
      lists = {
        genreList: tags.filter((it) => it instanceof Genre),
        femaleList: tags.filter((it) => it instanceof Female),
        maleList: tags.filter((it) => it instanceof Male),
        artistList: tags.filter((it) => it instanceof Artist),
        circleList: tags.filter((it) => it instanceof Circle),
        parodyList: tags.filter((it) => it instanceof Parody),
        mixedList: tags.filter((it) => it instanceof Mixed),
        otherList: tags.filter((it) => it instanceof Other),
      };
    }
    return getFilters(lists);
  }

  // Details

  override async mangaDetailsRequest(manga: SManga): Promise<Request> {
    return GET(`${this.apiBooksUrl}/detail/${manga.url}`, await this.lazyHeaders);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const mangaDetail = response.parseAs<MangaDetail>();
    const manga = toSManga(mangaDetail);
    manga.url = urlWithoutDomain(`${mangaDetail.id}/${mangaDetail.key}`);
    manga.title = this.remadd() ? this.shortenTitle(mangaDetail.title) : mangaDetail.title;
    return manga;
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/g/${manga.url}`;
  }

  // Chapter

  protected override async chapterListRequest(manga: SManga): Promise<Request> {
    return GET(`${this.apiBooksUrl}/detail/${manga.url}`, await this.lazyHeaders);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const manga = response.parseAs<MangaDetail>();
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = `${manga.id}/${manga.key}`;
    chapter.date_upload = manga.updated_at ?? manga.created_at ?? 0;
    return [chapter];
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/g/${chapter.url}`;
  }

  // Page List

  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse(await this.clearanceClient.execute(await this.pageListRequest(chapter), true));
  }

  protected override async pageListRequest(chapter: SChapter): Promise<Request> {
    return POST(`${this.apiBooksUrl}/detail/${chapter.url}`, await this.lazyHeaders);
  }

  protected async pageListParse(response: Response): Promise<Page[]> {
    const mangaData = response.parseAs<MangaData>();
    const url = response.url;
    const matches = /\/detail\/(\d+)\/([a-z\d]+)/.exec(url);
    if (matches == null || matches.length < 3) return [];
    const imagesInfo = await this.getImagesByMangaData(mangaData, matches[1], matches[2]);

    return imagesInfo[0].entries.map((image, index) => new Page(index, "", `${imagesInfo[0].base}/${image.path}?w=${imagesInfo[1]}`));
  }

  override imageRequest(page: Page): Request {
    return GET(page.imageUrl!, this.resolvedLazyHeaders ?? this.headers);
  }

  /** imageRequest is synchronous here; make sure lazyHeaders is resolved first. */
  override async getImage(page: Page): Promise<Response> {
    await this.lazyHeaders;
    return super.getImage(page);
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  protected override async relatedMangaListRequest(manga: SManga): Promise<Request> {
    return POST(`${this.apiBooksUrl}/detail/${manga.url}`, await this.lazyHeaders);
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const response = await this.clearanceClient.execute(await this.relatedMangaListRequest(manga), true);
    const data = response.parseAs<MangaData>();
    return (data.similar ?? []).map((it) => this.getManga(it));
  }

  // Settings

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const imageRes = new ListPreference(screen.context);
    imageRes.key = PREF_IMAGERES;
    imageRes.title = "Image Resolution";
    imageRes.entries = ["780x", "980x", "1280x", "1600x", "Original"];
    imageRes.entryValues = ["780", "980", "1280", "1600", "0"];
    imageRes.summary = "%s";
    imageRes.setDefaultValue("1280");
    screen.addPreference(imageRes);

    const remAdd = new SwitchPreferenceCompat(screen.context);
    remAdd.key = PREF_REM_ADD;
    remAdd.title = "Remove additional information in title";
    remAdd.summary = "Remove anything in brackets from manga titles.\n" + "Reload manga to apply changes to loaded manga.";
    remAdd.setDefaultValue(false);
    screen.addPreference(remAdd);

    const excludeTags = new EditTextPreference(screen.context);
    excludeTags.key = PREF_EXCLUDE_TAGS;
    excludeTags.title = "Tags to exclude from browse/search";
    excludeTags.summary = "Separate tags with commas (,).\n" + `Excluding: ${this.alwaysExcludeTags()}`;
    screen.addPreference(excludeTags);
  }
}
