// Port of keiyoushi/extensions-source src/all/komga/Komga.kt (and KomgaUtils.kt)
//
// The host has no preference change listeners, validation or toasts: the "log in" that upstream runs when the
// address/credentials change (fetching /api/v1/libraries into PREF_LIBRARY_LIST) happens in fetchFilterData instead,
// and the address / chapter template are not validated while typing. Dns.SYSTEM is the host's concern.
import {
  Base64,
  DateTimeFormatter,
  EditTextPreference,
  Filter,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SMangaUpdate,
  toHttpUrl,
  type ClientBuilder,
  type FilterList,
  type Host,
  type Meta,
  type PreferenceScreen,
  type Response,
  type SManga,
} from "../../../sdk/index.ts";
import {
  bookToSManga,
  getChapterName,
  readListToSManga,
  seriesToSManga,
  type AuthorDto,
  type BookDto,
  type CollectionDto,
  type LibraryDto,
  type PageDto,
  type PageWrapperDto,
  type ReadListDto,
  type SeriesDto,
} from "./dto.ts";
import {
  AuthorFilter,
  AuthorGroup,
  CollectionSelect,
  InProgressFilter,
  LibraryFilter,
  ReadFilter,
  SeriesSort,
  TypeSelect,
  UnreadFilter,
  UriMultiSelectFilter,
  UriMultiSelectOption,
  isUriFilter,
  type CollectionFilterEntry,
} from "./filters.ts";

// --- KomgaUtils.kt
const formatterDate = DateTimeFormatter.ofPattern("yyyy-MM-dd");
const formatterDateTime = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
const parseDate = (date: string) => formatterDate.tryParseDate(date);
const parseDateTime = (date: string) => formatterDateTime.tryParseDateTime(date);

/** PreferenceScreen.addEditTextPreference, minus the Android change/validation listeners. */
function addEditTextPreference(screen: PreferenceScreen, o: { title: string; default: string; summary: string; key?: string }) {
  const p = new EditTextPreference(screen.context);
  p.key = o.key ?? o.title;
  p.title = o.title;
  p.summary = o.summary;
  p.setDefaultValue(o.default);
  p.dialogTitle = o.title;
  screen.addPreference(p);
}

/** okhttp3.Credentials.basic (ISO-8859-1) */
const basicCredentials = (username: string, password: string) => `Basic ${Base64.encode(Uint8Array.from(`${username}:${password}`, (c) => c.charCodeAt(0) & 0xff))}`;

interface FilterData {
  libraries: LibraryDto[];
  collections: CollectionDto[];
  genres: string[];
  tags: string[];
  publishers: string[];
  authors: Record<string, AuthorDto[]>; // roles to list of authors
}

// Order must match the sources in meta.json (used to label factory instances); tools/build.ts suffixes repeated langs.
const INSTANCE_IDS = ["kei:all.komga:all", "kei:all.komga:all:2", "kei:all.komga:all:3"];

const PREF_DISPLAY_NAME = "Source display name";
const PREF_ADDRESS = "Address";
const PREF_USERNAME = "Username";
const PREF_PASSWORD = "Password";
const PREF_API_KEY = "API key";
const PREF_LIBRARY_LIST = "library_list";
const PREF_DEFAULT_LIBRARIES = "Default libraries";
const PREF_CHAPTER_NAME_TEMPLATE = "Chapter name template";
const PREF_CHAPTER_NAME_TEMPLATE_DEFAULT = "{number} - {title} ({size})";

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/jxl", "image/heif", "image/avif"];

const isFromReadList = (s: string) => s.includes("/api/v1/readlists");
const isFromBook = (s: string) => s.includes("/api/v1/books");

export default class Komga extends KeiSource {
  constructor(host: Host, meta: Meta) {
    super(host, meta);
    // `override val name by lazy`: KeiSource's name is a readonly field set from meta
    const displayNameSuffix = this.displayName.trim() ? this.displayName : this.instanceSuffix;
    Object.assign(this, { name: `Komga${displayNameSuffix.trim() ? ` (${displayNameSuffix})` : ""}` });
  }

  private get displayName() {
    return this.preferences.getString(PREF_DISPLAY_NAME, "")!;
  }

  // Distinguish the fixed factory instances by position (Komga, Komga (2), Komga (3), ...)
  // when the user hasn't set a display name. Inferred from the source id.
  private get instanceSuffix(): string {
    const it = INSTANCE_IDS.indexOf(this.id);
    return it > 0 ? `${it + 1}` : "";
  }

