// Port of yuzono/anime-extensions src/all/newgrounds/NewGrounds.kt (and NewGroundsFilters.kt, DateUtils.kt)
import {
  AnimeHttpSource,
  CheckBoxPreference,
  DateTimeFormatter,
  Filter,
  firstInstanceOrNull,
  GET,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  MultiSelectListPreference,
  POST,
  SAnime,
  SEpisode,
  toHttpUrl,
  urlWithoutDomain,
  Video,
  type Document,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import {
  AfterDateFilter,
  AuthorFilter,
  BeforeDateFilter,
  DateFilterGroup,
  FrontpagedFilter,
  GENRE,
  GenreFilter,
  LengthFilterGroup,
  MATCH_AGAINST,
  MatchAgainstFilter,
  MaxLengthFilter,
  MinLengthFilter,
  SORTING,
  SortingFilter,
  TagsFilter,
  TuningAnyFilter,
  TuningExactFilter,
  TuningFilterGroup,
} from "./filters.ts";

const PAGE_SIZE = 20;

/*
  According to the labels on the website:
  Featured    -> /movies/featured
  Latest      -> /movies/browse
  Popular     -> /movies/popular
  Your Feed   -> /social/feeds/show/favorite-artists-movies
  Under Judgement -> /movies/browse?interval=all&artist-type=unjudged
*/
const PREF_SECTIONS: Record<string, string> = {
  Featured: "movies/featured",
  Latest: "movies/browse",
  Popular: "movies/popular",
  "Your Feed": "social/feeds/show/favorite-artists-movies",
};

const dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.ENGLISH);

/** Executes `action` if the filter is set to a meaningful value. */
function ifFilterSet<T extends Filter>(filter: T | null | undefined, action: (f: T) => void) {
  const state = filter?.state;
  if (filter != null && state != null && state !== "" && state !== 0 && state !== false) action(filter);
}

export default class NewGrounds extends AnimeHttpSource {
  get supportsLatest() {
    return true;
  }

  private get videoListHeaders() {
    const h = new Headers(this.headers);
    h.append("Accept", "application/json, text/javascript, */*; q=0.01");
    h.append("X-Requested-With", "XMLHttpRequest");
    h.append("Referer", this.baseUrl);
    return h;
  }

  // Latest

  private getLatestSection(): string {
    return this.preferences.getString("LATEST", PREF_SECTIONS.Latest)!;
  }

  protected latestUpdatesAnimeRequest(page: number) {
    const offset = (page - 1) * PAGE_SIZE;
    return GET(`${this.baseUrl}/${this.getLatestSection()}?offset=${offset}`, this.headers);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    this.checkAdultContentFiltered(response);
    const section = this.getLatestSection();
    return this.parsePage(response, animeSelector(section), (e) => animeFromElement(e, section), "#load-more-items a");
  }

  // Browse

  private getPopularSection(): string {
    return this.preferences.getString("POPULAR", PREF_SECTIONS.Popular)!;
  }

  protected popularAnimeRequest(page: number) {
    const offset = (page - 1) * PAGE_SIZE;
    return GET(`${this.baseUrl}/${this.getPopularSection()}?offset=${offset}`, this.headers);
  }

  protected popularAnimeParse(response: Response) {
    this.checkAdultContentFiltered(response);
    const section = this.getPopularSection();
    return this.parsePage(response, animeSelector(section), (e) => animeFromElement(e, section), "#load-more-items a");
  }

  // Search

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const searchUrl = toHttpUrl(`${this.baseUrl}/search/conduct/movies`).newBuilder().addQueryParameter("page", String(page));

    if (query) searchUrl.addQueryParameter("terms", query);

    const tuning = firstInstanceOrNull(filters, TuningFilterGroup)?.state;
    const length = firstInstanceOrNull(filters, LengthFilterGroup)?.state;
    const date = firstInstanceOrNull(filters, DateFilterGroup)?.state;

