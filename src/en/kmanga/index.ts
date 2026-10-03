// Port of keiyoushi/extensions-source src/en/kmanga/KManga.kt
import {
  Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, SwitchPreferenceCompat, firstInstance,
  type ClientBuilder, type PreferenceScreen, type Response,
} from "../../../sdk/index.ts";
import { GenreFilter } from "./filters.ts";
import {
  episodeToSChapter, isLocked, titleToSManga, webTitleToSManga,
  type BirthdayCookie, type DetailResponse, type EpisodeListResponse, type GenreListResponse, type LatestResponse, type RankingApiResponse, type TitleListResponse, type ViewerApiResponse,
} from "./dto.ts";
import { imageInterceptor } from "./imageinterceptor.ts";

const HIDE_LOCKED_PREF_KEY = "hide_locked";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const digest = async (algo: "SHA-256" | "SHA-512", s: string) => hex(await crypto.subtle.digest(algo, new TextEncoder().encode(s)));

export default class KManga extends KeiSource {
  private get domain() {
    return new URL(this.baseUrl).hostname;
  }
  private get apiUrl() {
    return `https://api.${this.domain}`;
  }
  private readonly pageLimit = 25;

  protected override configureHeaders(headers: Headers): Headers {
    headers.append("X-Kmanga-Platform", "3");
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor((chain) => imageInterceptor(this.host, chain))
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const response = await chain.proceed(request);
        if (response.code === 400) {
          const segments = new URL(request.url).pathname.split("/");
          let error: string;
          if (segments[segments.length - 1].includes("viewer")) {
            error = "Log in via WebView and rent or purchase this chapter to read.";
          } else {
            this.reloadUserId = true;
            error = "Open WebView and retry";
          }
          throw new Error(error);
        }
        return response;
      });
  }

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    const offset = (page - 1) * this.pageLimit;
    const url = new URL(`${this.apiUrl}/ranking/all`);
    url.searchParams.append("ranking_id", "12");
    url.searchParams.append("offset", String(offset));
    url.searchParams.append("limit", String(this.pageLimit + 1));

    const rankingResult = (await this.hashedReq(url)).parseAs<RankingApiResponse>();
    const titleIds = rankingResult.ranking_title_list.map((it) => String(it.id));
    if (titleIds.length === 0) return new MangasPage([], false);

    const hasNextPage = titleIds.length > this.pageLimit;
    const mangaIdsToFetch = hasNextPage ? titleIds.slice(0, -1) : titleIds;
    const detailsUrl = new URL(`${this.apiUrl}/title/list`);
    detailsUrl.searchParams.append("title_id_list", mangaIdsToFetch.join(","));

    const result = (await this.hashedReq(detailsUrl)).parseAs<TitleListResponse>();
    return new MangasPage(result.title_list.map(titleToSManga), hasNextPage);
  }

  // Latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const result = (await this.hashedReq(new URL(`${this.apiUrl}/title/weekly`))).parseAs<LatestResponse>();
    const today = result.weekly_list.find((it) => it.weekday_index === result.today_weekday_index);
    if (!today) throw new Error("Collection contains no element matching the predicate.");
    const titleById = new Map(result.title_list.map((it) => [it.title_id, it]));
    const mangas = today.title_id_list.flatMap((it) => {
      const t = titleById.get(it);
      return t ? [titleToSManga(t)] : [];
    });
    return new MangasPage(mangas, false);
  }

  // Search
  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = new URL(`${this.apiUrl}/search/title`);
    if (query.trim()) {
      url.searchParams.append("keyword", query);
      url.searchParams.append("limit", "99999");
    } else {
      const genre = firstInstance(filters, GenreFilter);
      url.searchParams.append("genre_id", genre.value);
      url.searchParams.append("limit", "99999");
    }

    const result = (await this.hashedReq(url)).parseAs<TitleListResponse>();
    return new MangasPage(result.title_list.map(titleToSManga), false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== this.domain) throw new Error("Unsupported Url");
    const titleId = url.pathname.slice(1).split("/")[1];
    if (titleId === undefined) throw new Error("Unsupported Url");
    const manga = SManga.create();
    manga.url = `/title/${titleId}`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }

  private async fetchGenreNames(genreIds: number[]): Promise<string | null> {
    const url = new URL(`${this.apiUrl}/genre/list`);
    url.searchParams.append("genre_id_list", genreIds.join(", "));
    const list = (await this.hashedReq(url)).parseAs<GenreListResponse>().genre_list;
    return list ? list.map((it) => it.genre_name).join(", ") : null;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    const segments = new URL(this.baseUrl + manga.url).pathname.split("/");
    const titleId = segments[segments.length - 1];
    const url = new URL(`${this.apiUrl}/web/title/detail`);
    url.searchParams.append("title_id", titleId);

    const webTitle = (await this.hashedReq(url)).parseAs<DetailResponse>().web_title;
    const genre = webTitle.genre_id_list?.length ? await this.fetchGenreNames(webTitle.genre_id_list) : null;

    let updatedChapters: SChapter[];
    if (fetchChapters) {
      const episodeIds = webTitle.episode_id_list.map(String);
      if (episodeIds.length === 0) updatedChapters = [];
      else {
        const formBody = new URLSearchParams();
        formBody.append("episode_id_list", episodeIds.join(","));
        const result = (await this.hashedReq(new URL(`${this.apiUrl}/episode/list`), formBody)).parseAs<EpisodeListResponse>();
        updatedChapters = result.episode_list
          .filter((it) => !hideLocked || !isLocked(it))
          .map(episodeToSChapter)
          .reverse();
      }
    } else updatedChapters = chapters;

    return new SMangaUpdate(webTitleToSManga(webTitle, titleId, genre), updatedChapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const segments = new URL(this.baseUrl + chapter.url).pathname.split("/");
    const episodeId = segments[segments.length - 1];
    const url = new URL(`${this.apiUrl}/web/episode/viewer`);
    url.searchParams.append("episode_id", episodeId);

    const result = (await this.hashedReq(url)).parseAs<ViewerApiResponse>();
    return result.page_list.map((page, index) => new Page(index, "", `${page}#${result.scramble_seed}:${result.title_id}:${result.episode_id}`));
  }

  private getBirthdayCookie(url: URL): [string, string] {
    const cookies = this.client.cookieJar.loadForRequest(url.href);
    const birthdayCookie = cookies.find((it) => it.name === "birthday")?.value;

    // Default for logged-out users or users without the cookie to bypass age restrictions
    const fallback = (): [string, string] => ["2000-01", String(Math.floor(Date.now() / 1000) + 315360000)];
    if (birthdayCookie != null) {
      try {
        const decoded = decodeURIComponent(birthdayCookie.replaceAll("+", " "));
        const cookieData = JSON.parse(decoded) as BirthdayCookie;
        if (typeof cookieData.value !== "string" || typeof cookieData.expires !== "number") throw new Error("malformed");
        return [cookieData.value, String(cookieData.expires)];
      } catch {
        // Fallback to default if cookie is malformed
        return fallback();
      }
    }
    return fallback();
  }

  // https://kmanga.kodansha.com/_nuxt/vl9so/entry-CSwIbMdW.js
  private async generateHash(params: Map<string, string>, birthday: string, expires: string): Promise<string> {
    const sorted = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const paramStrings = await Promise.all(sorted.map(([key, value]) => this.getHashedParam(key, value)));

    const joinedParams = paramStrings.join(",");
    const hash1 = await digest("SHA-256", joinedParams);
    const cookieHash = await this.getHashedParam(birthday, expires);
    return digest("SHA-512", `${hash1}${cookieHash}`);
  }

  private async getHashedParam(key: string, value: string): Promise<string> {
    const keyHash = await digest("SHA-256", key);
    const valueHash = await digest("SHA-512", value);
    return `${keyHash}_${valueHash}`;
  }

  private userId: number | null = null;
  private reloadUserId = false;

  private async hashedReq(url: URL, body: URLSearchParams | null = null): Promise<Response> {
    if (this.reloadUserId || this.userId == null) this.setUserId();

    const [birthday, expires] = this.getBirthdayCookie(url);
    const params = new Map<string, string>();
    for (const name of new Set((body ?? url.searchParams).keys())) params.set(name, (body ?? url.searchParams).get(name)!);

    const hash = await this.generateHash(params, birthday, expires);
    const newHeaders = this.headersBuilder();
    newHeaders.append("x-kmanga-client-id", String(this.userId));
    newHeaders.append("x-kmanga-is-crawler", "false");
    newHeaders.append("X-Kmanga-Hash", hash);

    return body != null ? this.client.post(url, newHeaders, body) : this.client.get(url, newHeaders);
  }

  private setUserId() {
    this.reloadUserId = false;
    // getLocalStorage(baseUrl, "account") reads the WebView's localStorage (the logged-in account's id); the reader
    // has no WebView, so the user is always logged out (userId 0), as upstream is without a login.
    this.userId = 0;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Search query will ignore genre filter"), new GenreFilter());
  }
}
