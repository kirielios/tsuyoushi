// Mihon's classic source API (extensions lib 1.4): eu.kanade.tachiyomi.source.online.HttpSource and ParsedHttpSource,
// plus eu.kanade.tachiyomi.network's GET/POST. Built on KeiSource so the bundle/host contract stays the same: the host
// calls getPopularManga / fetchMangaUpdate / getPageList / getImageUrl / getImage, and these route to the
// request/parse pairs exactly as Mihon's fetch* methods do (asObservableSuccess: a non-2xx response throws).
//
// Kotlin's Observable `fetchX` and suspend `getX` are one async `fetchX` here; a port overrides it where upstream
// overrides either. Search: every query, pasted URLs included, goes to fetchSearchManga as in Mihon 1.4 (sources
// handle URLs in searchMangaRequest/fetchSearchManga themselves; KeiSource's getMangaByUrl routing is 1.6-only).
//
// ParsedHttpSource: Kotlin overloads mangaDetailsParse / pageListParse / imageUrlParse on Response and Document. TS has
// one name, so ParsedHttpSource's fetchMangaDetails / fetchPageList / fetchImageUrl pass the Document; a subclass
// that overrides the Response overload upstream overrides the matching fetchX here instead.
import { HttpUrl } from "./httpurl.ts";
import type { Document, Element } from "./jsoup.ts";
import { MangasPage, SMangaUpdate, SManga, type Page, type SChapter } from "./models.ts";
import type { Request, Response } from "./network.ts";
import { KeiSource } from "./source.ts";
import type { FilterList } from "./filters.ts";

type Url = string | URL | HttpUrl;
type Body = string | URLSearchParams | Uint8Array;
/**
 * Request builders and parsers may be async: Kotlin ones often make blocking calls (client.newCall(...).execute()).
 * imageRequest stays synchronous (KeiSource contract); a source that needs I/O there overrides getImage.
 */
type Async<T> = T | Promise<T>;

/** eu.kanade.tachiyomi.network.GET */
export function GET(url: Url, headers: Headers = new Headers()): Request {
  return { url: String(url), method: "GET", headers: new Headers(headers) };
}

/** eu.kanade.tachiyomi.network.POST; the default body is an empty FormBody. `contentType` stands in for RequestBody's media type. */
export function POST(url: Url, headers: Headers = new Headers(), body: Body = new URLSearchParams(), contentType?: string): Request {
  const h = new Headers(headers);
  if (contentType) h.set("Content-Type", contentType);
  else if (body instanceof URLSearchParams && !h.has("Content-Type")) h.set("Content-Type", "application/x-www-form-urlencoded");
  return { url: String(url), method: "POST", headers: h, body: body instanceof URLSearchParams ? body.toString() : body };
}

export abstract class HttpSource extends KeiSource {
  /** 1.4's HttpSource.headersBuilder(): only a User-Agent (no Referer/Origin, unlike KeiSource). */
  override headersBuilder(): Headers {
    return new Headers({ "User-Agent": this.host.userAgent });
  }

  /** client.newCall(request).asObservableSuccess() */
  protected async executeSuccess(request: Request): Promise<Response> {
    return this.client.execute(request, true);
  }