    ifFilterSet(firstInstanceOrNull(filters, MatchAgainstFilter), (it) => searchUrl.addQueryParameter("match", Object.values(MATCH_AGAINST)[it.state]));
    ifFilterSet(tuning && firstInstanceOrNull(tuning, TuningExactFilter), () => searchUrl.addQueryParameter("exact", "1"));
    ifFilterSet(tuning && firstInstanceOrNull(tuning, TuningAnyFilter), () => searchUrl.addQueryParameter("any", "1"));
    ifFilterSet(firstInstanceOrNull(filters, AuthorFilter), (it) => searchUrl.addQueryParameter("user", it.state));
    ifFilterSet(firstInstanceOrNull(filters, GenreFilter), (it) => searchUrl.addQueryParameter("genre", Object.values(GENRE)[it.state]));
    ifFilterSet(length && firstInstanceOrNull(length, MinLengthFilter), (it) => searchUrl.addQueryParameter("min_length", it.state));
    ifFilterSet(length && firstInstanceOrNull(length, MaxLengthFilter), (it) => searchUrl.addQueryParameter("max_length", it.state));
    ifFilterSet(firstInstanceOrNull(filters, FrontpagedFilter), () => searchUrl.addQueryParameter("frontpaged", "1"));
    ifFilterSet(date && firstInstanceOrNull(date, AfterDateFilter), (it) => searchUrl.addQueryParameter("after", it.state));
    ifFilterSet(date && firstInstanceOrNull(date, BeforeDateFilter), (it) => searchUrl.addQueryParameter("before", it.state));
    ifFilterSet(firstInstanceOrNull(filters, SortingFilter), (it) => {
      if (it.state != null && it.state.index !== 0) {
        const sortOption = Object.values(SORTING)[it.state.index];
        const direction = it.state.ascending ? "asc" : "desc";
        searchUrl.addQueryParameter("sort", `${sortOption}-${direction}`);
      }
    });
    ifFilterSet(firstInstanceOrNull(filters, TagsFilter), (it) => searchUrl.addQueryParameter("tags", it.state));

