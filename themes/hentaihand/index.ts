// Port of keiyoushi/extensions-source lib-multisrc/hentaihand/HentaiHand.kt (+ Dto.kt)
import {
  DateTimeFormatter,
  EditTextPreference,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseAs,
  toHttpUrl,
  type Chain,
  type ClientBuilder,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";

// Dto.kt

interface ResponseDto<T> {
  data: T;
  next_page_url?: string | null;
}
interface LoginResponseDto {
  auth: { access_token: string };
}
interface PageListResponseDto {
  images: { page: number; source_url: string }[];
}
interface ChapterDto {
  slug: string;
  name?: string | null;
  added_at?: string | null;
  updated_at?: string | null;
}
interface NameDto {
  name: string;
}
interface MangaDto {
  slug: string;
  title: string;
  image_url?: string | null;
  artists?: NameDto[] | null;
  authors?: NameDto[] | null;
  tags?: NameDto[] | null;
  relationships?: NameDto[] | null;
  status?: string | null;
  alternative_title?: string | null;
  groups?: NameDto[] | null;
  description?: string | null;
  pages?: number | null;
  category?: NameDto | null;
  language?: NameDto | null;
  parodies?: NameDto[] | null;
  characters?: NameDto[] | null;
}
interface IdDto {
  id: number;
}

const toPageList = (dto: PageListResponseDto) => dto.images.map((it) => new Page(it.page, "", it.source_url));

const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US);

function parseDate(date: string | null | undefined): number {
  if (date == null) return 0;
  if (date.includes("day")) {
    const d = new Date();
    d.setDate(d.getDate() - Number(date.replace(/\D/g, "")));
    return d.getTime();
  }
  return DATE_FORMAT.tryParseDate(date);
}

function chapterToSChapter(dto: ChapterDto, slug: string) {
  const chapter = SChapter.create();
  chapter.url = `${slug}/${dto.slug}`;
  chapter.name = dto.name ?? "Chapter";
  chapter.date_upload = parseDate(dto.added_at);
  return chapter;
}

function comicToSChapter(dto: ChapterDto) {
  const chapter = SChapter.create();
  chapter.url = dto.slug;
  chapter.name = "Chapter";
  chapter.date_upload = parseDate(dto.updated_at);
  chapter.chapter_number = 1;
  return chapter;
}

const toNames = (list: NameDto[]) => (list.length === 0 ? undefined : list.map((it) => it.name).join(", "));

function toSManga(dto: MangaDto) {
  const manga = SManga.create();
  manga.url = `/en/comic/${dto.slug}`;
  manga.title = dto.title;
  manga.thumbnail_url = dto.image_url ?? undefined;
  return manga;
}

function toSMangaDetails(dto: MangaDto) {
  const manga = toSManga(dto);
  manga.artist = dto.artists ? toNames(dto.artists) : undefined;
  manga.author = (dto.authors ? toNames(dto.authors) : undefined) ?? manga.artist;
  manga.genre = toNames([...(dto.tags ?? []), ...(dto.relationships ?? [])]);
  switch (dto.status) {
    case "ongoing":
    case "onhold":
      manga.status = SManga.ONGOING;
      break;
    default: // "complete", "canceled", else
      manga.status = SManga.COMPLETED;
  }
  const pairs: [string, string | null | undefined][] = [
    ["Alternative Title", dto.alternative_title],
    ["Groups", dto.groups ? toNames(dto.groups) : undefined],
    ["Description", dto.description],
    ["Pages", dto.pages?.toString()],
    ["Category", dto.category?.name],
    ["Language", dto.language?.name],
    ["Parodies", dto.parodies ? toNames(dto.parodies) : undefined],
    ["Characters", dto.characters ? toNames(dto.characters) : undefined],
  ];
  manga.description = pairs
    .filter((it) => it[1])
    .map((it) => `${it[0]}: ${it[1]}`)
    .join("\n\n");
  return manga;
}

// Filters

class SortFilter extends Filter.Select<string> {}
class OrderFilter extends Filter.Select<string> {}
class DurationFilter extends Filter.Select<string> {}
class AttributeFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}
class AttributesGroupFilter extends Filter.Group<AttributeFilter> {}
class StatusFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}
class StatusGroupFilter extends Filter.Group<StatusFilter> {}
export class LookupFilter extends Filter.Text {
  constructor(
    name: string,
    readonly uri: string,
    readonly singularName: string,
  ) {
    super(name);
  }
}

