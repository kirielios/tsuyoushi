// Port of yuzono/anime-extensions src/en/kisskh/KissKH.kt (Dto.kt inline)
//
// The kkey query parameters of the episode and subtitle APIs come from two Google Apps Script endpoints, as upstream
// (BuildConfig.KISSKH_API / KISSKH_SUB_API in the gradle plugin).
import {
  AnimeHttpSource,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  SAnime,
  SEpisode,
  SwitchPreferenceCompat,
  Track,
  Video,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import { SubDecryptor } from "./subdecryptor.ts";

interface DramaDto {
  id?: number | null;
  title?: string | null;
  thumbnail?: string | null;
}
interface DramaDetailDto {
  title?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  type?: string | null;
  episodesCount?: number | null;
  episodes?: { id?: number | null; number?: number | null }[];
}
interface EpisodeVideoDto {
  Video?: string | null;
  Type?: number | null;
}

const KISSKH_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
const KISSKH_SUB_API = "https://script.google.com/macros/s/AKfycbyq6hTj0ZhlinYC6xbggtgo166tp6XaDKBCGtnYk8uOfYBUFwwxBui0sGXiu_zIFmA/exec?id=";

const PAGE_SIZE = 40;
const TYPE_COUNTDOWN = 2;

const PREF_HIDE_UNAIRED_KEY = "pref_hide_unaired_episodes";
const PREF_HIDE_UNAIRED_DEFAULT = true;
const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];
const PREF_QUALITY_VALUES = ["1080", "720", "480", "360"];
const PREF_QUALITY_DEFAULT = "1080";

