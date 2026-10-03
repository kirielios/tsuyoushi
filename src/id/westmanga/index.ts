// Port of keiyoushi/extensions-source src/id/westmanga/WestManga.kt
import { FilterList, KeiSource, MangasPage, Page, SMangaUpdate, hmacSha256, parseHtml, toHex, toHttpUrl, type Document, type HttpUrl, type SChapter, type SManga } from "../../../sdk/index.ts";
import { browseToSManga, chapterToSChapter, hasNextPage, mangaToSManga, type ApiGenre, type BrowseManga, type Data, type ImageList, type Manga, type PaginatedData } from "./dto.ts";
import { ColorFilter, CountryFilter, GenreFilter, SortFilter, StatusFilter, isUrlFilter } from "./filters.ts";

const ACCESS_KEY = "WM_WEB_FRONT_END";
const SECRET_KEY = "xxxoidj";

export default class WestManga extends KeiSource {
  private readonly apiUrl = "https://data.mantweh.online";

  getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.popular);
  }

  getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.latest);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.apiUrl}/api/contents`).newBuilder();
    if (query.trim()) builder.addQueryParameter("q", query);
    builder.addQueryParameter("page", String(page));
    builder.addQueryParameter("per_page", "20");
    builder.addQueryParameter("type", "Comic");
    filters.filter(isUrlFilter).forEach((it) => it.addToUrl(builder));
    const url = builder.build();

    const data = (await this.client.get(url.toString(), await this.apiHeaders(url))).parseAs<PaginatedData<BrowseManga>>();
    const entries = data.data.map(browseToSManga);
    return new MangasPage(entries, hasNextPage(data.paginator));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const url = toHttpUrl(`${this.apiUrl}/api/contents/genres`);
    return (await this.client.get(url.toString(), await this.apiHeaders(url, false))).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as Data<ApiGenre[]> | null)?.data?.map((it): [string, string] => [it.name, String(it.id)]);

    const list: FilterList = [new SortFilter(), new StatusFilter(), new CountryFilter(), new ColorFilter()];
    if (genres?.length) list.push(new GenreFilter(genres));
    return list;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments[0] !== "comic") return null;
    const slug = pathSegments[1];
    if (slug == null) return null;
    const api = toHttpUrl(`${this.apiUrl}/api/comic/${slug}`);

    return mangaToSManga((await this.client.get(api.toString(), await this.apiHeaders(api))).parseAs<Data<Manga>>().data, (html) => this.parseBodyFragment(html));
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const path = toHttpUrl(`${this.baseUrl}${manga.url}`).pathSegments;
    if (path.length !== 3) throw new Error(`Migrate from ${this.name} to ${this.name}`);
    const slug = path[1];
    const api = toHttpUrl(`${this.apiUrl}/api/comic/${slug}`);

    const data = (await this.client.get(api.toString(), await this.apiHeaders(api))).parseAs<Data<Manga>>().data;
    return new SMangaUpdate(
      mangaToSManga(data, (html) => this.parseBodyFragment(html)),
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

    const url = toHttpUrl(`${this.apiUrl}/api/v/${slug}`);
    const data = (await this.client.get(url.toString(), await this.apiHeaders(url))).parseAs<Data<ImageList>>().data;
    return data.images.map((img, idx) => new Page(idx, "", img));
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

  // Upstream reads the WebView's localStorage "access_token" (getLocalStorage); there is no WebView here, which
  // upstream's runCatching already treats as "no token".
  private bearerToken(): string | null {
    if (this.tokenChecked) return this.tokenCache;
    this.tokenCache = null;
    this.tokenChecked = true;
    return this.tokenCache;
  }

  private async apiHeaders(url: HttpUrl, includeToken = true): Promise<Headers> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = "wm-api-request";
    const key = timestamp + "GET" + url.encodedPath + ACCESS_KEY + SECRET_KEY;
    const signature = toHex(await hmacSha256(key, message));

    const headers = this.headersBuilder();
    if (includeToken) {
      const token = this.bearerToken();
      if (token != null) headers.set("Authorization", `Bearer ${token}`);
    }
    headers.set("x-wm-request-time", timestamp);
    headers.set("x-wm-accses-key", ACCESS_KEY);
    headers.set("x-wm-request-signature", signature);
    return headers;
  }
}
