// Port of yuzono/anime-extensions src/id/oploverz/Oploverz.kt
import {
  AnimeHttpSource,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  parallelCatchingFlatMap,
  parseAs,
  Video,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type SAnime,
  type SEpisode,
} from "../../../sdk/index.ts";
import { BloggerExtractor } from "../../../libs/bloggerextractor/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { PixelDrainExtractor } from "../../../libs/pixeldrainextractor/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import { autoUnpacker } from "../../../libs/unpacker/index.ts";
import {
  episodeToSEpisode,
  latestToAnimesPage,
  seriesListToAnimesPage,
  seriesToSAnime,
  type EpisodeDetailResponseDto,
  type EpisodeListResponseDto,
  type FiledonPageDto,
  type LatestEpisodesResponseDto,
  type SeriesListResponseDto,
  type SeriesResponseDto,
  type StreamDto,
} from "./dto.ts";
import { FILTER_LIST, getGenreParam } from "./filters.ts";

const API_URL = "https://backapi.oploverz.ac";
const ANIME_PAGE_SIZE = 20;
const EPISODE_PAGE_SIZE = 2000;
// upbolt.to /dl: jwplayer("vplayer").setup({ sources: [{file:"https://edgeNN.upbolt.to/hls2/.../master.m3u8?t=..."}], ... })
const XFS_SOURCE_REGEX = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/;

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_TITLE = "Preferred quality";
const PREF_QUALITY_DEFAULT = "720p";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];

