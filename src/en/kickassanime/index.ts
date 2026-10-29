// Port of yuzono/anime-extensions src/en/kickassanime/KickAssAnime.kt (dto/KickAssAnimeDto.kt inline)
//
// Each server of an episode is a hoster (lib 16) instead of one videoListParse over all of them.
// Not ported: related anime (it reads a lenient-JSON JS object out of window.KAA).
import {
  AnimeHttpSource,
  Base64,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  POST,
  SAnime,
  SEpisode,
  SwitchPreferenceCompat,
  utf8,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { KickAssAnimeExtractor } from "./extractor.ts";
import { FILTER_LIST, getSearchParameters, type FilterSearchParams } from "./filters.ts";

interface PosterDto {
  hq: string;
}
interface PopularItemDto {
  title: string;
  title_en?: string | null;
  slug: string;
  poster: PosterDto;
}
interface AnimeInfoDto extends PopularItemDto {
  genres: string[];
  season?: string | null;
  status: string;
  synopsis?: string | null;
  year?: number | null;
}
interface EpisodeResponseDto {
  pages: unknown[];
  result?: { slug: string; title?: string | null; episode_string: string }[];
}

const posterUrl = (p: PosterDto) => `image/poster/${p.hq}.webp`;

/**
 * Only the primary URL does the search, other domains are redirects to it.
 * Keep in sync with the default base URL in meta.json.
 */
const SEARCH_BASE_URL = "https://kaa.lt";
const PREFIX_SEARCH = "slug:";

const SERVERS = ["VidStreaming", "CatStream", "BirdStream", "DuckStream"];
const LOCALE: [string, string][] = [
  ["ja-JP", "Japanese"],
  ["en-US", "English"],
  ["es-ES", "Spanish (España)"],
  ["ko-KR", "Korean"],
  ["zh-CN", "Chinese (Simplified)"],
];

const PREF_USE_ENGLISH_KEY = "pref_use_english";
const PREF_USE_ENGLISH_DEFAULT = false;
const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_DEFAULT = "1080p";
const PREF_QUALITY_ENTRIES = ["240p", "360p", "480p", "720p", "1080p", "2160p"];
const PREF_AUDIO_LANG_KEY = "preferred_audio_lang";
const PREF_AUDIO_LANG_DEFAULT = LOCALE[0][0];
const PREF_AUDIO_LANG_KEY_2ND = "preferred_audio_lang_2nd";
const PREF_AUDIO_LANG_DEFAULT_2ND = LOCALE[1][0];
const PREF_SERVER_KEY = "preferred_server";
const PREF_SERVER_DEFAULT = SERVERS[0];
const PREF_HOSTER_EXCLUDE_KEY = "hoster_exclusion";

const getLocale = (s: string) => LOCALE.find((it) => it[0] === s)?.[1] ?? "";
const parseStatus = (s: string) => (s === "finished_airing" ? SAnime.COMPLETED : s === "currently_airing" ? SAnime.ONGOING : SAnime.UNKNOWN);

export default class KickAssAnime extends AnimeHttpSource {
  get supportsLatest() {
    return true;
  }

  private get apiUrl() {
    return `${this.baseUrl}/api/show`;
  }

  private get useEnglish() {
    return this.preferences.getBoolean(PREF_USE_ENGLISH_KEY, PREF_USE_ENGLISH_DEFAULT);
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.apiUrl}/trending?page=${page}`, this.headers);
  }

  protected popularAnimeParse(response: Response) {
    const data = response.parseAs<{
      page_count: number;
      result: PopularItemDto[];
    }>();
    const page = Number(new URL(response.url).searchParams.get("page")) || 0;
    return new MangasPage(
      data.result.map((it) => this.popularAnimeFromObject(it)),
      data.page_count > page,
    );
  }

  private popularAnimeFromObject(anime: PopularItemDto): SAnime {
    const s = SAnime.create();
    s.title = (anime.title_en?.trim() && this.useEnglish ? anime.title_en : anime.title)!;
    s.url = `/${anime.slug}`;
    s.thumbnail_url = `${this.baseUrl}/${posterUrl(anime.poster)}`;
    return s;
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.apiUrl}/recent?type=all&page=${page}`, this.headers);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    const data = response.parseAs<{
      hadNext: boolean;
      result: PopularItemDto[];
    }>();
    return new MangasPage(
      data.result.map((it) => this.popularAnimeFromObject(it)),
      data.hadNext,
    );
  }

  // ============================== Episodes ==============================
  private async getEpisodeResponse(anime: SAnime, page: number, lang: string): Promise<EpisodeResponseDto> {
    return (await this.client.get(`${this.apiUrl}${anime.url}/episodes?page=${page}&lang=${lang}`, this.headers)).parseAs();
  }

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    // Fetch what languages are available for this anime
    const languages = (await this.client.get(`${this.apiUrl}${anime.url}/language`, this.headers)).parseAs<{ result: string[] }>().result;

    const prefLang = this.preferences.getString(PREF_AUDIO_LANG_KEY, PREF_AUDIO_LANG_DEFAULT)!;
    const pref2ndLang = this.preferences.getString(PREF_AUDIO_LANG_KEY_2ND, PREF_AUDIO_LANG_DEFAULT_2ND)!;
    const rank = (l: string) => (l === prefLang ? 0 : l === pref2ndLang ? 1 : 2);
    const langOrder = [...languages].sort((a, b) => rank(a) - rank(b));

    // Try preferred language first, then others
    for (const lang of langOrder) {
      const firstPage = await this.getEpisodeResponse(anime, 1, lang).catch(() => null);
      if (!firstPage?.result?.length) continue;

      const size = Math.max(firstPage.pages.length - 1, 0);
      const otherPages = await Promise.allSettled(Array.from({ length: size }, (_, idx) => this.getEpisodeResponse(anime, idx + 2, lang)));
      const otherPagesResults = otherPages.flatMap((it) => (it.status === "fulfilled" ? (it.value.result ?? []) : []));

      // Already have episodes, no need to try other lang
      return [...firstPage.result, ...otherPagesResults]
        .map((it) => {
          const ep = SEpisode.create();
          ep.name = `Ep. ${it.episode_string}` + (it.title?.trim() ? ` - ${it.title}` : "");
          ep.url = `${anime.url}/ep-${it.episode_string}-${it.slug}`;
          const n = Number(it.episode_string);
          if (it.episode_string.trim() && !Number.isNaN(n)) ep.episode_number = n;
          ep.scanlator = getLocale(lang);
          return ep;
        })
        .reverse();
    }
    return [];
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Unsupported");
  }

  // ============================ Video Links =============================
  private _extractor?: KickAssAnimeExtractor;
  private get kickAssAnimeExtractor() {
    return (this._extractor ??= new KickAssAnimeExtractor(this.client, this.headers));
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const url = this.apiUrl + episode.url.replace("/ep-", "/episode/ep-");
    const videos = (await this.client.get(url, this.headers)).parseAs<{
      servers: { name: string; src: string }[];
    }>();
    const hosterExclusion = this.preferences.getStringSet(PREF_HOSTER_EXCLUDE_KEY, []);
    return videos.servers.filter((it) => !hosterExclusion.includes(it.name)).map((it) => new Hoster(it.src, it.name));
  }

  override getVideoList(hoster: Hoster): Promise<Video[]> {
    return this.kickAssAnimeExtractor.videosFromUrl(hoster.hosterUrl, hoster.hosterName);
  }

  override getEpisodeUrl(episode: SEpisode): string {
    return this.baseUrl + episode.url;
  }

  // =========================== Anime Details ============================
  override getMangaUrl(anime: SAnime): string {
    return this.baseUrl + anime.url;
  }

  override animeDetailsRequest(anime: SAnime) {
    return GET(this.apiUrl + anime.url, this.headers);
  }

  protected async animeDetailsParse(response: Response): Promise<SAnime> {
    const anime = response.parseAs<AnimeInfoDto>();
    const languages = (await this.client.get(`${response.url}/language`, this.headers)).parseAs<{ result: string[] }>();
    const s = SAnime.create();
    s.title = (anime.title_en?.trim() && this.useEnglish ? anime.title_en : anime.title)!;
    s.url = `/${anime.slug}`;
    s.thumbnail_url = `${this.baseUrl}/${posterUrl(anime.poster)}`;
    s.genre = anime.genres.join(", ");
    s.status = parseStatus(anime.status);
    let description = "";
    if (anime.synopsis != null) description += anime.synopsis + "\n\n";
    description += `Available Dub Languages: ${languages.result.map(getLocale).join(", ")}\n`;
    // Append season if it exists, saw errors in i.e. Black Cat without fix.
    if (anime.season != null) description += `Season: ${anime.season.charAt(0).toUpperCase()}${anime.season.slice(1)}\n`;
    if (anime.year != null) description += `Year: ${anime.year}`;
    s.description = description;
    return s;
  }

  // =============================== Search ===============================
  protected searchAnimeRequest(): never {
    throw new Error("Unsupported");
  }

  protected async searchAnimeParse(response: Response, page = 1): Promise<MangasPage> {
    const path = new URL(response.url).pathname;
    if (path.endsWith("api/fsearch") || path.endsWith("/anime")) {
      const data = response.parseAs<{
        result: PopularItemDto[];
        maxPage: number;
      }>();
      return new MangasPage(
        data.result.map((it) => this.popularAnimeFromObject(it)),
        page < data.maxPage,
      );
    }
    if (path.endsWith("/recent")) return this.latestUpdatesAnimeParse(response);
    return this.popularAnimeParse(response);
  }

  private searchRequest(page: number, query: string, filters: FilterSearchParams) {
    const newHeaders = new Headers(this.headers);
    newHeaders.set("Accept", "application/json, text/plain, */*");
    newHeaders.set("Content-Type", "application/json");
    // ponytail: upstream also sets Host; fetch forbids it and sends the right one anyway
    newHeaders.set("Referer", `${SEARCH_BASE_URL}/search?q=${query}`);

    if (filters.subPage.trim()) return GET(`${SEARCH_BASE_URL}/api/${filters.subPage}?page=${page}`, newHeaders);

    const encodedFilters = filters.filters === "{}" ? "" : Base64.encode(utf8(filters.filters));

    if (!query.trim()) {
      let url = `${SEARCH_BASE_URL}/api/anime?page=${page}`;
      if (encodedFilters) url += `&filters=${encodedFilters}`;
      return GET(url, newHeaders);
    }
    const data: Record<string, unknown> = { page, query };
    if (encodedFilters) data.filters = encodedFilters;
    return POST(`${SEARCH_BASE_URL}/api/fsearch`, newHeaders, JSON.stringify(data), "application/json");
  }

  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      if (url.host !== new URL(SEARCH_BASE_URL).host) throw new Error("Unsupported url");
      const slug = url.pathname.split("/").filter(Boolean)[0];
      if (!slug) throw new Error("Unsupported url");
      return this.getSearchAnime(page, `${PREFIX_SEARCH}${slug}`, filters);
    }
    if (query.startsWith(PREFIX_SEARCH)) {
      const slug = query.slice(PREFIX_SEARCH.length);
      const details = await this.animeDetailsParse(await this.client.get(`${SEARCH_BASE_URL}/api/show/${slug}`, this.headers));
      // upstream then sets the url to the api request's path, which no other method expects; the show path is kept
      details.initialized = true;
      return new MangasPage([details], false);
    }
    const params = getSearchParameters(filters);
    return this.searchAnimeParse(await this.executeSuccess(this.searchRequest(page, query, params)), page);
  }

  // ============================== Filters ===============================
  override getFilterList(): FilterList {
    return FILTER_LIST();
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    const server = this.preferences.getString(PREF_SERVER_KEY, PREF_SERVER_DEFAULT)!;
    const res = (v: Video) => Number(/(\d+)p/.exec(v.videoTitle)?.[1] ?? 0) || 0;
    const speed = (v: Video) => Number(/([\d,]+) [KMGTPE]B\/s/.exec(v.videoTitle)?.[1]?.replace(",", ".") ?? 0) || 0;
    return [...videos].sort(
      (a, b) =>
        Number(b.videoTitle.toLowerCase().includes(server.toLowerCase())) - Number(a.videoTitle.toLowerCase().includes(server.toLowerCase())) ||
        Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)) ||
        res(b) - res(a) ||
        speed(b) - speed(a),
    );
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const english = new SwitchPreferenceCompat(screen.context);
    english.key = PREF_USE_ENGLISH_KEY;
    english.title = "Use English titles";
    english.summary = "Show Titles in English instead of Romanji when possible.";
    english.setDefaultValue(PREF_USE_ENGLISH_DEFAULT);
    screen.addPreference(english);

    const list = (key: string, title: string, entries: string[], values: string[], def: string) => {
      const p = new ListPreference(screen.context);
      p.key = key;
      p.title = title;
      p.entries = entries;
      p.entryValues = values;
      p.setDefaultValue(def);
      p.summary = "%s";
      screen.addPreference(p);
    };
    const langNames = LOCALE.map((it) => it[1]);
    const langValues = LOCALE.map((it) => it[0]);
    list(PREF_AUDIO_LANG_KEY, "Preferred audio language", langNames, langValues, PREF_AUDIO_LANG_DEFAULT);
    list(PREF_AUDIO_LANG_KEY_2ND, "Secondary preferred audio language", langNames, langValues, PREF_AUDIO_LANG_DEFAULT_2ND);
    list(PREF_QUALITY_KEY, "Preferred quality", PREF_QUALITY_ENTRIES, PREF_QUALITY_ENTRIES, PREF_QUALITY_DEFAULT);
    list(PREF_SERVER_KEY, "Preferred server", SERVERS, SERVERS, PREF_SERVER_DEFAULT);

    const exclude = new MultiSelectListPreference(screen.context);
    exclude.key = PREF_HOSTER_EXCLUDE_KEY;
    exclude.title = "Excluded Hosts";
    exclude.entries = SERVERS;
    exclude.entryValues = SERVERS;
    exclude.setDefaultValue([]);
    exclude.summary = "Choose which hosts you want to exclude";
    screen.addPreference(exclude);
  }
}