    return GET(searchUrl.build(), this.headers);
  }

  protected searchAnimeParse(response: Response) {
    this.checkAdultContentFiltered(response);
    return this.parsePage(response, "ul.itemlist li:not(#results-load-more) a", animeFromListElement, "#results-load-more");
  }

  private parsePage(response: Response, selector: string, fromElement: (e: Element) => SAnime, nextPageSelector: string) {
    const document = response.asJsoup();
    return new MangasPage(document.select(selector).map(fromElement), document.selectFirst(nextPageSelector) != null);
  }

  // Etc.

  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const getStarRating = () => {
      const score = Number(document.selectFirst("#score_number")?.text() ?? 0) || 0;
      const fullStars = Math.trunc(score);
      const hasHalfStar = score % 1 >= 0.5;
      const totalStars = hasHalfStar ? fullStars + 1 : fullStars;
      const emptyStars = Math.max(5 - totalStars, 0);
      return "✪".repeat(fullStars) + (hasHalfStar ? "✪" : "") + "⬤".repeat(emptyStars) + ` (${score})`;
    };

    const getAdultRating = () => {
      const className = document.selectFirst("#embed_header h2")!.className();
      const rating = className.includes("rated-") ? className.slice(className.indexOf("rated-") + 6) : className;
      return { e: "🟩 Everyone", t: "🟦 Ages 13+", m: "🟪 Ages 17+", a: "🟥 Adults Only" }[rating] ?? "❓";
    };

    const getStats = () => {
      const statsElement = document.selectFirst("#sidestats > dl:first-of-type");
      const views = statsElement?.selectFirst("dd:first-of-type")?.text() ?? "?";
      const faves = statsElement?.selectFirst("dd:nth-of-type(2)")?.text() ?? "?";
      const votes = statsElement?.selectFirst("dd:nth-of-type(3)")?.text() ?? "?";
      return `👀 ${views}  |  ❤️ ${faves}  |  🗳️ ${votes}`;
    };

    const prepareDescription = () => {
      const descriptionElements = this.preferences.getStringSet("DESCRIPTION_ELEMENTS", ["short"]);
      const shortDescription = document.selectFirst('meta[itemprop="description"]')?.attr("content");
      const longDescription = document.selectFirst("#author_comments")?.wholeText();
      const statsSummary = `${getAdultRating()}  |  ${getStarRating()}  |  ${getStats()}`;
      let description = "";
      if (descriptionElements.includes("short")) description += shortDescription;
      if (descriptionElements.includes("long")) description += "\n\n" + longDescription;
      if (descriptionElements.includes("stats") || this.preferences.getBoolean("STATS_SUMMARY", false)) description += "\n\n" + statsSummary;
      return description;
    };

    const relatedPlaylistElement = document.selectFirst('div[id^="related_playlists"] ');
    const relatedPlaylistUrl = relatedPlaylistElement?.selectFirst('a:not([id^="related_playlists"])')?.absUrl("href");
    const relatedPlaylistName = relatedPlaylistElement?.selectFirst(".detail-title h4")?.text();
    const isPartOfSeries = relatedPlaylistUrl?.startsWith(`${this.baseUrl}/series`) ?? false;

    const anime = SAnime.create();
    anime.title = (isPartOfSeries ? relatedPlaylistName : undefined) ?? document.selectFirst('h2[itemprop="name"]')!.text();
    anime.description = prepareDescription();
    anime.author = document.selectFirst(".authorlinks > div:first-of-type .item-details-main")?.text();
    anime.artist = document.select(".authorlinks > div:not(:first-of-type) .item-details-main").eachText().join(", ");
    anime.thumbnail_url = document.selectFirst('meta[itemprop="thumbnailUrl"]')?.absUrl("content");
    anime.genre = document.select(".tags li a").eachText().join(", ") + (document.selectFirst('div[id^="genre-view"] dt')?.text() ?? ""); 
    anime.status = isPartOfSeries ? SAnime.ONGOING : SAnime.COMPLETED;
    return anime;
  }

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const document = (await this.client.get(`${this.baseUrl}${anime.url}`, this.headers)).asJsoup();

    const relatedPlaylistUrl = document.selectFirst('div[id^="related_playlists"] a:not([id^="related_playlists"])')?.absUrl("href");
    const isPartOfSeries = relatedPlaylistUrl?.startsWith(`${this.baseUrl}/series`) ?? false;

    if (isPartOfSeries) {
      const document2 = (await this.client.get(relatedPlaylistUrl!, this.headers)).asJsoup();
      return this.parseEpisodeList(document2);
    }
    const dateString = document.selectFirst("#sidestats  > dl:nth-of-type(2) > dd:first-of-type")?.text();
    const episode = SEpisode.create();
    episode.episode_number = 1;
    episode.date_upload = dateFormat.tryParseDate(dateString);
    episode.name = document.selectFirst('meta[name="title"]')!.attr("content");
    episode.url = urlWithoutDomain(`${this.baseUrl}${anime.url.replace("/view/", "/video/")}`);
    return [episode];
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Not used");
  }

  private async parseEpisodeList(document: Document): Promise<SEpisode[]> {
    const ids = document.select("li.visual-link-container").map((it) => it.attr("data-visual-link"));
    const formBody = new URLSearchParams({
      ids: `[${ids.join(", ")}]`, // Kotlin's List.toString()
      "component_params[include_author]": "1",
      include_all_suitabilities: "0",
      isAjaxRequest: "1",
    });
    const response = await this.client.execute(POST(`${this.baseUrl}/visual-links-fetch`, this.headers, formBody));

    type EpisodeData = { id: string | number; title: string; user: { user_name: string } };
    const simples = (response.parseAs<{ simples: Record<string, Record<string, EpisodeData>> }>()).simples;
    // ponytail: JS orders integer-like object keys ascending where org.json keeps the response order; the ids
    // are the playlist's own, so their order is used when every key is one of them.
    const order = (keys: string[]) => (keys.every((k) => ids.includes(k)) ? [...keys].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)) : keys);
    const episodes: SEpisode[] = [];
    let index = 1;
    for (const key of Object.keys(simples)) {
      const subObject = simples[key];
      for (const episodeKey of order(Object.keys(subObject))) {
        const episodeData = subObject[episodeKey];
        const episode = SEpisode.create();
        episode.episode_number = index;
        episode.name = episodeData.title;
        episode.scanlator = episodeData.user.user_name;
        episode.url = `/portal/video/${episodeData.id}`;
        episodes.push(episode);
        index++;
      }
    }
    return episodes.reverse();
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(`${this.baseUrl}${episode.url}`, this.name)];
  }

  protected override videoListRequest(hoster: Hoster) {
    return GET(hoster.hosterUrl, this.videoListHeaders);
  }

  protected override videoListParse(response: Response): Video[] {
    const sources = response.parseAs<{ sources: Record<string, { src: string }[]> }>().sources;
    const videos: Video[] = [];
    for (const quality of Object.keys(sources)) {
      for (const videoObject of sources[quality]) {
        videos.push(new Video({ videoUrl: videoObject.src, videoTitle: quality, headers: this.headers }));
      }
    }
    return videos;
  }

  // ============================== Filters ===============================

  override getFilterList(): FilterList {
    return [
      new SortingFilter(),
      new MatchAgainstFilter(),
      new TuningFilterGroup(),
      new GenreFilter(),
      new AuthorFilter(),
      new TagsFilter(),
      new LengthFilterGroup(),
      new DateFilterGroup(),
      new FrontpagedFilter(),
      new Filter.Separator(),
      new Filter.Header("Age rating: to change age rating open WebView and in Movies tab click on 🟩🟦🟪🟥 icons on the right. Then refresh search."), // uses ng_user0 cookie
    ];
  }

  // ============================ Preferences =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const popular = new ListPreference(screen.context);
    popular.key = "POPULAR";
    popular.title = "Popular section content";
    popular.entries = Object.keys(PREF_SECTIONS);
    popular.entryValues = Object.values(PREF_SECTIONS);
    popular.setDefaultValue(PREF_SECTIONS.Popular);
    popular.summary = "%s";
    screen.addPreference(popular);

    const latest = new ListPreference(screen.context);
    latest.key = "LATEST";
    latest.title = "Latest section content";
    latest.entries = Object.keys(PREF_SECTIONS);
    latest.entryValues = Object.values(PREF_SECTIONS);
    latest.setDefaultValue(PREF_SECTIONS.Latest);
    latest.summary = "%s";
    screen.addPreference(latest);

    const description = new MultiSelectListPreference(screen.context);
    description.key = "DESCRIPTION_ELEMENTS";
    description.title = "Description elements";
    description.entries = ["Short description", "Long description (author comments)", "Stats (score, favs, views)"];
    description.entryValues = ["short", "long", "stats"];
    description.setDefaultValue(["short", "stats"]);
    description.summary = "Elements to be included in description";
    screen.addPreference(description);

    const prompt = new CheckBoxPreference(screen.context);
    prompt.key = "PROMPT_CONTENT_FILTERED";
    prompt.title = "Prompt to log in";
    prompt.setDefaultValue(true);
    prompt.summary = "Show toast when user is not logged in and therefore adult content is not accessible";
    screen.addPreference(prompt);
  }

  // ========================== Helper Functions ==========================

  /** Checks if cookie with username is present in response headers. */
  private checkAdultContentFiltered(_response: Response) {
    // ponytail: upstream shows a "Log in via WebView to include adult content" toast when NG_GG_username is not set;
    // the host has no toasts or WebView login, so adult content stays filtered and nothing is shown.
  }
}