  get supportsLatest() {
    return true;
  }

  get supportsFilterFetching() {
    return true;
  }

  get baseUrl(): string {
    const address = this.preferences.getString(PREF_ADDRESS, "")!;
    return address.endsWith("/") ? address.slice(0, -1) : address;
  }

  private get username() {
    return this.preferences.getString(PREF_USERNAME, "")!;
  }

  private get password() {
    return this.preferences.getString(PREF_PASSWORD, "")!;
  }

  private get apiKey() {
    return this.preferences.getString(PREF_API_KEY, "")!;
  }

  private get defaultLibraries() {
    return this.preferences.getStringSet(PREF_DEFAULT_LIBRARIES, []);
  }

  protected configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", `TachiyomiKomga/${this.meta.version}`);
    if (this.apiKey.trim()) headers.set("X-API-Key", this.apiKey);
    return headers;
  }

  protected configureClient(builder: ClientBuilder): ClientBuilder {
    // OkHttp's authenticator: answer a 401 once with basic credentials
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);
      if (response.code !== 401) return response;
      if (this.apiKey.trim() || request.headers.has("Authorization")) return response; // Give up if API key is set or we've already failed to authenticate.
      const headers = new Headers(request.headers);
      headers.append("Authorization", basicCredentials(this.username, this.password));
      return chain.proceed({ ...request, headers });
    });
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.searchMangaUrl(page, "", [new SeriesSort({ index: 1, ascending: true })]);
    return this.processSeriesPage(await this.client.get(url), this.baseUrl);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.searchMangaUrl(page, "", [new SeriesSort({ index: 3, ascending: false })]);
    return this.processSeriesPage(await this.client.get(url), this.baseUrl);
  }

  private searchMangaUrl(page: number, query: string, filters: FilterList): string {
    const collectionSelect = filters.find((it) => it instanceof CollectionSelect) as CollectionSelect | undefined;
    const collectionId = collectionSelect ? collectionSelect.collections[collectionSelect.state].id : null;
    const typeState = filters.find((it) => it instanceof TypeSelect)?.state;

    let type: string;
    if (collectionId != null) type = `collections/${collectionId}/series`;
    else if (typeState === 1) type = "readlists";
    else if (typeState === 2) type = "books";
    else type = "series";

    const url = toHttpUrl(`${this.baseUrl}/api/v1`)
      .newBuilder()
      .addPathSegments(type)
      .addQueryParameter("search", query)
      .addQueryParameter("page", String(page - 1))
      .addQueryParameter("deleted", "false");

    const filterList = filters.length ? filters : this.getFilterList();
    const defaultLibraries = this.defaultLibraries;

    if (!filterList.some((it) => it instanceof LibraryFilter) && defaultLibraries.length) {
      url.addQueryParameter("library_id", defaultLibraries.join(","));
    }

    for (const filter of filterList) {
      if (isUriFilter(filter)) filter.addToUri(url);
      else if (filter instanceof Filter.Sort) {
        const state = filter.state;
        if (!state) continue;
        let sortCriteria: string;
        switch (state.index) {
          case 0:
            sortCriteria = "relevance";
            break;
          case 1:
            sortCriteria = type === "series" ? "metadata.titleSort" : "name";
            break;
          case 2:
            sortCriteria = "createdDate";
            break;
          case 3:
            sortCriteria = "lastModifiedDate";
            break;
          case 4:
            sortCriteria = "random";
            break;
          default:
            continue;
        }
        url.addQueryParameter("sort", `${sortCriteria},${state.ascending ? "asc" : "desc"}`);
      }
    }

    return url.build().toString();
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = this.searchMangaUrl(page, query, filters);
    return this.processSeriesPage(await this.client.get(url), this.baseUrl);
  }

  private processSeriesPage(response: Response, baseUrl: string): MangasPage {
    let mangas: SManga[];
    let last: boolean;
    if (isFromReadList(response.url)) {
      const data = response.parseAs<PageWrapperDto<ReadListDto>>();
      mangas = data.content.map((it) => readListToSManga(it, baseUrl));
      last = data.last;
    } else if (isFromBook(response.url)) {
      const data = response.parseAs<PageWrapperDto<BookDto>>();
      mangas = data.content.map((it) => bookToSManga(it, baseUrl));
      last = data.last;
    } else {
      const data = response.parseAs<PageWrapperDto<SeriesDto>>();
      mangas = data.content.map((it) => seriesToSManga(it, baseUrl));
      last = data.last;
    }
    return new MangasPage(mangas, !last);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(m, c);
  }

  getMangaUrl(manga: SManga): string {
    return manga.url.replace("/api/v1", "");
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const response = await this.client.get(manga.url);
    if (isFromReadList(response.url)) return readListToSManga(response.parseAs<ReadListDto>(), this.baseUrl);
    if (isFromBook(response.url)) return bookToSManga(response.parseAs<BookDto>(), this.baseUrl);
    return seriesToSManga(response.parseAs<SeriesDto>(), this.baseUrl);
  }

  private get chapterNameTemplate() {
    return this.preferences.getString(PREF_CHAPTER_NAME_TEMPLATE, PREF_CHAPTER_NAME_TEMPLATE_DEFAULT)!;
  }

  getChapterUrl(chapter: SChapter): string {
    return chapter.url.replace("/api/v1/books", "/book");
  }

  private bookToChapter(book: BookDto, chapterNumber: number, fromReadList: boolean, template: string): SChapter {
    const chapter = SChapter.create();
    chapter.chapter_number = chapterNumber;
    chapter.url = `${this.baseUrl}/api/v1/books/${book.id}`;
    chapter.name = getChapterName(book, template, fromReadList);
    chapter.scanlator = book.metadata.authors
      .filter((it) => it.role === "translator")
      .map((it) => it.name)
      .join(", ");
    if (book.metadata.releaseDate != null) chapter.date_upload = parseDate(book.metadata.releaseDate);
    else if (book.created != null) chapter.date_upload = parseDateTime(book.created);
    // XXX: `Book.fileLastModified` actually uses the server's running timezone,
    // not UTC, even if the timestamp ends with a Z! We cannot determine the
    // server's timezone, which is why this is a last resort option.
    else chapter.date_upload = parseDateTime(book.fileLastModified);
    return chapter;
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const url = isFromBook(manga.url) ? `${manga.url}?unpaged=true&media_status=READY&deleted=false` : `${manga.url}/books?unpaged=true&media_status=READY&deleted=false`;
    const response = await this.client.get(url);

    if (isFromBook(response.url)) {
      const book = response.parseAs<BookDto>();
      return [this.bookToChapter(book, 1, true, this.chapterNameTemplate)];
    }
    const page = response.parseAs<PageWrapperDto<BookDto>>().content;
    const fromReadList = isFromReadList(response.url);
    const chapterNameTemplate = this.chapterNameTemplate;

    return page
      .filter((it) => (it.media.mediaProfile ?? "DIVINA") !== "EPUB" || (it.media.epubDivinaCompatible ?? false))
      .map((book, index) => this.bookToChapter(book, !fromReadList ? book.metadata.numberSort : index + 1, fromReadList, chapterNameTemplate))
      .sort((a, b) => b.chapter_number - a.chapter_number);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pages = (await this.client.get(`${chapter.url}/pages`)).parseAs<PageDto[]>();
    return pages.map((it) => {
      const url = `${chapter.url}/pages/${it.number}` + (!SUPPORTED_IMAGE_TYPES.includes(it.mediaType) ? "?convert=png" : "");
      return new Page(it.number, "", url);
    });
  }

  imageRequest(page: Page): { url: string; headers: Headers } {
    const headers = this.headersBuilder();
    headers.append("Accept", "image/*,*/*;q=0.8");
    return { url: page.imageUrl!, headers };
  }

  getFilterList(data: unknown = null): FilterList {
    const filterData = data as FilterData | null;

    const collections: CollectionFilterEntry[] = [{ name: "None" }, ...(filterData?.collections ?? []).map((it) => ({ name: it.name, id: it.id }))];
    const filters: Filter[] = [
      new UnreadFilter(),
      new InProgressFilter(),
      new ReadFilter(),
      new TypeSelect(),
      new CollectionSelect(collections),
      new LibraryFilter(filterData?.libraries ?? [], this.defaultLibraries),
      new UriMultiSelectFilter(
        "Status",
        "status",
        ["Ongoing", "Ended", "Abandoned", "Hiatus"].map((it) => new UriMultiSelectOption(it, it.toUpperCase())),
      ),
      new UriMultiSelectFilter(
        "Genres",
        "genre",
        (filterData?.genres ?? []).map((it) => new UriMultiSelectOption(it)),
      ),
      new UriMultiSelectFilter(
        "Tags",
        "tag",
        (filterData?.tags ?? []).map((it) => new UriMultiSelectOption(it)),
      ),
      new UriMultiSelectFilter(
        "Publishers",
        "publisher",
        (filterData?.publishers ?? []).map((it) => new UriMultiSelectOption(it)),
      ),
    ];
    for (const [role, authors] of Object.entries(filterData?.authors ?? {})) {
      filters.push(
        new AuthorGroup(
          role,
          authors.map((it) => new AuthorFilter(it)),
        ),
      );
    }
    filters.push(new SeriesSort());
    return filters;
  }

  private get libraries() {
    return this.preferences.getString(PREF_LIBRARY_LIST, "[]")!;
  }

  setupPreferenceScreen(screen: PreferenceScreen): void {
    const defaultLibrarySummary = (apiKey: string, username: string) => (apiKey.trim() || username.trim() ? "Show content from selected libraries by default." : "Currently not logged in");
    const libraries = JSON.parse(this.libraries) as LibraryDto[];
    const defaultLibraryPref = new MultiSelectListPreference(screen.context);
    defaultLibraryPref.key = PREF_DEFAULT_LIBRARIES;
    defaultLibraryPref.title = "Default libraries";
    defaultLibraryPref.summary = defaultLibrarySummary(this.apiKey, this.username);
    defaultLibraryPref.entries = libraries.map((it) => it.name);
    defaultLibraryPref.entryValues = libraries.map((it) => it.id);
    defaultLibraryPref.setDefaultValue([]);

    addEditTextPreference(screen, {
      title: "Source display name",
      default: "",
      summary: this.displayName.trim() ? this.displayName : "Here you can change the source display name",
      key: PREF_DISPLAY_NAME,
    });

    addEditTextPreference(screen, {
      title: "Address",
      default: "",
      summary: this.baseUrl.trim() ? this.baseUrl : "The server address",
      key: PREF_ADDRESS,
    });

    // API key preference (takes precedence over username/password)
    addEditTextPreference(screen, {
      title: "API key",
      default: "",
      summary: this.apiKey.trim() ? "*".repeat(this.apiKey.length) : "Optional: Use an API key for authentication",
      key: PREF_API_KEY,
    });
    // Only show username/password if API key is not set
    if (!this.apiKey.trim()) {
      addEditTextPreference(screen, {
        title: "Username",
        default: "",
        summary: this.username.trim() ? this.username : "The user account email",
        key: PREF_USERNAME,
      });
      addEditTextPreference(screen, {
        title: "Password",
        default: "",
        summary: this.password.trim() ? "*".repeat(this.password.length) : "The user account password",
        key: PREF_PASSWORD,
      });
    }

    screen.addPreference(defaultLibraryPref);

    addEditTextPreference(screen, {
      key: PREF_CHAPTER_NAME_TEMPLATE,
      title: "Chapter title format",
      summary:
        "Customize how chapter names appear. Chapters in read lists will always be prefixed by the series' name.\n" +
        "Supported placeholders: {title}, {seriesTitle}, {number}, {createdDate}, {releaseDate}, {size}, {sizeBytes}. " +
        'Write "${" for a literal "{".',
      default: PREF_CHAPTER_NAME_TEMPLATE_DEFAULT,
    });
  }

  async fetchFilterData(): Promise<unknown> {
    if (!this.baseUrl.trim()) throw new Error("Komga: set the server address in the source settings");

    const libraries = (await this.client.get(`${this.baseUrl}/api/v1/libraries`)).parseAs<LibraryDto[]>();
    // upstream's logIn(): the default-libraries preference lists these
    this.preferences.edit().putString(PREF_LIBRARY_LIST, JSON.stringify(libraries)).apply();
    const collections = (await this.client.get(`${this.baseUrl}/api/v1/collections?unpaged=true`)).parseAs<PageWrapperDto<CollectionDto>>().content;
    const genres = (await this.client.get(`${this.baseUrl}/api/v1/genres`)).parseAs<string[]>();
    const tags = (await this.client.get(`${this.baseUrl}/api/v1/tags`)).parseAs<string[]>();
    const publishers = (await this.client.get(`${this.baseUrl}/api/v1/publishers`)).parseAs<string[]>();
    const authors: Record<string, AuthorDto[]> = {};
    for (const it of (await this.client.get(`${this.baseUrl}/api/v1/authors`)).parseAs<AuthorDto[]>()) (authors[it.role] ??= []).push(it);

    return { libraries, collections, genres: [...new Set(genres)], tags: [...new Set(tags)], publishers: [...new Set(publishers)], authors } satisfies FilterData;
  }
}
