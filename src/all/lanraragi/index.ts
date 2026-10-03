// Port of keiyoushi/extensions-source src/all/lanraragi/LANraragi.kt
import {
  Base64, CheckBoxPreference, EditTextPreference, Filter, FilterList, HttpSource, ListPreference, MangasPage, Page, SChapter, SManga, toHttpUrl, utf8,
  type ClientBuilder, type PreferenceScreen, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET } from "../../../sdk/httpsource.ts";
import type { Archive, ArchivePage, ArchiveSearchResult, ArchiveTOCEntry, Category, Tankoubon } from "./dto.ts";

const REGEX_ID_FROM_URL = /(?:\/reader\?id=)?(TANK_[0-9]{10}|\w{40})(?:\/thumbnail)?/;

const HOSTNAME_DEFAULT = "http://127.0.0.1:3000";
const HOSTNAME_KEY = "hostname";
const APIKEY_KEY = "apiKey";
const CUSTOM_LABEL_KEY = "customLabel";

const REDUPE_KEY = "redupePref";
const REDUPE_DEFAULT = false;
const NEW_ONLY_DEFAULT = true;
const NEW_ONLY_KEY = "latestNewOnly";
const SORT_BY_NS_DEFAULT = "date_added";
const SORT_BY_NS_KEY = "latestNamespacePref";
const SORT_ORDER_DEFAULT = "desc";
const SORT_ORDER_KEY = "latestSortOrder";
const RANDOM_SIZE_DEFAULT = "100";
const RANDOM_SIZE_KEY = "randomPageSize";
const CLEAR_NEW_KEY = "clearNew";
const CLEAR_NEW_DEFAULT = true;
const URL_TAG_PREFIX_KEY = "urlTagPrefix";
const URL_TAG_PREFIX_DEFAULT = "";

