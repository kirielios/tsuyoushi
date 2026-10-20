// Port of yuzono/anime-extensions src/all/myreadingmanga/MyReadingManga.kt (and MyReadingMangaFactory.kt)
//
// Tsuyoushi's manga MyReadingManga is all.myreadingmanga; this anime one is all.myreadingmangaanime so the ids differ.
// Upstream caches the main and search pages on the first popular/search parse and builds filters from them; here
// that is fetchFilterData (the host caches it), so filters read "Press 'Reset' to load filters" until it ran.
import {
  AnimeHttpSource,
  DateTimeFormatter,
  EditTextPreference,
  Filter,
  GET,
  Hoster,
  isBlank,
  Locale,
  MangasPage,
  parseHtml,
  POST,
  SAnime,
  SEpisode,
  substringAfterLast,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  Video,
  type ClientBuilder,
  type Element,
  type FilterList,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";

const USERNAME_PREF = "MYREADINGMANGA_USERNAME";
const PASSWORD_PREF = "MYREADINGMANGA_PASSWORD";

// MyReadingMangaFactory.kt: tachiLang -> siteLang, latestLang (defaults to siteLang). Order matches meta.json.
const LANGUAGE_LIST: Record<string, [string, string?]> = {
  ar: ["Arabic"],
  id: ["Bahasa Indonesia", "bahasa"],
  bg: ["Bulgarian"],
  "zh-hk": ["Cantonese"],
  zh: ["Chinese"],
  "zh-tw": ["Chinese (Traditional)", "traditional-chinese"],
  cs: ["Czech"],
  da: ["Danish"],
  en: ["English"],
  fil: ["Filipino"],
  fi: ["Finnish"],
  nl: ["Flemish Dutch", "flemish-dutch"],
  fr: ["French"],
  de: ["German"],
  el: ["Greek"],
  he: ["Hebrew"],
  hi: ["Hindi"],
  hu: ["Hungarian"],
  it: ["Italian"],
  ja: ["Japanese", "jp"],
  ko: ["Korean"],
  ms: ["Malay"],
  no: ["Norwegian Bokmål", "norwegian-bokmal"],
  pl: ["Polish"],
  "pt-BR": ["Portuguese"],
  ro: ["Romanian"],
  ru: ["Russian"],
  es: ["Spanish"],
  sv: ["Swedish"],
  th: ["Thai"],
  tr: ["Turkish"],
  vi: ["Vietnamese"],
};

const EXTENSION_REGEX = /\.(jpg|png|jpeg|webp)/;
const TITLE_REGEX = /\s*\[[^\]]*]\s*|\s*\(\d{4}\)\s*/g;
const dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.US);

/** android.webkit.URLUtil.isValidUrl, for the schemes the page can produce */
const isValidUrl = (url: string | null | undefined): url is string => url != null && /^https?:\/\/./i.test(url);

function randomString(length: number): string {
  const charPool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length }, () => charPool[Math.floor(Math.random() * charPool.length)]).join("");
}

// ========== Filters ==========

type MrmFilterData = [name: string, value: string][];
interface FilterData {
  sorts: MrmFilterData | null;
  genres: MrmFilterData | null;
  categories: MrmFilterData | null;
  tags: MrmFilterData | null;
  artists: MrmFilterData | null;
  pairings: MrmFilterData | null;
  status: MrmFilterData | null;
}

interface UriFilter {
  addToUri(uri: HttpUrlBuilder): void;
}
const isUriFilter = (f: unknown): f is UriFilter => typeof (f as UriFilter).addToUri === "function";

const NOT_LOADED: MrmFilterData = [["Press 'Reset' to load filters", ""]];

class EnforceLanguageFilter extends Filter.CheckBox implements UriFilter {
  constructor(private readonly siteLang: string) {
    super("Enforce language", true);
  }
  addToUri(uri: HttpUrlBuilder) {
    if (this.state) uri.addQueryParameter("ep_filter_lang", this.siteLang);
  }
}

class MrmFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

class UriSelectFilter extends Filter.Group<MrmFilter> implements UriFilter {
  constructor(
    displayName: string,
    private readonly uriParam: string,
    vals: MrmFilterData,
  ) {
    super(
      displayName,
      vals.map(([n, v]) => new MrmFilter(n, v)),
    );
  }
  addToUri(uri: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state);
    if (!checked.length) return;
    uri.addQueryParameter(this.uriParam, checked.map((it) => it.value).join(","));
  }
}

class UriSelectOneFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    displayName: string,
    private readonly uriParam: string,
    private readonly vals: MrmFilterData,
    defaultValue = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      defaultValue,
    );
  }
  addToUri(uri: HttpUrlBuilder) {
    if (this.state !== 0) uri.addQueryParameter(this.uriParam, this.vals[this.state][1]);
  }
}