const getSortPairs = (): [string, string][] => [
  ["Upload Date", "uploaded_at"],
  ["Title", "title"],
  ["Pages", "pages"],
  ["Favorites", "favorites"],
  ["Popularity", "popularity"],
];
const getOrderPairs = (): [string, string][] => [
  ["Descending", "desc"],
  ["Ascending", "asc"],
];
const getDurationPairs = (): [string, string][] => [
  ["Today", "day"],
  ["This Week", "week"],
  ["This Month", "month"],
  ["This Year", "year"],
  ["All Time", "all"],
];
const getAttributePairs = (): [string, string][] => [
  ["Translated", "translated"],
  ["Speechless", "speechless"],
  ["Rewritten", "rewritten"],
];
const getStatusPairs = (): [string, string][] => [
  ["Ongoing", "ongoing"],
  ["Complete", "complete"],
  ["On Hold", "onhold"],
  ["Canceled", "canceled"],
];

const USERNAME_TITLE = "Username";
const USERNAME_DEFAULT = "";
const PASSWORD_TITLE = "Password";
const PASSWORD_DEFAULT = "";

export abstract class HentaiHand extends KeiSource {
  abstract readonly chapters: boolean;

  protected get hhLangId(): number[] {
    return [];
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor((chain) => this.authIntercept(chain));
  }

  // Popular

  private async parseMangasPage(response: Response): Promise<MangasPage> {
    const resp = response.parseAs<ResponseDto<MangaDto[]>>();
    const hasNextPage = !!resp.next_page_url;
    return new MangasPage(
      resp.data.map((it) => toSManga(it)),
      hasNextPage,
    );
  }

  private listUrl(page: number, sort: string) {
    const url = toHttpUrl(`${this.baseUrl}/api/comics`)
      .newBuilder()
      .addQueryParameter("page", String(page))
      .addQueryParameter("sort", sort)
      .addQueryParameter("order", "desc")
      .addQueryParameter("duration", "all");
    this.hhLangId.forEach((it, index) => url.addQueryParameter(`languages[${-index - 1}]`, String(it)));
    return url.build().toString();
  }

  override async getPopularManga(page: number) {
    return this.parseMangasPage(await this.client.get(this.listUrl(page, "popularity")));
  }

  // Latest

  override async getLatestUpdates(page: number) {
    return this.parseMangasPage(await this.client.get(this.listUrl(page, "uploaded_at")));
  }

  // Search

  // filter query needs to be resolved to an ID
  // Returns the first matched id, or null if there are no results
  private readonly filterIdCache = new Map<string, number>(); // ponytail: unbounded, LruCache(100) upstream

