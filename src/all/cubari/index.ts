// Port of keiyoushi/extensions-source src/all/cubari/Cubari.kt
import {
  Base64,
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  substringAfter,
  substringBefore,
  toHttpUrl,
  utf8,
  type ClientBuilder,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

type JsonObject = Record<string, unknown>;

enum SortType {
  PINNED,
  UNPINNED,
  ALL,
}

const AUTHOR_FALLBACK = "Unknown";
const ARTIST_FALLBACK = "Unknown";
const DESCRIPTION_FALLBACK = "No description.";
const SEARCH_FALLBACK_MSG = "Please enter a valid Cubari URL";
// RemoteStorageUtils.HomeInterceptor reads the reader's pinned/unpinned series from cubari.moe's browser storage in a WebView
const HOME_UNAVAILABLE_MSG =
  "Cubari's library is read from the site's browser storage through a WebView, which is not available here. Search with a Cubari, imgur, reddit, imgchest, catbox or gist URL instead.";

/** JsonPrimitive.content */
const content = (v: unknown): string => String(v);
/** Float.toString for a number that came from a Kotlin Float: whole numbers print as "84.0". */
const floatToString = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
/** String.toFloatOrNull() */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(s) ? Number.parseFloat(s) : null);

export default class Cubari extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((request) => {
      const headers = new Headers(request.headers);
      headers.delete("Accept-Encoding");
      return { ...request, headers };
    });
  }

  // upstream: "(Android …) Tachiyomi/… Keiyoushi"; there is no Android here
  private get cubariHeaders(): Headers {
    const headers = super.headersBuilder();
    headers.set("User-Agent", `${this.host.userAgent} Keiyoushi`);
    return headers;
  }

  protected override latestUpdatesRequest(_page: number): Request {
    return GET(`${this.baseUrl}/`, this.cubariHeaders);
  }

  override async fetchLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error(HOME_UNAVAILABLE_MSG);
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    const result = response.parseAs<JsonObject[]>();
    return this.parseMangaList(result, SortType.UNPINNED);
  }

  protected override popularMangaRequest(_page: number): Request {
    return GET(`${this.baseUrl}/`, this.cubariHeaders);
  }

  override async fetchPopularManga(_page: number): Promise<MangasPage> {
    throw new Error(HOME_UNAVAILABLE_MSG);
  }

  protected override popularMangaParse(response: Response): MangasPage {
    const result = response.parseAs<JsonObject[]>();
    return this.parseMangaList(result, SortType.PINNED);
  }

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const response = await this.executeSuccess(this.mangaDetailsRequest(manga));
    return this.parseManga(response.parseAs<JsonObject>(), manga);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return this.chapterListRequest(manga);
  }

  protected override mangaDetailsParse(_response: Response): SManga {
    throw new Error("UnsupportedOperationException");
  }

  // asObservable(), not asObservableSuccess(): no status check, as upstream
  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const response = await this.client.execute(this.chapterListRequest(manga));
    return this.parseChapterList(response, manga);
  }

  // Gets the chapter list based on the series being viewed
  protected override chapterListRequest(manga: SManga): Request {
    const urlComponents = manga.url.split("/");
    const source = urlComponents[2];
    const slug = urlComponents[3];

    return GET(`${this.baseUrl}/read/api/${source}/series/${slug}/`, this.cubariHeaders);
  }

  protected override chapterListParse(_response: Response): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }

  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.executeSuccess(this.pageListRequest(chapter));
    return chapter.url.includes("/chapter/") ? this.directPageListParse(response) : this.seriesJsonPageListParse(response, chapter);
  }

  protected override pageListRequest(chapter: SChapter): Request {
    if (chapter.url.includes("/chapter/")) return GET(`${this.baseUrl}${chapter.url}`, this.cubariHeaders);

    const url = chapter.url.split("/");
    const source = url[2];
    const slug = url[3];

    return GET(`${this.baseUrl}/read/api/${source}/series/${slug}/`, this.cubariHeaders);
  }

  private pageSrc(jsonEl: unknown): string {
    return jsonEl !== null && typeof jsonEl === "object" && !Array.isArray(jsonEl) ? content((jsonEl as JsonObject).src) : content(jsonEl);
  }

  private directPageListParse(response: Response): Page[] {
    const pages = response.parseAs<unknown[]>();

    return pages.map((jsonEl, i) => new Page(i, "", this.pageSrc(jsonEl)));
  }

  private seriesJsonPageListParse(response: Response, chapter: SChapter): Page[] {
    const jsonObj = response.parseAs<JsonObject>();
    const groups = jsonObj.groups as JsonObject;
    // associateBy: a later group with the same name wins
    const groupMap = new Map<string, string>();
    for (const [key, value] of Object.entries(groups)) groupMap.set(content(value) || "default", key);
    const chapterScanlator = chapter.scanlator ?? "default"; // workaround for "" as group causing NullPointerException (#13772)

    // prevent NullPointerException when chapters.key is 084 and chapter.chapter_number is 84
    const chapters = new Map<string, JsonObject>();
    for (const [key, value] of Object.entries(jsonObj.chapters as JsonObject)) chapters.set(key.replace(/^0+(?!$)/, ""), value as JsonObject);

    const entry = chapters.get(floatToString(chapter.chapter_number)) ?? chapters.get(String(Math.trunc(chapter.chapter_number)));
    const pages = ((entry!.groups as JsonObject)[groupMap.get(chapterScanlator)!] as unknown[]) ?? null;
    if (pages === null) throw new Error("NullPointerException");

    return pages.map((jsonEl, i) => new Page(i, "", this.pageSrc(jsonEl)));
  }

  protected override pageListParse(_response: Response): Page[] {
    throw new Error("UnsupportedOperationException");
  }

  // KeiSource.getSearchManga would route URLs to getMangaByUrl; Cubari handles them itself
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    // handle direct links or old cubari:source/id format
    if (query.startsWith("https://") || query.startsWith("cubari:")) {
      const [source, slug] = this.deepLinkHandler(query);
      // upstream tags the series as recently read through a WebView (TagInterceptor); that only touches the site's history
      const response = await this.executeSuccess(GET(`${this.baseUrl}/read/api/${source}/series/${slug}/`, this.cubariHeaders));
      const result = response.parseAs<JsonObject>();
      const manga = SManga.create();
      manga.url = `/read/${source}/${slug}`;
      return new MangasPage([this.parseManga(result, manga)], false);
    }

    // HomeInterceptor: the search runs over the reader's stored series, of which there are none without the WebView
    throw new Error(SEARCH_FALLBACK_MSG);
  }

  protected override searchMangaRequest(_page: number, _query: string, _filters: FilterList): Request {
    return GET(`${this.baseUrl}/`, this.cubariHeaders);
  }

  private deepLinkHandler(query: string): [string, string] {
    if (query.startsWith("cubari:")) {
      // legacy cubari:source/slug format
      const rest = substringAfter(query, "cubari:");
      const i = rest.indexOf("/");
      if (i < 0) throw new Error("IndexOutOfBoundsException");
      return [rest.slice(0, i), rest.slice(i + 1)];
    }
    // direct url searching
    const url = toHttpUrl(query);
    const host = url.host;
    const pathSegments = url.pathSegments;

    if (host.endsWith("imgur.com") && pathSegments.length >= 2 && ["a", "gallery"].includes(pathSegments[0])) return ["imgur", pathSegments[1]];
    if (host.endsWith("reddit.com") && pathSegments.length >= 2 && pathSegments[0] === "gallery") return ["reddit", pathSegments[1]];
    if (host === "imgchest.com" && pathSegments.length >= 2 && pathSegments[0] === "p") return ["imgchest", pathSegments[1]];
    if (host.endsWith("catbox.moe") && pathSegments.length >= 2 && pathSegments[0] === "c") return ["catbox", pathSegments[1]];
    if (host.endsWith("cubari.moe") && pathSegments.length >= 3) return [pathSegments[1], pathSegments[2]];
    if (host.endsWith(".githubusercontent.com")) {
      const src = substringBefore(host, ".");
      const path = url.encodedPath;

      // Base64.NO_PADDING
      return ["gist", Base64.encode(utf8(`${src}${path}`)).replace(/=+$/, "")];
    }
    throw new Error(SEARCH_FALLBACK_MSG);
  }

  protected override searchMangaParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ------------- Helpers and whatnot ---------------

  private readonly volumeNotSpecifiedTerms = new Set(["Uncategorized", "null", ""]);

  private parseChapterList(response: Response, manga: SManga): SChapter[] {
    const jsonObj = response.parseAs<JsonObject>();
    const groups = jsonObj.groups as JsonObject;
    const chapters = jsonObj.chapters as JsonObject;

    const chapterList = Object.entries(chapters).flatMap(([chapterNum, value]) => {
      const chapterObj = value as JsonObject;
      const chapterGroups = chapterObj.groups as JsonObject;
      const rawVolume = content(chapterObj.volume);
      const volume = this.volumeNotSpecifiedTerms.has(rawVolume) ? null : rawVolume;
      const title = content(chapterObj.title);

      return Object.keys(chapterGroups).map((groupNum) => {
        const releaseDate = (chapterObj.release_date as JsonObject | undefined)?.[groupNum];

        const chapter = SChapter.create();
        chapter.scanlator = content(groups[groupNum]);
        chapter.chapter_number = toFloatOrNull(chapterNum) ?? -1;

        chapter.date_upload = releaseDate != null ? Math.trunc(Number(releaseDate)) * 1000 : 0;

        let name = "";
        if (volume != null && volume.trim()) name += `Vol.${volume} `;
        name += `Ch.${chapterNum}`;
        if (title.trim()) name += ` - ${title}`;
        chapter.name = name;

        chapter.url = Array.isArray(chapterGroups[groupNum]) ? `${manga.url}/${chapterNum}/${groupNum}` : content(chapterGroups[groupNum]);
        return chapter;
      });
    });

    // sortedByDescending is stable
    return chapterList.sort((a, b) => b.chapter_number - a.chapter_number);
  }

  private parseMangaList(payload: JsonObject[], sortType: SortType): MangasPage {
    const mangaList: SManga[] = [];
    for (const jsonObj of payload) {
      const pinned = jsonObj.pinned as boolean;

      if ((sortType === SortType.PINNED && pinned) || (sortType === SortType.UNPINNED && !pinned) || sortType === SortType.ALL) mangaList.push(this.parseManga(jsonObj));
    }

    return new MangasPage(mangaList, false);
  }

  private parseManga(jsonObj: JsonObject, mangaReference: SManga | null = null): SManga {
    const manga = SManga.create();
    manga.title = content(jsonObj.title);
    manga.artist = jsonObj.artist != null ? content(jsonObj.artist) : ARTIST_FALLBACK;
    manga.author = jsonObj.author != null ? content(jsonObj.author) : AUTHOR_FALLBACK;

    const descriptionFull = jsonObj.description != null ? content(jsonObj.description) : null;
    manga.description = descriptionFull != null ? substringBefore(descriptionFull, "Tags: ") : DESCRIPTION_FALLBACK;
    manga.genre = descriptionFull != null ? (descriptionFull.includes("Tags: ") ? substringAfter(descriptionFull, "Tags: ") : "") : "";

    manga.url = mangaReference?.url ?? content(jsonObj.url);
    manga.thumbnail_url = jsonObj.coverUrl != null ? content(jsonObj.coverUrl) : jsonObj.cover != null ? content(jsonObj.cover) : "";
    return manga;
  }

  // ----------------- Things we aren't supporting -----------------

  protected override imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