export default class MyReadingManga extends AnimeHttpSource {
  // ========== Basic Info ==========
  private get siteLang(): string {
    return LANGUAGE_LIST[this.lang]?.[0] ?? this.lang;
  }
  private get latestLang(): string {
    return LANGUAGE_LIST[this.lang]?.[1] ?? this.siteLang;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("User-Agent", "Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.159 Mobile Safari/537.36");
    h.append("X-Requested-With", randomString(1 + Math.floor(Math.random() * 20)));
    return h;
  }

  private get credentials() {
    return {
      username: (this.preferences.getString(USERNAME_PREF, "") ?? "").trim(),
      password: (this.preferences.getString(PASSWORD_PREF, "") ?? "").trim(),
    };
  }
  /** The credentials the last login succeeded with: a change in settings logs in again (upstream's newCredential()). */
  private loggedInAs: string | null = null;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addInterceptor((request) => {
        const headers = new Headers(request.headers);
        headers.delete("X-Requested-With");
        return { ...request, headers };
      })
      .addChainInterceptor(async (chain) => {
        // Login Interceptor
        const request = chain.request();
        const credentials = this.credentials;
        if (isBlank(credentials.username) || isBlank(credentials.password)) return chain.proceed(request);
        const key = `${credentials.username}\n${credentials.password}`;
        if (this.loggedInAs === key) return chain.proceed(request);
        try {
          const loginForm = new URLSearchParams({
            log: credentials.username,
            pwd: credentials.password,
            "wp-submit": "Log In",
            redirect_to: `${this.baseUrl}/`,
            testcookie: "1",
          });
          // upstream sends it with network.client, past this client's interceptors: chain.proceed does the same
          const loginResponse = await chain.proceed(POST(`${this.baseUrl}/wp-login.php`, this.headers, loginForm));
          // ponytail: upstream toasts "MyReadingManga login failed. Please check your credentials."; the host has no toasts
          if (loginResponse.isSuccessful) this.loggedInAs = key;
        } catch {
          // fall through, as upstream
        }
        return chain.proceed(request);
      });
  }

  get supportsLatest() {
    return true;
  }

  // Preference Screen
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const usernameSummary = (s: string) => (isBlank(s) ? "Enter your username" : s);
    const passwordSummary = (s: string) => (isBlank(s) ? "Enter your password" : "*".repeat(s.length));

    const username = new EditTextPreference(screen.context);
    username.key = USERNAME_PREF;
    username.title = "Username";
    username.dialogTitle = "Username";
    username.summary = usernameSummary(this.preferences.getString(USERNAME_PREF, "") ?? "");
    username.setDefaultValue("");
    screen.addPreference(username);

    const password = new EditTextPreference(screen.context);
    password.key = PASSWORD_PREF;
    password.title = "Password";
    password.dialogTitle = "Password";
    password.summary = passwordSummary(this.preferences.getString(PASSWORD_PREF, "") ?? "");
    password.setDefaultValue("");
    screen.addPreference(password);
  }

  // ========== Popular - Random ==========
  protected popularAnimeRequest(_page: number) {
    return GET(`${this.baseUrl}/popular/popular-videos`, this.headers);
  }

  protected popularAnimeParse(response: Response) {
    const animes = response
      .asJsoup()
      .select(".wpp-list li:has(img[src*=vlcsnap])")
      .map((element) => this.buildAnime(element.select(".wpp-post-title").first()!, element.select(".wpp-thumbnail").first()));
    return new MangasPage(animes, false);
  }

  // ========== Latest ==========
  protected latestUpdatesAnimeRequest(page: number) {
    const uri = toHttpUrl(this.baseUrl)
      .newBuilder()
      .addQueryParameter("ep_filter_lang", this.latestLang.toLowerCase())
      .addQueryParameter("ep_filter_category", "video")
      .addQueryParameter("s", "");
    if (page > 1) uri.addQueryParameter("paged", String(page));
    return GET(uri.build(), this.headers);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    return this.searchAnimeParse(response);
  }

  // ========== Search ==========
  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const filterList = filters.length ? filters : this.getFilterList();
    const uri = toHttpUrl(`${this.baseUrl}/page/${page}/`).newBuilder().addQueryParameter("ep_filter_category", "video").addQueryParameter("s", query);
    for (const filter of filterList) if (isUriFilter(filter)) filter.addToUri(uri);
    return GET(uri.build(), this.headers);
  }

  protected searchAnimeParse(response: Response) {
    const document = response.asJsoup();
    const animes = document
      .select("article.category-video")
      .map((element) => this.buildAnime(element.select("a.entry-title-link").first()!, element.select("a.entry-image-link img").first()));
    return new MangasPage(animes, document.selectFirst("li.pagination-next") != null);
  }

  // ========== Building anime from element ==========
  private buildAnime(titleElement: Element, thumbnailElement: Element | null): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(titleElement.attr("href"));
    anime.title = cleanTitle(titleElement.text());
    const thumbnail = getThumbnail(thumbnailElement ? getImage(thumbnailElement) : null);
    if (thumbnail) anime.thumbnail_url = thumbnail;
    return anime;
  }

  // Anime Details
  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const needCover = anime.thumbnail_url ? !(await this.client.get(anime.thumbnail_url, this.headers, { ensureSuccess: false })).isSuccessful : true;
    const response = await this.executeSuccess(await this.animeDetailsRequest(anime));
    const details = await this.animeDetailsParseCover(response.asJsoup(), needCover);
    details.initialized = true;
    return details;
  }

  private async animeDetailsParseCover(document: Element, needCover = true): Promise<SAnime> {
    const anime = SAnime.create();
    anime.title = cleanTitle(document.select("h1").text());
    anime.author = document.select(".entry-terms a[href*=artist]").first()?.text();
    anime.artist = anime.author;
    anime.genre = document.select(".entry-header p a[href*=genre], [href*=tag], span.entry-categories a").eachText().join(", ");
    const basicDescription = document.select("h1").text();
    // too troublesome to achieve 100% accuracy assigning scanlator group during episodeListParse
    const group = document.select(".entry-terms:has(a[href*=group])").first();
    const scanlatedBy = group ? `Scanlated by: ${group.select("a[href*=group]").eachText().join(", ")}` : null;
    const extendedDescription = document.select(".entry-content p:not(p:containsOwn(|)):not(.chapter-class + p)").eachText().join("\n");
    anime.description = [basicDescription, scanlatedBy, extendedDescription].filter((it) => it != null).join("\n").trim();
    const status = document.select("a[href*=status]").first()?.text();
    anime.status =
      {
        Completed: SAnime.COMPLETED,
        Ongoing: SAnime.ONGOING,
        Licensed: SAnime.LICENSED,
        Dropped: SAnime.CANCELLED,
        Discontinued: SAnime.CANCELLED,
        Hiatus: SAnime.ON_HIATUS,
      }[status ?? ""] ?? SAnime.UNKNOWN;

    if (needCover) {
      const response = await this.client.get(`${this.baseUrl}/search/?search=${document.location()}`, this.headers);
      const img = response.asJsoup().selectFirst("div.wdm_results div.p_content img");
      const thumbnail = getThumbnail(img ? getImage(img) : null);
      if (thumbnail) anime.thumbnail_url = thumbnail;
    }
    return anime;
  }

  protected animeDetailsParse(): SAnime {
    throw new Error("Not used");
  }

  // ========== Building episodes from element ==========
  protected episodeListParse(response: Response): SEpisode[] {
    const document = response.asJsoup();
    const episodes: SEpisode[] = [];

    const date = dateFormat.tryParseDate(document.select(".entry-time").text());
    // create first episode since its on main anime page
    episodes.push(createEpisode("1", document.location(), date, "Ep. 1"));
    // see if there are multiple episodes or not
    const lastText = document.select("a[class=page-numbers]").last()?.text();
    const lastEpisodeNumber = lastText != null && /^[+-]?\d+$/.test(lastText) ? Number(lastText) : null;
    if (lastEpisodeNumber != null) {
      // There are entries with more episodes but those never show up,
      // so we take the last one and loop it to get all hidden ones.
      // Example: 1 2 3 4 .. 7 8 9 Next
      for (let i = 2; i <= lastEpisodeNumber; i++) episodes.push(createEpisode(String(i), document.location(), date, `Ep. ${i}`));
    }
    return episodes.reverse();
  }

  // ========== Building videos from element ==========
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  /** Not executeSuccess: videoListParse reports a 403 itself. */
  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    return this.videoListParse(await this.client.execute(GET(hoster.hosterUrl, this.headers)));
  }

  protected override videoListParse(response: Response): Video[] {
    if (!response.isSuccessful) {
      if (response.code === 403) throw new Error("Download the episode before watching (Error 403)");
      throw new Error(`Failed to fetch video list: HTTP ${response.code}`);
    }

    const videoUrl = response.asJsoup().selectFirst("div.video-container-ads video source")?.attr("src");
    if (videoUrl == null) throw new Error("No video URL found");
    if (!videoUrl) return [];

    // CookieManager.getCookie(videoUrl): the client's jar stands in for the WebView's
    const cookies = this.client.cookieJar
      .loadForRequest(videoUrl)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const customHeaders = this.headersBuilder();
    customHeaders.set("Cookie", cookies);

    return [new Video({ videoUrl, videoTitle: "Default", headers: customHeaders })];
  }

  /*
   * ========== Parse filters from pages ==========
   *
   * In a recent (2025) update, MRM updated their search interface. As such, there is no longer
   * pages listing every tags, every author, etc. (except for Langs and Genres). The search page
   * display the top 25 results for each filter category. Since these lists aren't exhaustive, we
   * call them "Popular"
   */
  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<FilterData> {
    // Grabs page containing filters
    const filterAssist = async (url: string) => {
      const it = await this.client.get(url, this.headers, { ensureSuccess: false });
      return it.isSuccessful ? it.text() : "";
    };
    const mainPage = await filterAssist(this.baseUrl);
    const searchPage = await filterAssist(`${this.baseUrl}/?s=`);

    // Parses main page for filters
    const getFiltersFromMainPage = (filterTitle: string): MrmFilterData | null => {
      if (mainPage === "") return null;
      const document = parseHtml(this.host.load, mainPage, this.baseUrl);
      const parent = document.select(".widget-title").find((it) => it.text() === filterTitle)?.parent();
      return parent?.select(".tag-cloud-link").map((it): [string, string] => [it.text(), it.attr("href").split("/").reverse()[1] ?? ""]) ?? null;
    };

    // Parses search page for filters
    const getFiltersFromSearchPage = (filterTitle: string, isSelectDropdown = false): MrmFilterData | null => {
      if (searchPage === "") return null;
      const document = parseHtml(this.host.load, searchPage, this.baseUrl);
      const parent = document.select(".ep-filter-title").find((it) => it.text() === filterTitle)?.parent();
      if (!parent) return null;
      return isSelectDropdown
        ? parent.select("option").map((it): [string, string] => [it.text(), it.attr("value")])
        : parent.select(".term").map((it): [string, string] => [it.text(), it.attr("data-term-slug")]);
    };

    return {
      sorts: getFiltersFromSearchPage("Sort by", true),
      genres: getFiltersFromMainPage("Genres"),
      categories: getFiltersFromSearchPage("Category"),
      tags: getFiltersFromSearchPage("Tag"),
      artists: getFiltersFromSearchPage("Circle/ artist"),
      pairings: getFiltersFromSearchPage("Pairing"),
      status: getFiltersFromSearchPage("Status"),
    };
  }

  // Generates the filter lists for app
  override getFilterList(data: unknown = null): FilterList {
    const d = (data as FilterData | null) ?? ({} as Partial<FilterData>);
    return [
      new EnforceLanguageFilter(this.siteLang),
      new UriSelectOneFilter("Sort by", "ep_sort", d.sorts ?? NOT_LOADED),
      new UriSelectFilter("Genre", "ep_filter_genre", d.genres ?? NOT_LOADED),
      new UriSelectFilter("Popular Categories", "ep_filter_category", d.categories ?? NOT_LOADED),
      new UriSelectFilter("Popular Tags", "ep_filter_post_tag", d.tags ?? NOT_LOADED),
      new UriSelectFilter("Popular Artists", "ep_filter_artist", d.artists ?? NOT_LOADED),
      new UriSelectFilter("Popular Pairings", "ep_filter_pairing", d.pairings ?? NOT_LOADED),
      new UriSelectFilter("Status", "ep_filter_status", d.status ?? NOT_LOADED),
    ];
  }
}

