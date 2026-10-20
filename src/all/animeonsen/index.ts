// Port of yuzono/anime-extensions src/all/animeonsen/AnimeOnsen.kt
import {
  AnimeHttpSource,
  firstInstanceOrNull,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  POST,
  SAnime,
  SEpisode,
  Track,
  Video,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { malData, type AnimeDetails, type AnimeListItem, type AnimeListResponse, type EpisodeDto, type MeilisearchResponse, type SearchResponse, type VideoData } from "./dto.ts";
import { GenreFilter, getFilterList } from "./filters.ts";
import { AO_USER_AGENT, AOAPIInterceptor, SearchInterceptor } from "./interceptors.ts";

const API_URL = "https://api.animeonsen.xyz/v4";
const SEARCH_URL = "https://search.animeonsen.xyz";

// Title and episode name preferences
const PREF_TITLE_KEY = "preferred_title";
const PREF_TITLE_TITLE = "Preferred Title Language";
const PREF_TITLE_DEFAULT = "romaji";
const PREF_TITLE_ENTRIES = ["Romaji", "English"];
const PREF_TITLE_VALUES = ["romaji", "english"];

// Subtitle preferences
const PREF_SUB_KEY = "preferred_subLang";
const PREF_SUB_TITLE = "Preferred sub language";
const PREF_SUB_DEFAULT = "en-US";
const PREF_SUB_ENTRIES = ["العربية", "Deutsch", "English", "Español (Spain)", "Español (Latin)", "Français", "Italiano", "Português (Brasil)", "Русский"];
const PREF_SUB_VALUES = ["ar-ME", "de-DE", "en-US", "es-ES", "es-LA", "fr-FR", "it-IT", "pt-BR", "ru-RU"];

export default class AnimeOnsen extends AnimeHttpSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(AOAPIInterceptor(API_URL)).addChainInterceptor(SearchInterceptor(this.baseUrl, SEARCH_URL));
  }

  // ponytail: a browser sends its own User-Agent and Sec-Fetch-*; the host decides which of these reach the API.
  override headersBuilder(): Headers {
    return new Headers({
      "User-Agent": AO_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
    });
  }

  private get preferredTitle() {
    return this.preferences.getString(PREF_TITLE_KEY, PREF_TITLE_DEFAULT) ?? PREF_TITLE_DEFAULT;
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${API_URL}/content/index?start=${(page - 1) * 30}&limit=30`, this.headers);
  }

  protected popularAnimeParse(response: Response): MangasPage {
    const responseJson = response.parseAs<AnimeListResponse>();
    return new MangasPage(
      responseJson.content.map((it) => this.toSAnime(it)),
      responseJson.cursor.next[0] === true,
    );
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(): never {
    throw new Error("Not used");
  }

  // =============================== Search ===============================
  override getFilterList(): FilterList {
    return getFilterList();
  }

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    if (query.trim()) {
      const headers = new Headers(this.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      return POST(`${SEARCH_URL}/indexes/content/search`, headers, JSON.stringify({ q: query }));
    }
    const genre = firstInstanceOrNull(filters, GenreFilter)?.getValue();
    if (genre?.trim()) return GET(`${API_URL}/content/index/genre/${genre}`, this.headers);
    return GET(`${API_URL}/content/index?start=${(page - 1) * 30}&limit=30`, this.headers);
  }

  protected searchAnimeParse(response: Response): MangasPage {
    const requestUrl = response.url;
    if (requestUrl.includes("indexes/content/search")) {
      return new MangasPage(
        response.parseAs<MeilisearchResponse>().hits.map((it) => this.toSAnime(it)),
        false,
      );
    }
    if (requestUrl.includes("/genre/")) {
      return new MangasPage(
        response.parseAs<SearchResponse>().result.map((it) => this.toSAnime(it)),
        false,
      );
    }
    return this.popularAnimeParse(response);
  }

  // =========================== Anime Details ============================
  override animeDetailsRequest(anime: SAnime) {
    return GET(`${API_URL}/content/${anime.url}/extensive`, this.headers);
  }

  override getMangaUrl(anime: SAnime) {
    return `${this.baseUrl}/details/${anime.url}`;
  }

  protected async animeDetailsParse(response: Response): Promise<SAnime> {
    const details = response.parseAs<AnimeDetails>();
    const mal = malData(details);
    const anime = SAnime.create();
    anime.url = details.content_id;
    anime.title = this.preferredTitle === "english" ? (details.content_title_en ?? details.content_title!) : (details.content_title ?? details.content_title_en!);
    anime.status = this.parseStatus(mal?.status);
    anime.author = mal?.studios?.map((it) => it.name).join(", ");
    anime.genre = mal?.genres?.map((it) => it.name).join(", ");
    anime.thumbnail_url = `${API_URL}/image/210x300/${details.content_id}`;

    let desc = "";
    const score = mal?.mean_score;
    if (score != null) {
      const starCount = Math.min(5, Math.max(0, Math.round(score / 2)));
      desc += `${"★".repeat(starCount)}${"☆".repeat(5 - starCount)} ${score}\n\n`;
    }
    // Main synopsis
    if (mal?.synopsis != null) desc += mal.synopsis;

    let subsList: string[] = [];
    try {
      const epsJson = (await this.client.execute(GET(`${API_URL}/content/${details.content_id}/episodes`, this.headers))).parseAs<Record<string, EpisodeDto>>();
      const firstEpNum = Object.keys(epsJson)[0];
      if (firstEpNum != null) {
        const videoData = (await this.client.execute(GET(`${API_URL}/content/${details.content_id}/video/${firstEpNum}`, this.headers))).parseAs<VideoData>();
        subsList = Object.values(videoData.metadata.subtitles);
      }
    } catch {
      subsList = [];
    }

    const extras: string[] = [];
    if (mal?.rating != null) extras.push(`**Rating:** ${mal.rating.replaceAll("_", " ").toUpperCase()}`);
    if (subsList.length) extras.push(`**Subtitles:** ${subsList.join(", ")}`);
    if (details.mal_id != null) extras.push(`[MAL](https://myanimelist.net/anime/${details.mal_id})`);
    if (extras.length) desc += `\n\n${extras.join("\n")}`;

    anime.description = desc.trimEnd();
    return anime;
  }

  // ============================== Episodes ==============================
  protected override episodeListRequest(anime: SAnime) {
    return GET(`${API_URL}/content/${anime.url}/episodes`, this.headers);
  }

  protected episodeListParse(response: Response): SEpisode[] {
    const path = response.url.replace(/\/$/, "");
    const before = path.slice(0, path.lastIndexOf("/episodes"));
    const contentId = before.slice(before.lastIndexOf("/") + 1);
    return Object.entries(response.parseAs<Record<string, EpisodeDto>>())
      .map(([epNum, item]) => {
        const episode = SEpisode.create();
        episode.url = `${contentId}/video/${epNum}`;
        const n = Number(epNum);
        episode.episode_number = epNum.trim() && Number.isFinite(n) ? n : -1;
        episode.name =
          this.preferredTitle === "english"
            ? `Episode ${epNum}: ${item.contentTitle_episode_en ?? item.contentTitle_episode_jp ?? ""}`
            : `Episode ${epNum}: ${item.contentTitle_episode_jp ?? item.contentTitle_episode_en ?? ""}`;
        return episode;
      })
      .sort((a, b) => b.episode_number - a.episode_number);
  }

  // ============================ Video Links =============================
  override getEpisodeUrl(episode: SEpisode) {
    return `${API_URL}/content/${episode.url}`;
  }

  /** videoListRequest(episode): the API's video endpoint is the only hoster. */
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  protected override videoListParse(response: Response): Video[] {
    const videoData = response.parseAs<VideoData>();
    const videoUrl = videoData.uri.stream;
    const subtitleLangs = videoData.metadata.subtitles;
    const subs = this.sortSubs(videoData.uri.subtitles).flatMap(([langPrefix, subUrl]) => {
      const language = subtitleLangs[langPrefix];
      return language == null ? [] : [new Track(subUrl, language)];
    });
    return [new Video({ videoUrl, videoTitle: "Default (720p)", headers: this.headers, subtitleTracks: subs })];
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const title = new ListPreference(screen.context);
    title.key = PREF_TITLE_KEY;
    title.title = PREF_TITLE_TITLE;
    title.entries = PREF_TITLE_ENTRIES;
    title.entryValues = PREF_TITLE_VALUES;
    title.setDefaultValue(PREF_TITLE_DEFAULT);
    title.summary = "%s";
    screen.addPreference(title);

    const sub = new ListPreference(screen.context);
    sub.key = PREF_SUB_KEY;
    sub.title = PREF_SUB_TITLE;
    sub.entries = PREF_SUB_ENTRIES;
    sub.entryValues = PREF_SUB_VALUES;
    sub.setDefaultValue(PREF_SUB_DEFAULT);
    sub.summary = "%s";
    screen.addPreference(sub);
  }

  // ============================= Utilities ==============================
  private parseStatus(statusString: string | null | undefined): number {
    return statusString?.trim() === "finished_airing" ? SAnime.COMPLETED : SAnime.ONGOING;
  }

  private toSAnime(item: AnimeListItem): SAnime {
    const anime = SAnime.create();
    anime.url = item.content_id;
    anime.title = this.preferredTitle === "english" ? (item.content_title_en ?? item.content_title ?? item.content_title_jp!) : (item.content_title ?? item.content_title_jp ?? item.content_title_en!);
    // Reference way: dynamically construct the thumbnail URL from the ID if not provided directly by search
    anime.thumbnail_url = item.thumbnail ?? item.content_image ?? `${API_URL}/image/210x300/${item.content_id}`;
    return anime;
  }

  private sortSubs(subs: Record<string, string>): [string, string][] {
    const sub = this.preferences.getString(PREF_SUB_KEY, PREF_SUB_DEFAULT) ?? PREF_SUB_DEFAULT;
    const has = (e: [string, string]) => (e[0].includes(sub) ? 1 : 0);
    return Object.entries(subs)
      .reverse()
      .sort((a, b) => has(b) - has(a));
  }
}
