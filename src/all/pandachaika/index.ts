// Port of keiyoushi/extensions-source src/all/pandachaika/PandaChaika.kt
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
  dataRange,
  readEntry,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  toJsonString,
  zipDirectory,
  type Chain,
  type ClientBuilder,
  type HttpUrl,
} from "../../../sdk/index.ts";

// Dto.kt

/** dateReformat: DateTimeFormatter.ofPattern("EEEE, d MMM yyyy HH:mm (z)", Locale.ENGLISH) in the system zone. */
function dateReformat(epochSecond: number): string {
  const parts = Object.fromEntries(
    new globalThis.Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
      .formatToParts(new Date(epochSecond * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute} (${parts.timeZoneName})`;
}

function filterTags(include = "", exclude: string[] = [], tags: string[]): string | null {
  const joined = tags
    .filter((it) => it.startsWith(`${include}:`) && !exclude.some((substring) => it.startsWith(`${substring}:`)))
    .map((it) =>
      it
        .slice(it.indexOf(":") + 1)
        .replace(/_/g, " ")
        .split(" ")
        .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
        .join(" "),
    )
    .join(", ");
  return joined.trim() ? joined : null;
}

function getReadableSize(bytes: number): string {
  if (bytes >= 300 * 1000 * 1000) return `${(bytes / (1000.0 * 1000.0 * 1000.0)).toFixed(2)} GB`;
  if (bytes >= 100 * 1000) return `${(bytes / (1000.0 * 1000.0)).toFixed(2)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000.0).toFixed(2)} kB`;
  return `${Number.isInteger(bytes) ? bytes.toFixed(1) : bytes} B`;
}

interface Archive {
  download: string;
  posted: number;
  title: string;
}

interface LongArchive {
  thumbnail: string;
  title: string;
  id: number;
  posted: number | null;
  public_date: number | null;
  filecount: number;
  filesize: number;
  tags: string[];
  title_jpn: string | null;
  uploader: string;
}

function toSManga(a: LongArchive): SManga {
  const tags = a.tags;
  const groups = filterTags("group", undefined, tags);
  const artists = filterTags("artist", undefined, tags);
  const publishers = filterTags("publisher", undefined, tags);
  const characters = filterTags("character", undefined, tags);
  const male = filterTags("male", undefined, tags);
  const female = filterTags("female", undefined, tags);
  const others = filterTags(undefined, ["female", "male", "artist", "publisher", "group", "parody"], tags);
  const parodies = filterTags("parody", undefined, tags);
  let appended = false;

  const manga = SManga.create();
  manga.url = String(a.id);
  manga.title = a.title;
  manga.thumbnail_url = a.thumbnail;
  manga.author = groups ?? artists ?? undefined;
  manga.artist = artists ?? undefined;
  manga.genre = [male, female, others].filter((it) => it != null).join(", ");
  let d = "";
  d += `Uploader: ${a.uploader || "Anonymous"}\n`;
  if (publishers != null) d += `Publishers: ${publishers}\n`;
  d += "\n";
  if (parodies != null) {
    d += `Parodies: ${parodies}\n`;
    appended = true;
  }
  if (characters != null) {
    d += `Characters: ${characters}\n`;
    appended = true;
  }
  if (appended) d += "\n";
  if (male != null) d += `Male tags: ${male}\n\n`;
  if (female != null) d += `Female tags: ${female}\n\n`;
  if (others != null) d += `Other tags: ${others}\n\n`;
  if (a.title_jpn) d += `Japanese Title: ${a.title_jpn}\n`;
  d += `Pages: ${a.filecount}\n`;
  d += `File Size: ${getReadableSize(a.filesize)}\n`;
  if (a.public_date != null) d += `Public Date: ${dateReformat(a.public_date)}\n`;
  if (a.posted != null) d += `Posted: ${dateReformat(a.posted)}\n`;
  manga.description = d;
  manga.status = SManga.COMPLETED;
  // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: no equivalent in the host
  manga.initialized = true;
  return manga;
}

interface ArchiveResponse {
  archives: LongArchive[];
  has_next: boolean;
}

interface ImageRequest {
  url: string;
  name: string;
  offset: number;
  compressedSize: number;
  method: number;
}

// Filters.kt

function getFilters(): FilterList {
  return FilterList(
    new SortFilter("Sort by", { index: 0, ascending: false }, getSortsList),
    new SelectFilter("Types", getTypes),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new Filter.Header("Use 'Male Tags' or 'Female Tags' for specific categories. 'Tags' searches all categories."),
    new TextFilter("Tags", ""),
    new TextFilter("Male Tags", "male"),
    new TextFilter("Female Tags", "female"),
    new TextFilter("Artists", "artist"),
    new TextFilter("Parodies", "parody"),
    new TextFilter("Characters", "character"),
    new Filter.Separator(),
    new TextFilter("Reason", "reason"),
    new TextFilter("Uploader", "uploader"),
    new Filter.Separator(),
    new Filter.Header("Filter by pages, for example: (>20)"),
    new PageFilter("Pages"),
  );
}

class PageFilter extends Filter.Text {}

class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly type: string,
  ) {
    super(name);
  }
}

class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: string[],
    state = 0,
  ) {
    super(name, vals, state);
  }
}

class SortFilter extends Filter.Sort {
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

const getTypes = ["All", "Doujinshi", "Manga", "Image Set", "Artist CG", "Game CG", "Western", "Non-H", "Misc"];

const getSortsList: [string, string][] = [
  ["Public Date", "public_date"],
  ["Posted Date", "posted"],
  ["Title", "title"],
  ["Japanese Title", "title_jpn"],
  ["Rating", "rating"],
  ["Images", "filecount"],
  ["File Size", "filesize"],
  ["Category", "category"],
];

// PandaChaika.kt

const PREFIX_ID_SEARCH = "id:";
const PREFIX_FAK_ID_SEARCH = "fakku:";
const PREFIX_EHEN_ID_SEARCH = "ehentai:";
const PREFIX_SOURCE_SEARCH = "source:";

const LANGS: Record<string, string> = {
  en: "english",
  zh: "chinese",
  ko: "korean",
  es: "spanish",
  ru: "russian",
  pt: "portuguese",
  fr: "french",
  th: "thai",
  vi: "vietnamese",
  ja: "japanese",
  id: "indonesian",
  ar: "arabic",
  uk: "ukrainian",
  tr: "turkish",
  cs: "czech",
  tl: "tagalog",
  fi: "finnish",
  jv: "javanese",
  el: "greek",
};

export default class PandaChaika extends KeiSource {
  private get searchLang(): string {
    return LANGS[this.lang] ?? "";
  }

  private get baseSearchUrl() {
    return `${this.baseUrl}/search`;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.intercept(chain));
  }

  private readonly fakkuRegex = /(?:https?:\/\/)?(?:www\.)?fakku\.net\/hentai\//g;
  private readonly ehentaiRegex = /(?:https?:\/\/)?e-hentai\.org\/g\//g;

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseSearch(await this.client.get(`${this.baseSearchUrl}/?tags=${this.searchLang}&sort=rating&apply=&json=&page=${page}`));
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseSearch(await this.client.get(`${this.baseSearchUrl}/?tags=${this.searchLang}&sort=public_date&apply=&json=&page=${page}`));
  }

  private parsePageRange(query: string, minPages = 1, maxPages = 9999): [number, number] {
    const digits = query.replace(/\D/g, "");
    const num = digits ? Number.parseInt(digits, 10) : -1;
    const limitedNum = (number = num) => Math.min(Math.max(number, minPages), maxPages);

    if (num < 0) return [minPages, maxPages];
    switch (query[0]) {
      case "<":
        return [1, query[1] === "=" ? limitedNum() : limitedNum(num + 1)];
      case ">":
        return [limitedNum(query[1] === "=" ? num : num + 1), maxPages];
      case "=":
        switch (query[1]) {
          case ">":
            return [limitedNum(), maxPages];
          case "<":
            return [1, limitedNum(maxPages)];
          default:
            return [limitedNum(), limitedNum()];
        }
      default:
        return [limitedNum(), limitedNum()];
    }
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.hostname !== toHttpUrl(this.baseUrl).host || segments[0] !== "archive") return null;
    const id = /^-?\d+$/.test(segments[1] ?? "") ? Number(segments[1]) : null;
    if (id == null) return null;
    return (await this.searchMangaById(id)).mangas[0] ?? null;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const id = Number(query.slice(PREFIX_ID_SEARCH.length));
      if (!Number.isInteger(id)) throw new Error(`For input string: "${query.slice(PREFIX_ID_SEARCH.length)}"`);
      return this.searchMangaById(id);
    }
    if (query.startsWith(PREFIX_EHEN_ID_SEARCH)) {
      const id = query.slice(PREFIX_EHEN_ID_SEARCH.length).replace(this.ehentaiRegex, "");
      const baseLink = "https://e-hentai.org/g/";
      const fullLink = toHttpUrl(this.baseSearchUrl).newBuilder().addQueryParameter("qsearch", baseLink + id).addQueryParameter("json", "").build();
      return this.searchFirstArchive(fullLink.toString());
    }
    if (query.startsWith(PREFIX_FAK_ID_SEARCH)) {
      const slug = query.slice(PREFIX_FAK_ID_SEARCH.length).replace(this.fakkuRegex, "");
      const baseLink = "https://www.fakku.net/hentai/";
      const fullLink = toHttpUrl(this.baseSearchUrl).newBuilder().addQueryParameter("qsearch", baseLink + slug).addQueryParameter("json", "").build();
      return this.searchFirstArchive(fullLink.toString());
    }
    if (query.startsWith(PREFIX_SOURCE_SEARCH)) {
      const url = query.slice(PREFIX_SOURCE_SEARCH.length);
      return this.searchFirstArchive(`${this.baseSearchUrl}/?qsearch=${url}&json=`);
    }
    return this.parseSearch(await this.client.get(this.searchMangaUrl(page, query, filters).toString()));
  }

  private async searchFirstArchive(url: string): Promise<MangasPage> {
    const first = (await this.client.get(url)).parseAs<ArchiveResponse>().archives[0];
    if (!first) throw new Error("Not Found");
    return new MangasPage([toSManga(first)], false);
  }

  private async searchMangaById(id: number): Promise<MangasPage> {
    const title = (await this.client.get(`${this.baseUrl}/api?archive=${id}`)).parseAs<Archive>().title;
    const fullLink = toHttpUrl(this.baseSearchUrl).newBuilder().addQueryParameter("qsearch", title).addQueryParameter("json", "").build();
    const found = (await this.client.get(fullLink.toString())).parseAs<ArchiveResponse>().archives.find((it) => it.id === id);
    if (!found) throw new Error("Invalid ID");
    return new MangasPage([toSManga(found)], false);
  }

  private parseSearch(response: Response): MangasPage {
    const library = response.parseAs<ArchiveResponse>();
    const mangas = library.archives.map(toSManga);
    const hasNextPage = library.has_next;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaUrl(page: number, query: string, filters: FilterList): HttpUrl {
    const b = toHttpUrl(this.baseSearchUrl).newBuilder();
    const tags: string[] = [];
    let reason = "";
    let uploader = "";
    let pagesMin = 1;
    let pagesMax = 9999;

    tags.push(this.searchLang);

    for (const it of filters) {
      if (it instanceof SortFilter) {
        b.addQueryParameter("sort", it.getValue());
        b.addQueryParameter("asc_desc", it.state!.ascending ? "asc" : "desc");
      } else if (it instanceof SelectFilter) {
        b.addQueryParameter("category", it.vals[it.state].replace("All", ""));
      } else if (it instanceof PageFilter) {
        if (it.state.trim()) {
          [pagesMin, pagesMax] = this.parsePageRange(it.state);
        }
      } else if (it instanceof TextFilter) {
        if (it.state) {
          switch (it.type) {
            case "reason":
              reason = it.state;
              break;
            case "uploader":
              uploader = it.state;
              break;
            default:
              for (const tag of it.state.split(",").filter((s) => s.trim())) {
                const trimmed = tag.trim();
                let s = "";
                if (trimmed.startsWith("-")) s += "-";
                s += it.type;
                if (it.type.trim()) s += ":";
                const lower = trimmed.toLowerCase();
                s += lower.startsWith("-") ? lower.slice(1) : lower;
                tags.push(s);
              }
          }
        }
      }
    }

    b.addQueryParameter("title", query);
    b.addQueryParameter("tags", tags.join(", "));
    b.addQueryParameter("filecount_from", String(pagesMin));
    b.addQueryParameter("filecount_to", String(pagesMax));
    b.addQueryParameter("reason", reason);
    b.addQueryParameter("uploader", uploader);
    b.addQueryParameter("page", String(page));
    b.addQueryParameter("apply", "");
    b.addQueryParameter("json", "");
    return b.build();
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const archive = (await this.client.get(`${this.baseUrl}/api?archive=${manga.url}`)).parseAs<Archive>();

    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = substringBefore(archive.download, "/download/");
    chapter.date_upload = archive.posted * 1000;

    return new SMangaUpdate(manga, [chapter]);
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/archive/${manga.url}`;
  }
  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}${chapter.url}`;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = `${this.baseUrl}${chapter.url}/download/`;
    const dir = await zipDirectory(this.client, url, this.headers);
    const ci = (a: string, b: string) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    };
    return [...dir.entries]
      .sort((a, b) => ci(a.name, b.name))
      .map((entry, index) => {
        const data = toJsonString({ url, name: entry.name, offset: entry.localHeaderOffset, compressedSize: entry.compressedSize, method: entry.method } satisfies ImageRequest);
        // OkHttp percent-encodes the fragment and HttpUrl.fragment decodes it; encoding here keeps the JSON intact
        return new Page(index, "", `https://127.0.0.1/#${encodeURIComponent(data)}`);
      });
  }

  private async intercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    if (!request.url.startsWith("https://127.0.0.1/#")) return chain.proceed(request);

    const fragment = toHttpUrl(request.url).fragment;
    if (!fragment) return chain.proceed(request);
    const data = JSON.parse(decodeURIComponent(fragment)) as ImageRequest;
    const [first, last] = dataRange(data.offset, data.compressedSize);
    const headers = new Headers(request.headers);
    headers.set("Range", `bytes=${first}-${last}`);

    const response = await chain.proceed({ ...request, url: data.url, headers });
    if (!response.isSuccessful) return response;
    const image = await readEntry(response.bytes(), data.compressedSize, data.method);
    let type = substringAfterLast(data.name, ".").toLowerCase();
    type = type === "jpg" ? "jpeg" : type;

    return new Response(this.host, { status: 200, url: response.url, headers: { "content-type": `image/${type}` }, body: image });
  }
}