  private async lookupFilterId(query: string, uri: string): Promise<number | null> {
    const key = `${uri}:${query}`;
    const cached = this.filterIdCache.get(key);
    if (cached != null) return cached;
    const id = (await this.client.get(`${this.baseUrl}/api/${uri}?q=${query}`)).parseAs<ResponseDto<IdDto[]>>().data[0]?.id ?? null;
    if (id != null) this.filterIdCache.set(key, id);
    return id;
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/comics`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("q", query);

    this.hhLangId.forEach((it, index) => url.addQueryParameter(`languages[${-index - 1}]`, String(it)));

    for (const filter of filters) {
      if (filter instanceof SortFilter) url.addQueryParameter("sort", getSortPairs()[filter.state][1]);
      else if (filter instanceof OrderFilter) url.addQueryParameter("order", getOrderPairs()[filter.state][1]);
      else if (filter instanceof DurationFilter) url.addQueryParameter("duration", getDurationPairs()[filter.state][1]);
      else if (filter instanceof AttributesGroupFilter) filter.state.forEach((it) => it.state && url.addQueryParameter("attributes", it.value));
      else if (filter instanceof StatusGroupFilter) filter.state.forEach((it) => it.state && url.addQueryParameter("statuses", it.value));
      else if (filter instanceof LookupFilter) {
        const terms = filter.state
          .split(",")
          .map((it) => it.trim())
          .filter((it) => it);
        const ids: number[] = [];
        for (const it of terms) {
          const id = await this.lookupFilterId(it, filter.uri);
          if (id == null) throw new Error(`No ${filter.singularName} "${it}" was found`);
          ids.push(id);
        }
        ids.forEach((it, index) => {
          if (!(filter.uri === "languages" && this.hhLangId.includes(it))) url.addQueryParameter(filter.uri + `[${index}]`, String(it));
        });
      }
    }

    return this.parseMangasPage(await this.client.get(url.build().toString()));
  }

  // Details

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = manga.url.startsWith("/en/comic/") ? manga.url.slice("/en/comic/".length) : manga.url;
    if (!this.chapters) {
      // details and the single chapter come from the same endpoint
      const comic = (await this.client.get(`${this.baseUrl}/api/comics/${slug}`)).text();
      return new SMangaUpdate(toSMangaDetails(parseAs<MangaDto>(comic)), [comicToSChapter(parseAs<ChapterDto>(comic))]);
    }

    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(`${this.baseUrl}/api/comics/${slug}`).then((r) => toSMangaDetails(r.parseAs<MangaDto>())) : manga,
      fetchChapters ? this.client.get(`${this.baseUrl}/api/comics/${slug}/chapters`).then((r) => r.parseAs<ChapterDto[]>().map((it) => chapterToSChapter(it, slug))) : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  // Pages

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return toPageList((await this.client.get(`${this.baseUrl}/api/comics/${chapter.url}/images`)).parseAs<PageListResponseDto>());
  }

  // Authorization

  private async authIntercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    if (
      !this.username ||
      !this.password ||
      // image request doesn't need token
      !request.url.startsWith(this.baseUrl)
    ) {
      return chain.proceed(request);
    }

    if (!this.token) this.token = await this.login(chain, this.username, this.password);
    const headers = new Headers(request.headers);
    headers.append("Authorization", `Bearer ${this.token}`);
    return chain.proceed({ ...request, headers });
  }

  private async login(chain: Chain, username: string, password: string): Promise<string> {
    const headers = this.headers;
    headers.set("Content-Type", "application/json; charset=utf-8");
    const body = JSON.stringify({ username, password, remember_me: true });
    const response = await chain.proceed({ url: `${this.baseUrl}/api/login`, method: "POST", headers, body });
    if (response.code === 401) throw new Error("Failed to login, check if username and password are correct");
    try {
      // Returns access token as a string, unless unparseable
      return response.parseAs<LoginResponseDto>().auth.access_token;
    } catch {
      throw new Error("Cannot parse login response body");
    }
  }

  private token = "";
  private get username() {
    return this.preferences.getString(USERNAME_TITLE, USERNAME_DEFAULT)!;
  }
  private get password() {
    return this.preferences.getString(PASSWORD_TITLE, PASSWORD_DEFAULT)!;
  }

  // Preferences

  override setupPreferenceScreen(screen: PreferenceScreen) {
    screen.addPreference(this.editTextPreference(USERNAME_TITLE, USERNAME_DEFAULT, this.username));
    screen.addPreference(this.editTextPreference(PASSWORD_TITLE, PASSWORD_DEFAULT, this.password));
  }

  // isPassword (input type) has no equivalent in the preference definitions
  private editTextPreference(title: string, def: string, value: string) {
    const p = new EditTextPreference();
    p.key = title;
    p.title = title;
    p.summary = value;
    p.setDefaultValue(def);
    p.dialogTitle = title;
    return p;
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new SortFilter(
        "Sort By",
        getSortPairs().map((it) => it[0]),
      ),
      new OrderFilter(
        "Order By",
        getOrderPairs().map((it) => it[0]),
      ),
      new DurationFilter(
        "Duration",
        getDurationPairs().map((it) => it[0]),
      ),
      new Filter.Header("Separate terms with commas (,)"),
      new LookupFilter("Categories", "categories", "category"),
      new LookupFilter("Tags", "tags", "tag"),
      new LookupFilter("Artists", "artists", "artist"),
      new LookupFilter("Groups", "groups", "group"),
      new LookupFilter("Characters", "characters", "character"),
      new LookupFilter("Parodies", "parodies", "parody"),
      new LookupFilter("Other Languages", "languages", "language"),
      new AttributesGroupFilter(
        "Attributes",
        getAttributePairs().map((it) => new AttributeFilter(it[0], it[1])),
      ),
      new StatusGroupFilter(
        "Status",
        getStatusPairs().map((it) => new StatusFilter(it[0], it[1])),
      ),
    );
  }
}