  // --- popular
  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchPopularManga(page);
  }
  async fetchPopularManga(page: number): Promise<MangasPage> {
    return this.popularMangaParse(await this.executeSuccess(await this.popularMangaRequest(page)));
  }
  protected abstract popularMangaRequest(page: number): Async<Request>;
  protected abstract popularMangaParse(response: Response): Async<MangasPage>;

  // --- search
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }
  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }
  async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.searchMangaParse(await this.executeSuccess(await this.searchMangaRequest(page, query, filters)));
  }
  protected abstract searchMangaRequest(page: number, query: string, filters: FilterList): Async<Request>;
  protected abstract searchMangaParse(response: Response): Async<MangasPage>;

  // --- latest
  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchLatestUpdates(page);
  }
  async fetchLatestUpdates(page: number): Promise<MangasPage> {
    return this.latestUpdatesParse(await this.executeSuccess(await this.latestUpdatesRequest(page)));
  }
  protected abstract latestUpdatesRequest(page: number): Async<Request>;
  protected abstract latestUpdatesParse(response: Response): Async<MangasPage>;

  // --- details
  async fetchMangaDetails(manga: SManga): Promise<SManga> {
    return this.mangaDetailsParse(await this.executeSuccess(await this.mangaDetailsRequest(manga)));
  }
  mangaDetailsRequest(manga: SManga): Async<Request> {
    return GET(this.baseUrl + manga.url, this.headers);
  }
  protected abstract mangaDetailsParse(response: Response): Async<SManga>;

  // --- chapters
  async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    if (manga.status === SManga.LICENSED) throw new Error("Licensed - No chapters to show");
    return this.chapterListParse(await this.executeSuccess(await this.chapterListRequest(manga)));
  }
  protected chapterListRequest(manga: SManga): Async<Request> {
    return this.mangaDetailsRequest(manga);
  }
  protected abstract chapterListParse(response: Response): Async<SChapter[]>;
  /** Called for each fetched chapter before it is stored (Mihon's prepareNewChapter). */
  prepareNewChapter(_chapter: SChapter, _manga: SManga): void {}

  /**
   * The 1.6 entry point over 1.4's fetchMangaDetails + fetchChapterList (run concurrently, as Mihon's refresh does).
   * Details merge onto the stored manga like Mihon's copyFrom: url and memo stay, blank/missing fields do not overwrite.
   */
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.fetchMangaDetails(manga) : null,
      fetchChapters ? this.fetchChapterList(manga) : null,
    ]);
    const updated: SManga = { ...manga };
    if (details) {
      for (const k of ["title", "artist", "author", "description", "genre", "thumbnail_url"] as const) {
        const v = details[k];
        if (v != null && (k !== "title" || v.trim() !== "")) updated[k] = v;
      }
      updated.status = details.status;
      updated.initialized = true;
    }
    chapterList?.forEach((c) => this.prepareNewChapter(c, updated));
    return new SMangaUpdate(updated, chapterList ?? chapters);
  }

  // --- related (Komikku's source-api; the reader does not ask for them, sources opt in via supportsRelatedMangas)
  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    return this.relatedMangaListParse(await this.executeSuccess(await this.relatedMangaListRequest(manga)));
  }
  protected relatedMangaListRequest(manga: SManga): Async<Request> {
    return this.mangaDetailsRequest(manga);
  }
  protected async relatedMangaListParse(response: Response): Promise<SManga[]> {
    return (await this.popularMangaParse(response)).mangas;
  }

  // --- pages
  getPageList(chapter: SChapter): Promise<Page[]> {
    return this.fetchPageList(chapter);
  }
  async fetchPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse(await this.executeSuccess(await this.pageListRequest(chapter)));
  }
  protected pageListRequest(chapter: SChapter): Async<Request> {
    return GET(this.baseUrl + chapter.url, this.headers);
  }
  protected abstract pageListParse(response: Response): Async<Page[]>;

  // --- image URL (pages that only carry a page URL)
  override getImageUrl(page: Page): Promise<string> {
    return this.fetchImageUrl(page);
  }
  async fetchImageUrl(page: Page): Promise<string> {
    return this.imageUrlParse(await this.executeSuccess(await this.imageUrlRequest(page)));
  }
  protected imageUrlRequest(page: Page): Async<Request> {
    return GET(page.url, this.headers);
  }
  protected abstract imageUrlParse(response: Response): Async<string>;

  /** 1.4: GET(page.imageUrl!!, headers); getImage sends it through the client. */
  override imageRequest(page: Page): Request {
    return GET(page.imageUrl!, this.headers);
  }
  override getImage(page: Page): Promise<Response> {
    return this.executeSuccess(this.imageRequest(page));
  }

  override getMangaUrl(manga: SManga): string {
    return syncUrl(this.mangaDetailsRequest(manga), "getMangaUrl");
  }
  override getChapterUrl(chapter: SChapter): string {
    return syncUrl(this.pageListRequest(chapter), "getChapterUrl");
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [];
  }
}

/** getMangaUrl/getChapterUrl read the request's URL synchronously; a source with async builders overrides them. */
function syncUrl(request: Async<Request>, method: string): string {
  if (request instanceof Promise) throw new Error(`${method}: the request builder is async, override ${method}`);
  return request.url;
}

/** A MangasPage from a document: `selector` items, next page when `nextPageSelector` matches. */
function parseMangasPage(document: Document, selector: string, fromElement: (e: Element) => SManga, nextPageSelector: string | null): MangasPage {
  const mangas = document.select(selector).map((e) => fromElement(e));
  const hasNextPage = nextPageSelector != null && document.select(nextPageSelector).first() != null;
  return new MangasPage(mangas, hasNextPage);
}

export abstract class ParsedHttpSource extends HttpSource {
  protected popularMangaParse(response: Response): MangasPage {
    return parseMangasPage(response.asJsoup(), this.popularMangaSelector(), (e) => this.popularMangaFromElement(e), this.popularMangaNextPageSelector());
  }
  protected abstract popularMangaSelector(): string;
  protected abstract popularMangaFromElement(element: Element): SManga;
  protected abstract popularMangaNextPageSelector(): string | null;

  protected searchMangaParse(response: Response): MangasPage {
    return parseMangasPage(response.asJsoup(), this.searchMangaSelector(), (e) => this.searchMangaFromElement(e), this.searchMangaNextPageSelector());
  }
  protected abstract searchMangaSelector(): string;
  protected abstract searchMangaFromElement(element: Element): SManga;
  protected abstract searchMangaNextPageSelector(): string | null;

  protected latestUpdatesParse(response: Response): MangasPage {
    return parseMangasPage(response.asJsoup(), this.latestUpdatesSelector(), (e) => this.latestUpdatesFromElement(e), this.latestUpdatesNextPageSelector());
  }
  protected abstract latestUpdatesSelector(): string;
  protected abstract latestUpdatesFromElement(element: Element): SManga;
  protected abstract latestUpdatesNextPageSelector(): string | null;

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    return this.mangaDetailsParse((await this.executeSuccess(await this.mangaDetailsRequest(manga))).asJsoup());
  }
  /** Receives the Document (see the file header). */
  protected abstract override mangaDetailsParse(document: Document | Response): Async<SManga>;

  protected chapterListParse(response: Response): SChapter[] {
    return response
      .asJsoup()
      .select(this.chapterListSelector())
      .map((e) => this.chapterFromElement(e));
  }
  protected abstract chapterListSelector(): string;
  protected abstract chapterFromElement(element: Element): SChapter;

  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.executeSuccess(await this.pageListRequest(chapter))).asJsoup());
  }
  /** Receives the Document (see the file header). */
  protected abstract override pageListParse(document: Document | Response): Async<Page[]>;

  override async fetchImageUrl(page: Page): Promise<string> {
    return this.imageUrlParse((await this.executeSuccess(await this.imageUrlRequest(page))).asJsoup());
  }
  /** Receives the Document (see the file header). */
  protected abstract override imageUrlParse(document: Document | Response): Async<string>;
}