export default class Oploverz extends AnimeHttpSource {
  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${API_URL}/api/series?page=${page}&pageSize=${ANIME_PAGE_SIZE}`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    const [animes, hasNextPage] = seriesListToAnimesPage(response.parseAs<SeriesListResponseDto>());
    return new MangasPage(animes, hasNextPage);
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${API_URL}/api/episodes?page=${page}&pageSize=${ANIME_PAGE_SIZE}&sort=latest`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    const [animes, hasNextPage] = latestToAnimesPage(response.parseAs<LatestEpisodesResponseDto>());
    return new MangasPage(animes, hasNextPage);
  }

  // =============================== Search ===============================
  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const url = new URL(`${API_URL}/api/series`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(ANIME_PAGE_SIZE));
    if (query) url.searchParams.set("q", query);
    const genres = getGenreParam(filters);
    if (genres) url.searchParams.set("genres", genres);
    return GET(url.href, this.headers);
  }
  protected searchAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // ============================== Filters ===============================
  override getFilterList(): FilterList {
    return FILTER_LIST();
  }

  // =========================== Anime Details ============================
  // getAnimeUrl (baseUrl + anime.url) is the SDK's default getMangaUrl.
  override animeDetailsRequest(anime: SAnime) {
    return GET(`${API_URL}/api/series/${slug(anime)}`, this.headers);
  }
  protected animeDetailsParse(response: Response) {
    return seriesToSAnime(response.parseAs<SeriesResponseDto>().data);
  }

  // ============================== Episodes ==============================
  protected override episodeListRequest(anime: SAnime) {
    return GET(`${API_URL}/api/series/${slug(anime)}/episodes?pageSize=${EPISODE_PAGE_SIZE}`, this.headers);
  }
  protected episodeListParse(response: Response): SEpisode[] {
    const slug = new URL(response.url).pathname.split("/")[3];
    return response.parseAs<EpisodeListResponseDto>().data.map((it) => episodeToSEpisode(it, slug));
  }

  // ============================ Video Links =============================
  private get videoHeaders() {
    const h = this.headersBuilder();
    h.set("Referer", `${this.baseUrl}/`);
    return h;
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const [slug, number] = slugAndNumber(episode);
    return [new Hoster(`${API_URL}/api/series/${slug}/episodes/${number}`, this.name)];
  }

  protected override async videoListParse(response: Response): Promise<Video[]> {
    const { streamUrl, downloadUrl } = response.parseAs<EpisodeDetailResponseDto>().data;
    const videos = await parallelCatchingFlatMap(streamUrl ?? [], (it) => this.getVideosFromStream(it));
    // Not upstream: the only download host with a direct file (the others are acefile/vikingfile/fileq/akirabox pages).
    for (const format of downloadUrl ?? [])
      for (const res of format.resolutions ?? [])
        for (const link of res.download_links ?? [])
          if (link.url?.includes("pixeldra")) videos.push(...new PixelDrainExtractor().videosFromUrl(link.url, `${res.quality.trim()} ${format.format} `));
    return videos;
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)));
  }

  private async getVideosFromStream(stream: StreamDto): Promise<Video[]> {
    const { url, source: prefix } = stream;
    if (url.includes("blogger.com") || url.includes("video.g?token=")) return new BloggerExtractor(this.client).videosFromUrl(url, this.videoHeaders, prefix);
    if (url.includes("dailymotion")) return new DailymotionExtractor(this.client, this.headers).videosFromUrl(url, `${prefix} Dailymotion - `);
    if (url.includes("filedon.co")) return this.getFiledonVideo(url, prefix);
    // ponytail: UniversalExtractor (a WebView that sniffs the player's requests) is not ported. abyssplayer's media
    // decodes statically (AES-CTR, key md5("user_id:slug:md5_id")) to a plain URL on *.sssrr.org, but the file's first
    // 64 KiB are AES-CTR encrypted too (its service worker decrypts them), so no URL-only player can play it;
    // oplo2.4meplayer.pro (old episodes) is down. Both are skipped.
    if (url.includes("abyssplayer") || url.includes("4meplayer")) return [];
    return this.getXFileSharingVideos(url, prefix);
  }

  private async getFiledonVideo(url: string, quality: string): Promise<Video[]> {
    const doc = (await this.client.get(url, this.videoHeaders)).asJsoup();
    const dataPage = doc.selectFirst("div#app")?.attr("data-page");
    if (!dataPage) return [];
    const videoUrl = parseAs<FiledonPageDto>(dataPage).props.url;
    return [new Video({ videoUrl, videoTitle: quality, headers: this.videoHeaders })];
  }

  // Handles XFileSharing-style hosts (e.g. upbolt.to): the embed page auto-submits
  // a form to /dl, whose response contains a (usually packed) player script with the source.
  private async getXFileSharingVideos(url: string, quality: string): Promise<Video[]> {
    try {
      const embedUrl = new URL(url);
      const code = embedUrl.pathname.split("/").filter(Boolean).at(-1)!;
      const form = new URLSearchParams({ op: "embed", file_code: code, auto: "1", referer: "" });
      const dlHeaders = this.videoHeaders;
      dlHeaders.set("Referer", url);
      const body = (await this.client.post(`${embedUrl.origin}/dl`, dlHeaders, form)).text();
      const unpacked = autoUnpacker(body) ?? body;
      const videoUrl = XFS_SOURCE_REGEX.exec(unpacked)?.[1];
      if (!videoUrl) return [];
      if (videoUrl.includes("m3u8")) {
        return new PlaylistUtils(this.client, this.headers).extractFromHls(videoUrl, {
          referer: url,
          masterHeaders: dlHeaders,
          videoHeaders: dlHeaders,
          videoNameGen: (it) => `${quality} - ${it}`,
        });
      }
      return [new Video({ videoUrl, videoTitle: quality, headers: dlHeaders })];
    } catch {
      return [];
    }
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY_KEY;
    pref.title = PREF_QUALITY_TITLE;
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_ENTRIES;
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    pref.summary = "%s";
    screen.addPreference(pref);
  }
}

// ============================= Utilities ==============================
const slug = (anime: SAnime) => anime.url.split("/series/")[1].split("/")[0];

function slugAndNumber(episode: SEpisode): [string, string] {
  const segments = episode.url.replace(/^\/+|\/+$/g, "").split("/");
  return [segments[1], segments[3]];
}