const COUNTDOWN_REGEX = /window\.countdown\("([^"]+)",\s*"[^"]*",\s*\d+,\s*"[^"]*",\s*"([^"]+)"/;
const QUALITY_REGEX = /(\d+)p?/;
const titleUriRegex = /[^a-zA-Z0-9]/g;

/** keiyoushi.utils.UrlUtils.fixUrl: protocol-relative URLs get https, anything not http(s) is null. */
function fixUrl(url: string): string | null {
  const t = url.trim();
  const u = t.startsWith("//") ? `https:${t}` : t;
  return /^https?:\/\/[^/]/i.test(u) ? u : null;
}

/** "yyyy-MM-dd'T'HH:mm:ss" read in time zone `tz`, as epoch ms; null when unparseable. */
function parseInZone(dateStr: string, tz: string): number | null {
  const asUtc = Date.parse(`${dateStr}Z`);
  if (Number.isNaN(asUtc)) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(asUtc)
        .map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - (wall - asUtc);
  } catch {
    return asUtc; // unknown zone: GMT, as java.util.TimeZone does
  }
}

class KissKHHoster extends Hoster {
  constructor(
    hosterUrl: string,
    hosterName: string,
    readonly internalData: string,
  ) {
    super(hosterUrl, hosterName);
  }
}

export default class KissKH extends AnimeHttpSource {
  get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(5).connectTimeout(30_000);
  }

  private get hideUnaired() {
    return this.preferences.getBoolean(PREF_HIDE_UNAIRED_KEY, PREF_HIDE_UNAIRED_DEFAULT);
  }

  // Built on each use, so a change of the mirror preference applies at once
  private get subDecryptor() {
    return new SubDecryptor(this.client, this.headers, this.baseUrl);
  }

  private get playlistUtils() {
    return new PlaylistUtils(this.client, this.headers);
  }

  // ponytail: unbounded maps instead of LruCache(100); they live as long as the source instance
  private readonly videoKeyCache = new Map<string, string>();
  private readonly subKeyCache = new Map<string, string>();

  // ============================== Popular / Latest ===============================

  protected popularAnimeRequest(page: number) {
    return GET(this.browseUrl(page, 1), this.headers);
  }
  protected popularAnimeParse(response: Response) {
    const dto = response.parseAs<{
      page?: number;
      totalCount?: number;
      data?: DramaDto[];
    }>();
    const page = Number(new URL(response.url).searchParams.get("page")) || 1;
    const data = dto.data ?? [];
    const hasNextPage = dto.totalCount != null ? page < dto.totalCount : data.length >= PAGE_SIZE;
    return new MangasPage(
      data.map((it) => this.toSAnime(it)).filter((it): it is SAnime => it != null),
      hasNextPage,
    );
  }
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(this.browseUrl(page, 2), this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  private browseUrl(page: number, order: number) {
    return `${this.baseUrl}/api/DramaList/List?page=${page}&type=0&sub=0&country=0&status=0&order=${order}&pageSize=${PAGE_SIZE}`;
  }

  // =============================== Search ===============================

  protected searchAnimeRequest(_page: number, query: string, _filters: FilterList) {
    const url = new URL(`${this.baseUrl}/api/DramaList/Search`);
    url.searchParams.set("q", query);
    url.searchParams.set("type", "0");
    return GET(url, this.headers);
  }
  protected searchAnimeParse(response: Response) {
    const list = response.parseAs<DramaDto[]>();
    return new MangasPage(
      list.map((it) => this.toSAnime(it)).filter((it): it is SAnime => it != null),
      false,
    );
  }

  private toSAnime(dto: DramaDto): SAnime | null {
    if (dto.title == null || dto.id == null) return null;
    const s = SAnime.create();
    s.title = dto.title;
    s.url = `/Drama/${dto.title.replace(titleUriRegex, "-")}?id=${dto.id}`;
    s.thumbnail_url = dto.thumbnail ?? undefined;
    return s;
  }

  // ============================== Details ===============================

  override getMangaUrl(anime: SAnime): string {
    return this.baseUrl + anime.url;
  }

  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const dto = await this.fetchDramaDetails(anime);
    const s = SAnime.create();
    if (dto.title != null) s.title = dto.title;
    s.status = parseStatus(dto.status);
    if (dto.description != null) s.description = dto.description;
    if (dto.thumbnail != null) s.thumbnail_url = dto.thumbnail;
    s.initialized = true;
    return s;
  }
  protected animeDetailsParse(): SAnime {
    throw new Error("Unsupported");
  }

  private async fetchDramaDetails(anime: SAnime): Promise<DramaDetailDto> {
    const id = new URL(this.getMangaUrl(anime)).searchParams.get("id");
    if (id == null) throw new Error("Missing drama ID");
    return (await this.client.get(`${this.baseUrl}/api/DramaList/Drama/${id}?isq=false`, this.headers)).parseAs();
  }

  // ============================== Episodes ==============================

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const dto = await this.fetchDramaDetails(anime);
    const type = dto.type;
    const episodesCount = dto.episodesCount ?? 1;
    const status = (dto.status ?? "").toLowerCase();
    const isAiringOrUpcoming = status.includes("ongoing") || status.includes("upcoming");
    const all = dto.episodes ?? [];
    const episodes = this.hideUnaired && isAiringOrUpcoming ? await this.filterUnairedEpisodes(all) : all;

    return episodes.flatMap((ep) => {
      if (ep.id == null) return [];
      const number = ep.number != null ? String(ep.number) : "1"; // JS prints 1.0 as "1", which is removeSuffix(".0")
      const e = SEpisode.create();
      e.url = String(ep.id);
      if (ep.number != null) e.episode_number = ep.number;
      if (!type?.trim()) e.name = `Video ${number}`;
      else if ((type.includes("Hollywood") && episodesCount === 1) || type.includes("Movie")) e.name = "Movie";
      else e.name = `Episode ${number}`;
      return [e];
    });
  }
  protected episodeListParse(): SEpisode[] {
    throw new Error("Unsupported");
  }

  private async filterUnairedEpisodes(episodes: NonNullable<DramaDetailDto["episodes"]>) {
    let firstAiredIndex = 0;
    for (const [index, ep] of episodes.entries()) {
      if (ep.id == null) break;
      let isUnaired: boolean;
      try {
        const v = await this.fetchEpisodeVideo(String(ep.id));
        isUnaired = isCountdownWidget(v.Video, v.Type);
      } catch {
        break;
      }
      if (isUnaired) firstAiredIndex = index + 1;
      else break;
    }
    return episodes.slice(firstAiredIndex);
  }

  private async fetchEpisodeVideo(id: string): Promise<EpisodeVideoDto> {
    const kkey = await this.requestVideoKey(id);
    return (await this.client.get(`${this.baseUrl}/api/DramaList/Episode/${id}.png?err=false&ts=&time=&kkey=${kkey}`, this.headers)).parseAs();
  }

  // =========================== Hosters & Videos ==========================

  override getEpisodeUrl(episode: SEpisode): string {
    return `${this.baseUrl}/api/DramaList/Episode/${episode.url}`;
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const id = episode.url;
    const videoDto = await this.fetchEpisodeVideo(id);

    if (isCountdownWidget(videoDto.Video, videoDto.Type)) {
      const countdown = await this.getCountdownDetails(videoDto.Video);
      throw new Error(countdown != null ? `This episode has not aired yet (${countdown})` : "This episode has not aired yet (countdown timer active)");
    }

    const videoUrl = videoDto.Video?.trim() ? videoDto.Video : null;
    if (videoUrl == null) return [];
    return [new KissKHHoster(videoUrl, "KissKH", id)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const id = (hoster as KissKHHoster).internalData;
    const videoUrl = hoster.hosterUrl.trim() ? hoster.hosterUrl : null;
    if (videoUrl == null) return [];

    let subList: Track[] = [];
    try {
      const subKey = await this.requestSubKey(id);
      const items = (await this.client.get(`${this.baseUrl}/api/Sub/${id}?kkey=${subKey}`, this.headers)).parseAs<
        { src?: string | null; label?: string | null }[]
      >();
      const settled = await Promise.allSettled(
        items.map(async (item) => {
          const suburl = item.src?.trim() ? item.src : null;
          if (suburl == null) return null;
          const lang = item.label?.trim() ? item.label : "Unknown";
          return suburl.includes(".txt") ? this.subDecryptor.getSubtitles(suburl, lang) : new Track(suburl, lang);
        }),
      );
      subList = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
    } catch {
      // Failed to fetch subtitles
    }

    const fixedVideoUrl = fixUrl(videoUrl);
    if (fixedVideoUrl == null) return [];
    const videoHeaders = new Headers(this.headers);
    videoHeaders.set("Referer", `${this.baseUrl}/`);
    videoHeaders.set("Origin", this.baseUrl);
    // ponytail: upstream's mpvArgs (sub-ass-override=strip) have no equivalent in the host player
    const video = new Video({
      videoUrl: fixedVideoUrl,
      videoTitle: "FirstParty",
      subtitleTracks: subList,
      headers: videoHeaders,
    });

    if (!new URL(fixedVideoUrl).pathname.toLowerCase().endsWith(".m3u8")) return [video];

    try {
      const videos = await this.playlistUtils.extractFromHls(fixedVideoUrl, {
        referer: `${this.baseUrl}/`,
        masterHeaders: videoHeaders,
        videoHeaders,
        videoNameGen: (q) => `FirstParty - ${q}`,
        subtitleList: subList,
      });
      return videos.length ? videos : [video];
    } catch {
      return [video];
    }
  }

  override sortVideos(videos: Video[]): Video[] {
    const preferredQuality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    const q = (v: Video) => Number(QUALITY_REGEX.exec(v.videoTitle)?.[1] ?? 0) || 0;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(preferredQuality)) - Number(a.videoTitle.includes(preferredQuality)) || q(b) - q(a));
  }

  private async requestVideoKey(id: string): Promise<string> {
    const cached = this.videoKeyCache.get(id);
    if (cached) return cached;
    const key = (await this.client.get(`${KISSKH_API}${id}&version=2.8.10`, this.headers)).parseAs<{ key: string }>().key;
    this.videoKeyCache.set(id, key);
    return key;
  }

  private async requestSubKey(id: string): Promise<string> {
    const cached = this.subKeyCache.get(id);
    if (cached) return cached;
    const key = (await this.client.get(`${KISSKH_SUB_API}${id}&version=2.8.10`, this.headers)).parseAs<{ key: string }>().key;
    this.subKeyCache.set(id, key);
    return key;
  }

  private async getCountdownDetails(url: string | null | undefined): Promise<string | null> {
    try {
      const widgetUrl = url ? fixUrl(url) : null;
      if (widgetUrl == null) return null;
      const html = (await this.client.get(widgetUrl, this.headers)).text();
      const match = COUNTDOWN_REGEX.exec(html);
      if (match == null) return null;
      const target = parseInZone(match[1], match[2]);
      if (target == null || target <= 0) return null;
      const diff = target - Date.now();
      if (diff <= 0) return "airs soon";
      const days = Math.floor(diff / 86_400_000);
      const hours = Math.floor(diff / 3_600_000) % 24;
      const minutes = Math.floor(diff / 60_000) % 60;
      let s = "airs in ";
      if (days > 0) s += `${days}d `;
      if (hours > 0 || days > 0) s += `${hours}h `;
      return (s + `${minutes}m`).trim();
    } catch {
      return null;
    }
  }

  // ============================= Preferences =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const hide = new SwitchPreferenceCompat(screen.context);
    hide.key = PREF_HIDE_UNAIRED_KEY;
    hide.title = "Hide unaired episodes";
    hide.summary = "Hide upcoming episodes that only have a countdown timer";
    hide.setDefaultValue(PREF_HIDE_UNAIRED_DEFAULT);
    screen.addPreference(hide);

    const quality = new ListPreference(screen.context);
    quality.key = PREF_QUALITY_KEY;
    quality.title = "Preferred quality";
    quality.entries = PREF_QUALITY_ENTRIES;
    quality.entryValues = PREF_QUALITY_VALUES;
    quality.setDefaultValue(PREF_QUALITY_DEFAULT);
    quality.summary = "%s";
    screen.addPreference(quality);
  }
}

function isCountdownWidget(videoUrl: string | null | undefined, type: number | null | undefined): boolean {
  if (type === TYPE_COUNTDOWN) return true;
  if (!videoUrl?.trim()) return false;
  const lower = videoUrl.toLowerCase();
  return lower.includes("tickcounter.com") || lower.includes("/widget/countdown/");
}

function parseStatus(status: string | null | undefined): number {
  const s = (status ?? "").toLowerCase();
  if (s.includes("ongoing")) return SAnime.ONGOING;
  if (s.includes("completed")) return SAnime.COMPLETED;
  return SAnime.UNKNOWN;
}