function getImage(element: Element): string | null {
  let url: string;
  if (EXTENSION_REGEX.test(element.attr("data-src"))) url = element.attr("abs:data-src");
  else if (EXTENSION_REGEX.test(element.attr("data-cfsrc"))) url = element.attr("abs:data-cfsrc");
  else if (EXTENSION_REGEX.test(element.attr("src"))) url = element.attr("abs:src");
  else url = element.attr("abs:data-lazy-src");
  return isValidUrl(url) ? url : null;
}

// removes resizing
function getThumbnail(thumbnailUrl: string | null): string | null {
  if (thumbnailUrl == null) return null;
  const url = `${substringBeforeLast(thumbnailUrl, "-")}.${substringAfterLast(thumbnailUrl, ".")}`;
  return isValidUrl(url) ? url : null;
}

function cleanTitle(title: string): string {
  let cleanedTitle = title;
  const i = cleanedTitle.indexOf(": ");
  if (i >= 0) cleanedTitle = cleanedTitle.slice(i + 2);
  cleanedTitle = cleanedTitle.trimStart();
  cleanedTitle = cleanedTitle.replace(TITLE_REGEX, " ").trim();
  if (cleanedTitle.endsWith(")") && cleanedTitle.lastIndexOf("(") !== -1) cleanedTitle = substringBeforeLast(cleanedTitle, "(").trimEnd();
  return cleanedTitle.replace(/\s+/g, " ").trim();
}

function createEpisode(pageNumber: string, animeUrl: string, date: number, epname: string): SEpisode {
  const episode = SEpisode.create();
  episode.url = urlWithoutDomain(`${animeUrl}/${pageNumber}`);
  episode.name = epname;
  episode.date_upload = date;
  return episode;
}