/** android.net.Uri.Builder, reduced to path + query (values percent-encoded like Uri.encode). */
class UriBuilder {
  private readonly params: [string, string][] = [];
  constructor(private url: string) {}
  appendPath(segment: string) {
    this.url = `${this.url.replace(/\/+$/, "")}/${encodeURIComponent(segment)}`;
    return this;
  }
  appendQueryParameter(key: string, value: string) {
    this.params.push([key, value]);
    return this;
  }
  build(): string {
    return this.params.length ? `${this.url}?${this.params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : this.url;
  }
}

/** Kotlin's Float.toString(): shortest decimal that round-trips the 32-bit float, integers keep ".0". */
function floatToString(value: number): string {
  const f = Math.fround(value);
  if (Number.isInteger(f)) return `${f}.0`;
  for (let p = 1; p < 10; p++) {
    const s = f.toPrecision(p);
    if (Math.fround(Number(s)) === f) return String(Number(s));
  }
  return String(f);
}

const toLongOrNull = (s: string | undefined): number | null => (s != null && /^[+-]?\d+$/.test(s) ? Number(s) : null);
const toIntOrNull = (s: string): number | null => (/^[+-]?\d+$/.test(s) && Math.abs(Number(s)) <= 2 ** 31 ? Number.parseInt(s, 10) : null);

class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[1]),
    );
  }
  toUriPart() {
    return this.vals[this.state][0];
  }
}
class CategorySelect extends UriPartFilter {
  constructor(categories: [string, string][]) {
    super("Category", categories);
  }
}
class SortSelect extends UriPartFilter {
  constructor(sortOrders: [string, string][]) {
    super("Sort order", sortOrders);
  }
}
class NewArchivesOnly extends Filter.CheckBox {
  constructor(overrideState = false) {
    super("New Archives only", overrideState);
  }
}
class UntaggedArchivesOnly extends Filter.CheckBox {
  constructor() {
    super("Untagged Archives only", false);
  }
}
class HideCompleted extends Filter.CheckBox {
  constructor() {
    super("Hide Completed", false);
  }
}
class GroupByTanks extends Filter.CheckBox {
  constructor() {
    super("Group by Tankoubon", true);
  }
}
class StartingPage extends Filter.Text {
  constructor(stats: string) {
    super(`Starting page${stats}`, "");
  }
}
class SortByNamespace extends Filter.Text {
  constructor(defaultText = "") {
    super("Sort by (namespace)", defaultText);
  }
}

const sortOrders: [string, string][] = [
  ["asc", "Ascending"],
  ["desc", "Descending"],
  ["random", "Random"],
];

export default class LANraragi extends HttpSource {
  constructor(...args: ConstructorParameters<typeof HttpSource>) {
    super(...args);
    // override val name by lazy { "LANraragi (${customLabel.ifBlank { instanceNumber }})" }: the factory's fixed
    // instances are told apart by position (ids end in ":2" for the second source)
    const instanceNumber = /:(\d+)$/.exec(this.meta.id.replace(/^kei:[^:]+:[^:]+/, ""))?.[1] ?? "1";
    const label = this.getPrefCustomLabel().trim() === "" ? instanceNumber : this.getPrefCustomLabel();
    (this as unknown as { name: string }).name = `LANraragi (${label})`;
  }

  private _baseUrl?: string;
  // override val baseUrl by lazy { getPrefBaseUrl() }
  override get baseUrl(): string {
    return (this._baseUrl ??= this.getPrefBaseUrl());
  }

  override get supportsLatest() {
    return true;
  }

  private _apiKey?: string;
  private get apiKey() {
    return (this._apiKey ??= this.getPrefAPIKey());
  }
  private _latestNamespacePref?: string;
  private get latestNamespacePref() {
    return (this._latestNamespacePref ??= this.getPrefLatestNS());
  }
  private _latestSortOrderPref?: string;
  private get latestSortOrderPref() {
    return (this._latestSortOrderPref ??= this.getPrefLatestSortOrder());
  }
  private _randomPageSizePref?: string;
  private get randomPageSizePref() {
    return (this._randomPageSizePref ??= this.getPrefRandomPageSize());
  }

  private randomArchiveID = "";

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const id = manga.url.startsWith("/api/search/random") ? this.randomArchiveID : this.getIDFromURL(manga.url);
    const uri = this.apiTypeByID(id);

    if (manga.url.startsWith("/api/search/random")) {
      const randQuery = manga.url.includes("?") ? manga.url.slice(manga.url.indexOf("?") + 1).replace(/#.*$/, "") : "null";
      this.randomArchiveID = await this.getRandomID(randQuery);
    }

    const response = await this.executeSuccess(GET(uri, this.headers));
    const details = this.mangaDetailsParse(response);
    details.initialized = true;
    return details;
  }

  override mangaDetailsRequest(manga: SManga): Request {
    // Catch-all that includes random's ID via thumbnail
    const id = this.getIDFromURL(manga.thumbnail_url!);

    return GET(`${this.baseUrl}/reader?id=${id}`, this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    let archive: Archive;
    if (!this.isTank(response)) archive = response.parseAs<Archive>();
    else {
      const tank = response.parseAs<Tankoubon>();

      // The separators are not the default ", " to merge properly when combining across multiple archives: ",tag:x" vs ", tag:x"
      const tags = tank.result?.full_data
        ?.map((it) => it.tags!)
        .join(",")
        .split(",")
        .sort()
        .join(",");

      archive = {
        arcid: tank.result!.id,
        isnew: false,
        tags: tags ?? null,
        summary: tank.result!.summary,
        title: tank.result!.name!,
        toc: [],
        pagecount: 0,
      };
    }

    return this.archiveToSManga(archive);
  }

  override getMangaUrl(manga: SManga): string {
    const namespace = this.preferences.getString(URL_TAG_PREFIX_KEY, URL_TAG_PREFIX_DEFAULT);

    if (!namespace) return super.getMangaUrl(manga);

    const tag = manga.genre?.split(", ").find((it) => it.startsWith(namespace));
    return tag != null ? tag.substring(tag.indexOf(namespace) + namespace.length) : super.getMangaUrl(manga);
  }

  protected override chapterListRequest(manga: SManga): Request {
    const id = manga.url.startsWith("/api/search/random") ? this.randomArchiveID : this.getIDFromURL(manga.url);
    const uri = this.apiTypeByID(id);

    return GET(uri, this.headers);
  }

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    const archives = !this.isTank(response) ? [response.parseAs<Archive>()] : response.parseAs<Tankoubon>().result?.full_data;

    // Legacy extension-exclusive behavior to remove isnew on single archives when viewing
    const prefClearNew = this.preferences.getBoolean(CLEAR_NEW_KEY, CLEAR_NEW_DEFAULT);
    if (prefClearNew && archives?.length === 1 && archives[0].isnew) {
      await this.client.execute({ url: `${this.baseUrl}/api/archives/${archives[0].arcid}/isnew`, method: "DELETE", headers: this.headers });
    }

    let baseChapter = 0;

    // Supports single, single+ToC, tank, tank+ToC...
    for (const arc of archives ?? []) {
      baseChapter = Math.fround(baseChapter + 1);

      const baseFiles = this.getApiUriBuilder(`/api/archives/${arc.arcid}/files`).build();
      const date = 1000 * (toLongOrNull(this.getNSTag(arc.tags, "date_added")?.[0]) ?? 0);

      if (arc.toc != null && arc.toc.length > 0) {
        let lastStart = 0;

        const toc: ArchiveTOCEntry[] = [];
        if (arc.toc[0].page > 1) toc.push({ name: arc.title, page: 1 }); // Starting gap filler
        toc.push(...arc.toc);

        toc.forEach((entry, i) => {
          const nextPage = i + 1 < toc.length ? toc[i + 1].page - 1 : arc.pagecount;

          const chapter = SChapter.create();
          chapter.url = `${baseFiles}#${lastStart}-${nextPage}`;
          chapter.chapter_number = Math.fround(baseChapter + Math.fround(Number(`0.${i + 1}`)));
          chapter.name = `${floatToString(chapter.chapter_number)} - ${entry.name}`;
          chapter.date_upload = date;
          chapters.push(chapter);

          lastStart = nextPage;
        });
      } else {
        const chapter = SChapter.create();
        chapter.url = baseFiles;
        chapter.chapter_number = baseChapter;
        chapter.name = archives!.length === 1 ? "Chapter" : `${Math.trunc(chapter.chapter_number)} - ${arc.title}`;
        chapter.date_upload = date;
        chapters.push(chapter);
      }
    }
    chapters.reverse(); // For tanks orders them in "latest first"

    return chapters;
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(chapter.url, this.headers);
  }

  // The fragment ("#from-to") is not part of what the host reports back as the response URL, so it is passed along
  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.executeSuccess(await this.pageListRequest(chapter));
    return this.parsePages(response, chapter.url.includes("#") ? chapter.url.slice(chapter.url.indexOf("#") + 1) : null);
  }

  protected pageListParse(response: Response): Page[] {
    const hash = new URL(response.url).hash.replace(/^#/, "");
    return this.parsePages(response, hash || null);
  }

  private parsePages(response: Response, fragment: string | null): Page[] {
    const archivePage = response.parseAs<ArchivePage>();
    const range = fragment?.split("-").map((it) => {
      const n = toIntOrNull(it);
      if (n == null) throw new Error(`For input string: "${it}"`);
      return n;
    }) ?? [0, archivePage.pages.length];

    return archivePage.pages.slice(range[0], range[range.length - 1]).map((url, index) => {
      let newUrl = url;
      const subPath = new URL(this.baseUrl).pathname.replace(/^\/$/, "");
      if (subPath) newUrl = newUrl.replace(subPath, "");
      const uri = `${this.baseUrl}${newUrl.replace(/^\.+/, "")}`;
      return new Page(index, uri, uri);
    });
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("imageUrlParse is unused");
  }

  protected popularMangaRequest(page: number): Request {
    return this.searchMangaRequest(page, "", FilterList());
  }

  protected popularMangaParse(response: Response): Promise<MangasPage> {
    return this.searchMangaParse(response);
  }

  protected latestUpdatesRequest(page: number): Request {
    const filters: Filter[] = [];
    const prefNewOnly = this.preferences.getBoolean(NEW_ONLY_KEY, NEW_ONLY_DEFAULT);

    if (prefNewOnly) filters.push(new NewArchivesOnly(true));

    if (this.latestNamespacePref.trim() !== "") filters.push(new SortByNamespace(this.latestNamespacePref));

    filters.push(new SortSelect(sortOrders.filter((it) => it[0] === this.latestSortOrderPref)));

    return this.searchMangaRequest(page, "", FilterList(...filters));
  }

  protected latestUpdatesParse(response: Response): Promise<MangasPage> {
    return this.searchMangaParse(response);
  }

  private lastResultCount = 0;
  private lastRecordsFiltered = 0;
  private maxResultCount = 0;
  private totalRecords = 0;

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const uri = this.getApiUriBuilder("/api/search");
    let startPageOffset = 0;

    if (page === 1) this.lastResultCount = 0;

    for (const filter of filters) {
      if (filter instanceof StartingPage) {
        startPageOffset = toIntOrNull(filter.state) ?? 1;

        // Exception for API wrapping around and user input of 0
        if (startPageOffset > 0) startPageOffset -= 1;
      } else if (filter instanceof NewArchivesOnly) {
        if (filter.state) uri.appendQueryParameter("newonly", "true");
      } else if (filter instanceof UntaggedArchivesOnly) {
        if (filter.state) uri.appendQueryParameter("untaggedonly", "true");
      } else if (filter instanceof HideCompleted) {
        if (filter.state) uri.appendQueryParameter("hidecompleted", "true");
      } else if (filter instanceof GroupByTanks) {
        uri.appendQueryParameter("groupby_tanks", String(filter.state));
      } else if (filter instanceof SortByNamespace) {
        if (filter.state.length > 0) uri.appendQueryParameter("sortby", filter.state.trim());
      } else if (filter instanceof CategorySelect) {
        if (filter.state > 0) uri.appendQueryParameter("category", filter.toUriPart());
      } else if (filter instanceof SortSelect) {
        if (filter.toUriPart() === "random") {
          uri.appendPath("random");
          uri.appendQueryParameter("count", this.randomPageSizePref);
        } else uri.appendQueryParameter("order", filter.toUriPart());
      }
    }

    uri.appendQueryParameter("start", String((page - 1 + startPageOffset) * this.lastResultCount));

    if (query.length > 0) uri.appendQueryParameter("filter", query);

    // CacheControl.FORCE_NETWORK: there is no HTTP cache here
    return GET(uri.build(), this.headers);
  }

  protected async searchMangaParse(response: Response): Promise<MangasPage> {
    const jsonResult = response.parseAs<ArchiveSearchResult>();
    const currentStart = this.getStart(response);
    const archives: SManga[] = [];

    this.lastResultCount = jsonResult.data.length;
    this.maxResultCount = Math.max(this.lastResultCount, this.maxResultCount);
    this.lastRecordsFiltered = jsonResult.recordsFiltered ?? -2;
    this.totalRecords = jsonResult.recordsTotal;

    const isRandom = this.lastResultCount > this.lastRecordsFiltered;
    const hasNext = currentStart + this.lastResultCount < this.lastRecordsFiltered || isRandom;

    if (this.lastResultCount > 1 && currentStart === 0) {
      const randQuery = new URL(response.url).search.replace(/^\?/, "") || "null";
      this.randomArchiveID = await this.getRandomID(randQuery);

      const random = SManga.create();
      random.url = `/api/search/random?count=1&${randQuery}`;
      random.title = "Random";
      random.description = "Refresh for a random archive.";
      random.thumbnail_url = this.getThumbnailUri("0".repeat(40));
      archives.push(random);
    }

    for (const it of jsonResult.data) archives.push(this.archiveToSManga(it, isRandom));

    return new MangasPage(archives, hasNext);
  }

  private archiveToSManga(archive: Archive, isRandom = false): SManga {
    const manga = SManga.create();
    manga.url = `/reader?id=${archive.arcid}`;
    if (isRandom && this.preferences.getBoolean(REDUPE_KEY, REDUPE_DEFAULT)) manga.url += `&ts${Date.now()}`;
    manga.title = archive.title;
    manga.description = !archive.summary || archive.summary.trim() === "" ? archive.title : archive.summary;
    manga.thumbnail_url = this.getThumbnailUri(archive.arcid);
    manga.genre = archive.tags?.replaceAll(",", ", ");
    manga.artist = this.getNSTag(archive.tags, "artist")?.join(", ");
    manga.author = this.getNSTag(archive.tags, "group")?.join(", ") ?? manga.artist;
    manga.status = SManga.COMPLETED;
    return manga;
  }

  override headersBuilder(): Headers {
    const headers = new Headers();
    if (this.apiKey.length > 0) {
      const apiKey64 = Base64.encode(utf8(this.apiKey));
      headers.append("Authorization", `Bearer ${apiKey64}`);
    }
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const response = await chain.proceed(chain.request());
      if (response.code === 401) throw new Error("If the server is in No-Fun Mode make sure the extension's API Key is correct.");
      return response;
    });
  }

  // Categories come from fetchFilterData (upstream refreshes them in the background on every getFilterList call)
  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.baseUrl}/api/categories`, this.headers)).parseAs<Category[]>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const categories = (data as Category[] | null) ?? [];
    return FilterList(
      new CategorySelect(this.getCategoryPairs(categories)),
      new SortSelect(sortOrders),
      new NewArchivesOnly(),
      new UntaggedArchivesOnly(),
      new HideCompleted(),
      new GroupByTanks(),
      new StartingPage(this.startingPageStats()),
      new SortByNamespace(),
    );
  }

  // Preferences
  private getPrefBaseUrl = (): string => this.preferences.getString(HOSTNAME_KEY, HOSTNAME_DEFAULT)!;
  private getPrefAPIKey = (): string => this.preferences.getString(APIKEY_KEY, "")!;
  private getPrefLatestNS = (): string => this.preferences.getString(SORT_BY_NS_KEY, SORT_BY_NS_DEFAULT)!;
  private getPrefLatestSortOrder = (): string => this.preferences.getString(SORT_ORDER_KEY, SORT_ORDER_DEFAULT)!;
  private getPrefRandomPageSize = (): string => this.preferences.getString(RANDOM_SIZE_KEY, RANDOM_SIZE_DEFAULT)!;
  private getPrefCustomLabel = (): string => this.preferences.getString(CUSTOM_LABEL_KEY, "")!;

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    // Upstream toasts "Restart app to apply new setting." when these change; the values are read once per source.
    const randomPageSize = new ListPreference(screen.context);
    randomPageSize.key = RANDOM_SIZE_KEY;
    randomPageSize.title = "Random Sort - Pagination amount";
    randomPageSize.entries = ["25", "50", "100", "250", "1000"];
    randomPageSize.entryValues = randomPageSize.entries;
    randomPageSize.setDefaultValue(RANDOM_SIZE_DEFAULT);
    randomPageSize.summary = "Request %s entries at a time in Random sort order. Lower may be more responsive while higher may be less disruptive.";

    const latestSortOrder = new ListPreference(screen.context);
    latestSortOrder.key = SORT_ORDER_KEY;
    latestSortOrder.title = "Latest - Default Sort Order";
    latestSortOrder.entries = sortOrders.map((it) => it[1]);
    latestSortOrder.entryValues = sortOrders.map((it) => it[0]);
    latestSortOrder.setDefaultValue(SORT_ORDER_DEFAULT);
    latestSortOrder.summary = "%s";

    screen.addPreference(this.editTextPreference(screen, HOSTNAME_KEY, "Hostname", HOSTNAME_DEFAULT, this.baseUrl));
    screen.addPreference(this.editTextPreference(screen, APIKEY_KEY, "API Key", "", "Required if No-Fun Mode is enabled."));
    screen.addPreference(this.editTextPreference(screen, CUSTOM_LABEL_KEY, "Custom Label", "", "Show the given label for the source instead of the default."));
    screen.addPreference(this.checkBoxPreference(screen, CLEAR_NEW_KEY, "Clear New status", CLEAR_NEW_DEFAULT, "Clear an entry's New status when its details are viewed."));
    screen.addPreference(this.checkBoxPreference(screen, NEW_ONLY_KEY, "Latest - New Only", NEW_ONLY_DEFAULT));
    screen.addPreference(this.editTextPreference(screen, SORT_BY_NS_KEY, "Latest - Sort by Namespace", SORT_BY_NS_DEFAULT, "Sort by the given namespace for Latest, such as date_added or lastread."));
    screen.addPreference(latestSortOrder);
    screen.addPreference(randomPageSize);
    screen.addPreference(
      this.checkBoxPreference(
        screen,
        REDUPE_KEY,
        "Random Sort - Ignore dedupe",
        REDUPE_DEFAULT,
        "If enabled, ignores app's enforced deduping at the cost of spamming its database. If disabled, Random will eventually run out and the app will infinitely spam the server.",
      ),
    );
    screen.addPreference(
      this.editTextPreference(
        screen,
        URL_TAG_PREFIX_KEY,
        "Set tag prefix to get WebView URL",
        URL_TAG_PREFIX_DEFAULT,
        "Example: 'source:' will try to get the URL from the first tag starting with 'source:' and it will open it in the WebView. Leave empty for the default behavior.",
      ),
    );
  }

  private checkBoxPreference(screen: PreferenceScreen, key: string, title: string, def: boolean, summary = ""): CheckBoxPreference {
    const p = new CheckBoxPreference(screen.context);
    p.key = key;
    p.title = title;
    p.summary = summary;
    p.setDefaultValue(def);
    return p;
  }

  private editTextPreference(screen: PreferenceScreen, key: string, title: string, def: string, summary: string): EditTextPreference {
    const p = new EditTextPreference(screen.context);
    p.key = key;
    p.title = title;
    p.summary = summary;
    p.setDefaultValue(def);
    return p;
  }

  // Helper
  private apiTypeByID(id: string): string {
    return this.getApiUriBuilder(id.startsWith("TANK_") ? `/api/tankoubons/${id}/full` : `/api/archives/${id}/metadata`).build();
  }

  private async getRandomID(query: string): Promise<string> {
    const searchRandom = await this.client.execute(GET(`${this.baseUrl}/api/search/random?count=1&${query}`, this.headers));
    const result = searchRandom.parseAs<ArchiveSearchResult>(); // Intermittent empty data[] on parse, but not from manual API testing
    return result.data[0]?.arcid ?? this.randomArchiveID;
  }

  private getCategoryPairs(categories: Category[]): [string, string][] {
    // Empty pair to disable. Sort by pinned status then name for convenience.
    const pin = "📌 ";

    const sorted = [...categories].sort((a, b) => {
      // compareByDescending { it.pinned } (null is the smallest), thenBy { it.name } (null first)
      const pa = a.pinned ?? Number.NEGATIVE_INFINITY;
      const pb = b.pinned ?? Number.NEGATIVE_INFINITY;
      if (pa !== pb) return pb > pa ? 1 : -1;
      const na = a.name;
      const nb = b.name;
      if (na === nb) return 0;
      if (na == null) return -1;
      if (nb == null) return 1;
      return na < nb ? -1 : 1;
    });
    return [
      ["", categories.length > 0 ? "" : "Reset to populate"],
      ...sorted.map((it): [string, string] => [it.id, `${it.pinned === 1 ? pin : ""}${it.name}`]),
    ];
  }

  private startingPageStats(): string {
    return this.maxResultCount > 0 && this.totalRecords > 0 ? ` (${this.maxResultCount} / ${this.lastRecordsFiltered} items)` : "";
  }

  private getApiUriBuilder(path: string): UriBuilder {
    return new UriBuilder(`${this.baseUrl}${path}`);
  }

  private getThumbnailUri(id: string): string {
    const type = id.startsWith("TANK_") ? "tankoubons" : "archives";
    return this.getApiUriBuilder(`/api/${type}/${id}/thumbnail`).build();
  }

  // Response.url is the final URL after redirects; upstream walks priorResponse to the request that was sent
  private getStart(response: Response): number {
    const start = toHttpUrl(response.url).queryParameter("start");
    return start == null ? 0 : (toIntOrNull(start) ?? 0);
  }

  private getIDFromURL(url: string): string {
    return REGEX_ID_FROM_URL.exec(url)?.[1] ?? "";
  }

  private getNSTag(tags: string | null, tag: string): string[] | null {
    const list = tags
      ?.split(",")
      .filter((it) => it.startsWith(`${tag}:`))
      .map((it) => it.slice(it.indexOf(":") + 1));
    if (!list) return null;
    const distinct = [...new Set(list)];
    return distinct.length > 0 ? distinct : null;
  }

  private isTank(response: Response): boolean {
    return response.url.includes("/TANK_");
  }
}