/** Chooses an extraction technique for anime information, based on section selected in Preferences */
function animeFromElement(element: Element, section: string): SAnime {
  return section === PREF_SECTIONS["Your Feed"] ? animeFromFeedElement(element) : animeFromGridElement(element);
}

/** Extracts anime information from element of grid-like list typical for /popular, /browse or /featured */
function animeFromGridElement(element: Element): SAnime {
  const anime = SAnime.create();
  anime.title = element.selectFirst(".card-title h4")!.text();
  anime.author = element.selectFirst(".card-title span")?.text()?.replace("By ", "");
  anime.description = element.selectFirst("a")?.attr("title");
  anime.thumbnail_url = element.selectFirst("img")?.absUrl("src");
  anime.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
  return anime;
}

/** Extracts anime information from element of list returned in Your Feed */
function animeFromFeedElement(element: Element): SAnime {
  const anime = SAnime.create();
  anime.title = element.selectFirst(".detail-title h4")!.text();
  anime.author = element.selectFirst(".detail-title strong")?.text();
  anime.description = element.selectFirst(".detail-description")?.text();
  anime.thumbnail_url = element.selectFirst(".item-icon img")?.absUrl("src");
  anime.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
  return anime;
}

/** Extracts anime information from element of list typical for /search or /series */
function animeFromListElement(element: Element): SAnime {
  const anime = SAnime.create();
  anime.title = element.selectFirst(".detail-title > h4")!.text();
  anime.author = element.selectFirst(".detail-title > span > strong")?.text();
  anime.description = element.selectFirst(".detail-description")?.text();
  anime.thumbnail_url = element.selectFirst(".item-icon img")?.absUrl("src");
  anime.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
  return anime;
}

/** Returns CSS selector for anime, based on the section selected in Preferences */
function animeSelector(section: string): string {
  return section === PREF_SECTIONS["Your Feed"] ? "a.item-portalsubmission" : "a.inline-card-portalsubmission";
}
