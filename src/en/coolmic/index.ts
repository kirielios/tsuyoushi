// Port of keiyoushi/extensions-source src/en/coolmic/Coolmic.kt
import {
  HttpUrl,
  KeiSource,
  FilterList,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  parseAs,
  toHttpUrl,
  type ClientBuilder,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { episodeToSChapter, isLocked, resultToSManga, titleToSManga, type DetailsResponse, type KeyRequestBody, type KeyResponse, type PageResponse, type SeriesResponse, type ViewerResponse } from "./dto.ts";
import { SortFilter, StatusFilter } from "./filters.ts";
import { imageInterceptor } from "./interceptor.ts";

const HIDE_LOCKED_PREF_KEY = "hide_locked";
const SEARCH_SIZE = 20;

export default class Coolmic extends KeiSource {
  private get domain() {
    return toHttpUrl(this.baseUrl).host;
  }
  private get apiUrl() {
    return `${this.baseUrl}/api/v1`;
  }
  private get cdnUrl() {
    return `https://en-img.${this.domain}`;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addInterceptor((request) => this.addCookie(request, [["is_mature", "true"]]))
      .addChainInterceptor(imageInterceptor);
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the source's domain on every matching request, which then sends them. */
  private addCookie(request: Request, cookies: [string, string][]): Request {
    const domain = this.domain;
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    }
    return request;
  }

  getPopularManga(page: number): Promise<MangasPage> {
    const sort = new SortFilter();
    sort.state = 3;
    return this.getSearchMangaList(page, "", FilterList(sort));
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    const sort = new SortFilter();
    sort.state = 1;
    return this.getSearchMangaList(page, "", FilterList(sort));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const status = firstInstanceOrNull(filters, StatusFilter)?.value;
    const sort = firstInstanceOrNull(filters, SortFilter)?.value;

    const builder = toHttpUrl(`${this.apiUrl}/search_titles`)
      .newBuilder()
      .addQueryParameter("keyword", query)
      .addQueryParameter("page", String(page))
      .addQueryParameter("per", String(SEARCH_SIZE))
      .addQueryParameter("search_field", "all");
    if (sort != null) builder.addQueryParameter("sort", sort);
    if (status) {
      const [name, number] = status.split(":");
      builder.addQueryParameter("status_filters[0][field]", name);
      builder.addQueryParameter("status_filters[0][value]", number);
    }

    const result = (await this.client.get(builder.build().toString())).parseAs<SeriesResponse>();
    const mangas = result.results.map((it) => resultToSManga(it, this.cdnUrl));
    const hasNextPage = page * SEARCH_SIZE < result.total;
    return new MangasPage(mangas, hasNextPage);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new StatusFilter());
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/titles/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const result = this.parsePageObjects(await this.client.get(this.getMangaUrl(manga)));

    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    const updatedChapters = result.episodes
      .filter((it) => !hideLocked || !isLocked(it))
      .map((it) => episodeToSChapter(it))
      .reverse();

    const details = titleToSManga(result.title);
    details.url = manga.url;
    return new SMangaUpdate(details, updatedChapters);
  }

  private parsePageObjects(response: Response): DetailsResponse {
    return parseAs<DetailsResponse>(response.asJsoup().selectFirst("title-page")!.attr(":page-objects"));
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/episodes/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const result = (await this.client.get(`${this.apiUrl}/viewer/comic/secure_episodes/${chapter.url}`)).parseAs<ViewerResponse>();
    if (!result.image_data?.length) throw new Error("Log in via WebView and purchase this chapter to read.");
    return result.image_data.map((it) => new Page(it.num - 1, it.path));
  }

  override async getImageUrl(page: Page): Promise<string> {
    const response = await this.client.get(page.url);
    const url = HttpUrl.parse(response.url);
    const result = response.parseAs<PageResponse>();
    const key = await this.fetchKey(result.kms_encrypted_data_key, result.file_name);
    return url.newBuilder().fragment(`key=${key}`).build().toString();
  }

  private async fetchKey(encryptedKey: string, fileName: string): Promise<string> {
    let response = await this.requestKey(encryptedKey, fileName, await this.csrfToken());
    if (!response.isSuccessful) {
      response = await this.requestKey(encryptedKey, fileName, await this.csrfToken(true));
    }
    return response.parseAs<KeyResponse>().decrypted_key;
  }

  private requestKey(encryptedKey: string, fileName: string, token: string): Promise<Response> {
    const newHeaders = new Headers(this.headers);
    newHeaders.set("X-CSRF-TOKEN", token);
    newHeaders.set("X-Requested-With", "XMLHttpRequest");
    newHeaders.set("Content-Type", "application/json");
    const body: KeyRequestBody = { encrypted_key: encryptedKey, file_name: fileName };
    return this.client.post(`${this.apiUrl}/decryption_keys`, newHeaders, JSON.stringify(body), { ensureSuccess: false });
  }

  private cachedCsrfToken: string | null = null;

  private async csrfToken(refresh = false): Promise<string> {
    if (refresh) this.cachedCsrfToken = null;
    if (this.cachedCsrfToken != null) return this.cachedCsrfToken;
    const token = (await this.client.get(this.baseUrl)).asJsoup().selectFirst("meta[name=csrf-token]")!.attr("content");
    this.cachedCsrfToken = token;
    return token;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
