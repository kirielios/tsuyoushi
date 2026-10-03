// Port of keiyoushi/extensions-source src/all/novelcool/NovelCool.kt
import {
  ClientBuilder,
  DateTimeFormatter,
  Filter,
  HttpClient,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseHtml,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type ChainInterceptor,
  type Document,
  type Elements,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { toSManga, type NovelCoolBrowsePayload, type NovelCoolBrowseResponse } from "./dto.ts";
import { AuthorFilter, GenreFilter, RatingFilter, StatusFilter, getRatingList, getStatusList } from "./filters.ts";

const APP_ID = "202201290625004";
const APP_SECRET = "c73a8590641781f203660afca1d37ada";
const SIZE = 20;

const DATE_FORMATTER = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

// Matches any http/https URL inside single or double quotes within the all_imgs_url array.
// Using the same approach as NineAnime which shares the same image-serving infrastructure.
const imageUrlRegex = /["'](https?:\/\/[^"']+)["']/g;

const JS_REDIRECT_REGEX = /window\.location\.href\s*=\s*["']([^"']+)["']/;

const PREF_API_SEARCH = "pref_use_search_api";

// copied from Madara
const completedStatusList = ["completed", "completo", "completado", "concluído", "concluido", "finalizado", "terminé", "hoàn thành"];

const ongoingStatusList = [
  "ongoing",
  "Продолжается",
  "updating",
  "em lançamento",
  "em lançamento",
  "em andamento",
  "em andamento",
  "en cours",
  "ativo",
  "lançando",
  "Đang Tiến Hành",
  "devam ediyor",
  "devam ediyor",
  "in corso",
  "in arrivo",
  "en curso",
  "en curso",
  "emision",
  "curso",
  "en marcha",
  "Publicandose",
  "en emision",
];

export default class NovelCool extends KeiSource {
  private get siteLang(): string {
    return this.lang === "pt-BR" ? "br" : this.lang;
  }

  private readonly apiUrl = "https://api.novelcool.com";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1);
  }

  // ponytail: upstream's client.newBuilder() shares the rate limiter and connection pool; this second client has its own limiter and cookie jar
  private _pageClient?: HttpClient;
  private get pageClient(): HttpClient {
    return (this._pageClient ??= new HttpClient(this.host, () => this.headers, new ClientBuilder().rateLimit(1).addChainInterceptor(this.jsRedirect)));
  }

  private get useAppApi(): boolean {
    return this.preferences.getBoolean(PREF_API_SEARCH, true);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.useAppApi ? this.commonApiRequest(`${this.apiUrl}/elite/hot/`, page) : this.parseMangasPage((await this.client.get(`${this.baseUrl}/category/new_list.html`)).asJsoup());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.useAppApi ? this.commonApiRequest(`${this.apiUrl}/elite/latest/`, page) : this.parseMangasPage((await this.client.get(`${this.baseUrl}/category/latest.html`)).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (this.useAppApi) {
      return this.commonApiRequest(`${this.apiUrl}/book/search/`, page, query);
    }

    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder();
    url.addQueryParameter("name", query.trim());

    for (const filter of filters) {
      if (filter instanceof AuthorFilter) {
        url.addQueryParameter("author", filter.state.trim());
      } else if (filter instanceof GenreFilter) {
        url.addQueryParameter("category_id", "," + filter.included.join(","));
        url.addQueryParameter("out_category_id", "," + filter.excluded.join(","));
      } else if (filter instanceof StatusFilter) {
        url.addQueryParameter("completed_series", filter.getValue());
      } else if (filter instanceof RatingFilter) {
        url.addQueryParameter("rate_star", filter.getValue());
      }
    }

    url.addQueryParameter("page", String(page));

    return this.parseMangasPage((await this.client.get(url.build().toString())).asJsoup());
  }

  private parseMangasPage(document: Document): MangasPage {
    const mangas = document.select(".book-list .book-item:not(:has(.book-type-novel))").map((element) => {
      const manga = SManga.create();
      manga.title = element.select(".book-pic").attr("title");
      manga.url = urlWithoutDomain(element.select("a").attr("href"));
      manga.thumbnail_url = this.imgAttr(element.select("img"));
      return manga;
    });
    const hasNextPage = document.selectFirst("div.page-nav a div.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  override get supportsFilterFetching() {
    return !this.useAppApi;
  }

  /** Kotlin's List<Pair<String, String>> as JSON: {first, second} objects. */
  override async fetchFilterData(): Promise<{ first: string; second: string }[]> {
    const document = (await this.client.get(`${this.baseUrl}/search/`)).asJsoup();

    return (document.selectFirst(".category-list")?.select(".category-id-item") ?? []).map((div) => ({
      first: div.attr("title"),
      second: div.attr("cate_id"),
    }));
  }

  override getFilterList(data: unknown = null): FilterList {
    if (this.useAppApi) {
      return [new Filter.Header("Not supported when using App API")];
    }

    const filters: Filter[] = [new AuthorFilter("Author"), new StatusFilter("Status", getStatusList()), new RatingFilter("Rating", getRatingList())];

    const genres = data as { first: string; second: string }[] | null;
    if (genres) filters.push(new GenreFilter("Genres", genres.map((it): [string, string] => [it.first, it.second])));

    return filters;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.url = manga.url;
    details.title = document.selectFirst("h1.bookinfo-title")!.text();
    details.description = document.selectFirst("div.bk-summary-txt")?.text();
    details.genre = document
      .select(".bookinfo-category-list a")
      .map((it) => it.text())
      .join(", ");
    details.author = document.selectFirst(".bookinfo-author > a")?.attr("title");
    details.thumbnail_url = document.selectFirst(".bookinfo-pic-img")?.attr("abs:src");
    details.status = this.parseStatus(document.select(".bookinfo-category-list a").first()?.text());

    const chapterList = document.select(".chapter-item-list a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("href"));
      chapter.name = element.attr("title");
      chapter.date_upload = DATE_FORMATTER.tryParseDate(element.select(".chapter-item-time").text());
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  private parseStatus(s: string | null | undefined): number {
    if (s == null) return SManga.UNKNOWN;
    const lower = s.toLowerCase();
    if (completedStatusList.includes(lower)) return SManga.COMPLETED;
    if (ongoingStatusList.includes(lower)) return SManga.ONGOING;
    return SManga.UNKNOWN;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    let doc = (await this.pageClient.get(this.getChapterUrl(chapter))).asJsoup();

    // Chapter pages redirect (HTTP 302) to an intermediate "choose a source" page on a
    // partner domain (e.g. techsmartideas.com). That page contains a.vision-button links
    // which point to the actual image server (e.g. financemasterpro.com). This is the
    // same shared infrastructure used by NineAnime.
    const serverUrl = doc.selectFirst("a.vision-button")?.attr("abs:href");

    if (serverUrl != null) {
      const serverHeaders = this.headers;
      serverHeaders.set("Referer", doc.location());
      doc = (await this.pageClient.get(serverUrl, serverHeaders)).asJsoup();
    }

    // Parse all_imgs_url from the script using a robust approach: extract the array
    // content as a string and then find all quoted http URLs within it. This avoids
    // fragile JSON parsing and trailing-comma issues in the original JS array.
    const scriptData = doc.select("script:containsData(all_imgs_url)").first()?.data();

    if (scriptData != null) {
      const arrayContent = substringBefore(substringAfter(scriptData, "all_imgs_url: ["), "]");
      const images = [...arrayContent.matchAll(imageUrlRegex)].map((it) => it[1].replaceAll("\\/", "/"));

      if (images.length > 0) {
        return images.map((img, idx) => new Page(idx, "", img));
      }
    }

    return this.singlePageParse(doc);
  }

  private singlePageParse(document: Document): Page[] {
    const select = document.selectFirst(".mangaread-pagenav > .sl-page");
    return select ? select.select("option").map((page, idx) => new Page(idx, page.attr("value"))) : [];
  }

  override async getImageUrl(page: Page): Promise<string> {
    const document = (await this.client.get(page.url)).asJsoup();
    return document.select(".mangaread-manga-pic").attr("src");
  }

  private imgAttr(elements: Elements): string {
    return elements.some((it) => it.hasAttr("lazy_url")) ? elements.attr("abs:lazy_url") : elements.attr("abs:src");
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = PREF_API_SEARCH;
    pref.title = "Use App API for browse";
    pref.summary = "Results may be more reliable";
    pref.setDefaultValue(true);
    screen.addPreference(pref);
  }

  /** Follows `window.location.href = "..."` redirects the site answers with; the URL is read with a regex, the script is not run. */
  private readonly jsRedirect: ChainInterceptor = async (chain) => {
    const request = chain.request();
    const headers = new Headers(request.headers);
    headers.delete("Accept-Encoding");
    const response = await chain.proceed({ ...request, headers });

    if (response.header("Content-Type")?.includes("text/html") !== true) {
      return response;
    }

    const document = parseHtml(this.host.load, response.text(), response.url);
    const script = document.selectFirst("script:containsData(window.location.href)")?.html();
    if (script == null) return response;

    const jsRedirect = JS_REDIRECT_REGEX.exec(script)?.[1];
    if (jsRedirect == null) return response;

    const requestUrl = response.url;

    let url: string;
    try {
      url = new URL(jsRedirect, requestUrl).href;
    } catch {
      return response;
    }

    const newHeaders = new Headers(request.headers);
    newHeaders.set("Referer", requestUrl);

    return chain.proceed({ ...request, url, headers: newHeaders });
  };

  private async commonApiRequest(url: string, page: number, query: string | null = null): Promise<MangasPage> {
    const payload: NovelCoolBrowsePayload = {
      appId: APP_ID,
      lang: this.siteLang,
      keyword: query,
      lc_type: "manga",
      page: String(page),
      page_size: String(SIZE),
      secret: APP_SECRET,
    };

    const headers = this.headers;
    headers.set("Content-Type", "application/json; charset=utf-8");
    const response: Response = await this.client.post(url, headers, JSON.stringify(payload, (_k, v: unknown) => (v === null ? undefined : v)));
    const browse = response.parseAs<NovelCoolBrowseResponse>();
    const mangas = (browse.list ?? []).map((it) => {
      const manga = toSManga(it);
      manga.url = urlWithoutDomain(it.url);
      return manga;
    });

    return new MangasPage(mangas, browse.list?.length === SIZE);
  }
}
