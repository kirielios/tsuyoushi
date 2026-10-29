// Port of keiyoushi/extensions-source src/id/westmanga/WestManga.kt
import { FilterList, HttpException, KeiSource, MangasPage, Page, SMangaUpdate, parseHtml, toHttpUrl, type Document, type HttpUrl, type SChapter, type SManga } from "../../../sdk/index.ts";
import { browseToSManga, chapterToSChapter, hasNextPage, mangaToSManga, type ApiGenre, type BrowseManga, type Data, type ImageList, type Manga, type PaginatedData, type VisitTokenResponse } from "./dto.ts";
import { ColorFilter, CountryFilter, GenreFilter, SortFilter, StatusFilter, isUrlFilter } from "./filters.ts";

export default class WestManga extends KeiSource {
  getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.popular);
  }

  getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.latest);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/api/contents`).newBuilder();
    if (query.trim()) builder.addQueryParameter("q", query);
    builder.addQueryParameter("page", String(page));
    builder.addQueryParameter("per_page", "20");
    builder.addQueryParameter("type", "Comic");
    filters.filter(isUrlFilter).forEach((it) => it.addToUrl(builder));
    const url = builder.build();

    const data = await this.apiGet<PaginatedData<BrowseManga>>(url);
    const entries = data.data.map((it) => browseToSManga(it, this.baseUrl));
    return new MangasPage(entries, hasNextPage(data.paginator));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const url = toHttpUrl(`${this.baseUrl}/api/contents/genres`);
    return this.apiGet<unknown>(url, false);
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as Data<ApiGenre[]> | null)?.data?.map((it): [string, string] => [it.name, String(it.id)]);

    const list: FilterList = [new SortFilter(), new StatusFilter(), new CountryFilter(), new ColorFilter()];
    if (genres?.length) list.push(new GenreFilter(genres));
    return list;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments[0] !== "comic" && pathSegments[0] !== "manga") return null;
    const slug = pathSegments[1];
    if (slug == null) return null;
    const api = toHttpUrl(`${this.baseUrl}/api/comic/${slug}`);

    return mangaToSManga((await this.apiGet<Data<Manga>>(api)).data, (html) => this.parseBodyFragment(html), this.baseUrl);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const path = toHttpUrl(`${this.baseUrl}${manga.url}`).pathSegments;
    if (path.length !== 3) throw new Error(`Migrate from ${this.name} to ${this.name}`);
    const slug = path[1];
    const api = toHttpUrl(`${this.baseUrl}/api/comic/${slug}`);

    const data = (await this.apiGet<Data<Manga>>(api)).data;
    return new SMangaUpdate(
      mangaToSManga(data, (html) => this.parseBodyFragment(html), this.baseUrl),
      data.chapters.map(chapterToSChapter),
    );
  }

  override getMangaUrl(manga: SManga): string {
    const slug = toHttpUrl(`${this.baseUrl}${manga.url}`).pathSegments[1];
    return `${this.baseUrl}/comic/${slug}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const path = toHttpUrl(`${this.baseUrl}${chapter.url}`).pathSegments;
    if (!path.length) throw new Error("Refresh Chapter List");
    const slug = path[0];

    const url = toHttpUrl(`${this.baseUrl}/api/v/${slug}`);
    const data = (await this.apiGet<Data<ImageList>>(url)).data;
    return data.images.map((img, idx) => new Page(idx, "", img.startsWith("http") ? img : `${this.baseUrl}${img}`));
  }

  override getChapterUrl(chapter: SChapter): string {
    const slug = toHttpUrl(`${this.baseUrl}${chapter.url}`).pathSegments[0];
    return `${this.baseUrl}/view/${slug}`;
  }

  /** Jsoup.parseBodyFragment(html, baseUrl) */
  private parseBodyFragment(html: string): Document {
    return parseHtml(this.host.load, html, this.baseUrl);
  }

  private tokenCache: string | null = null;
  private tokenChecked = false;

  // Upstream reads the WebView's localStorage "global-app-storage" session token (getLocalStorage); there is no WebView here, which
  // upstream's runCatching already treats as "no token".
  private bearerToken(): string | null {
    if (this.tokenChecked) return this.tokenCache;
    this.tokenCache = null;
    this.tokenChecked = true;
    return this.tokenCache;
  }

  private visitTokenPromise: Promise<string | null> | null = null;
  private visitToken: string | null = null;
  private visitTokenExpiresAt = 0;

  // upstream's Mutex: concurrent callers share one in-flight request
  private getVisitToken(forceRefresh = false): Promise<string | null> {
    const prev = this.visitTokenPromise ?? Promise.resolve(null);
    const next = prev.then(() => this.loadVisitToken(forceRefresh));
    this.visitTokenPromise = next.catch(() => null);
    return next;
  }

  private async loadVisitToken(forceRefresh: boolean): Promise<string | null> {
    const now = Date.now();
    if (!forceRefresh && this.visitToken != null && now < this.visitTokenExpiresAt - 5 * 60_000) return this.visitToken;

    let response: VisitTokenResponse | null = null;
    try {
      response = (await this.client.get(`${this.baseUrl}/api/visit-token`)).parseAs<VisitTokenResponse>();
    } catch {
      response = null;
    }

    if (response?.status === true && response.token) {
      this.visitToken = response.token;
      this.visitTokenExpiresAt = response.expires_at != null ? response.expires_at * 1000 : now + 3_600_000;
      return this.visitToken;
    }

    if (forceRefresh) {
      this.visitToken = null;
      this.visitTokenExpiresAt = 0;
    }
    return this.visitToken;
  }

  private async apiHeaders(includeToken = true): Promise<Headers> {
    const headers = this.headersBuilder();
    const visit = await this.getVisitToken();
    if (visit != null) headers.set("X-WM-Visit", visit);
    if (includeToken) {
      const token = this.bearerToken();
      if (token != null) headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }

  private async apiGet<T>(url: HttpUrl, includeToken = true): Promise<T> {
    try {
      return (await this.client.get(url.toString(), await this.apiHeaders(includeToken))).parseAs<T>();
    } catch (e) {
      if (e instanceof HttpException && (e.code === 403 || e.code === 404)) {
        await this.getVisitToken(true);
        return (await this.client.get(url.toString(), await this.apiHeaders(includeToken))).parseAs<T>();
      }
      throw e;
    }
  }
}
