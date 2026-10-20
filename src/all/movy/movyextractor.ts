// Port of yuzono/anime-extensions src/all/movy/MovyExtractor.kt
import { Track, Video, type HttpClient } from "../../../sdk/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import type { SeedDto, VideasyDecryptedResult, VideasyDecryptionDto, VideasyServer } from "./dto.ts";

const VIDEASY_API_BASE = "https://api.wecollege.net";
const DECRYPTION_API_URL = "https://enc-dec.app/api/dec-videasy";

const qualityRegex = /(\d{3,4})[pP]?/;
const GENERIC_QUALITY_PLACEHOLDERS = new Set(["original", "auto", "video", "full video", "watch video", "play video", "hls", "dash"]);
const GENERIC_QUALITY_REGEX = /^(video|stream|hls|dash)(\s+.*)?$/;

/**
 * Resolves Videasy embeds for a Movy episode/movie: double-encoded /sources request -> enc-dec.app decrypt -> HLS
 * expansion + subtitle/quality formatting.
 */
// ponytail: upstream's 60 s LRU result cache is left out; the host asks for an episode's videos once per play.
export class MovyExtractor {
  private readonly playlistUtils: PlaylistUtils;

  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  private getOrigin(url: string, stripWww = true): string {
    const origin = new URL(url).origin;
    return stripWww ? origin.replace("://www.", "://") : origin;
  }

  async videosForServer(o: { server: VideasyServer; path: string; title: string; year: string; imdbId: string; baseUrl: string; subLimit: number }): Promise<Video[]> {
    const { server, path, title, year, imdbId, baseUrl, subLimit } = o;
    const pathParts = path.split("/");
    const isMovie = pathParts[0] === "movie";
    const tmdbId = pathParts[1];

    try {
      const apiOrigin = this.getOrigin(baseUrl, false);
      const backendHeaders = new Headers(this.headers);
      backendHeaders.set("Referer", `${apiOrigin}/`);
      backendHeaders.set("Origin", apiOrigin);

      const seed = (await this.client.get(`${VIDEASY_API_BASE}/seed?mediaId=${tmdbId}`, backendHeaders)).parseAs<SeedDto>().seed;

      const q = new URLSearchParams({ mediaType: isMovie ? "movie" : "tv", year });
      if (!isMovie) {
        q.set("episodeId", pathParts[3]);
        q.set("seasonId", pathParts[2]);
      }
      q.set("tmdbId", tmdbId);
      if (imdbId.trim()) q.set("imdbId", imdbId);
      if (server.language != null) q.set("language", server.language);
      q.set("enc", "2");
      q.set("seed", seed);
      const serverUrl = `${server.apiBase}/${server.path}/sources?title=${doubleEncode(title)}&${q}`;

      const encryptedText = (await this.client.get(serverUrl, backendHeaders)).text();

      const jsonHeaders = new Headers(this.headers);
      jsonHeaders.set("Content-Type", "application/json");
      const decrypted = (await this.client.post(DECRYPTION_API_URL, jsonHeaders, JSON.stringify({ text: encryptedText, id: tmdbId, seed }))).parseAs<VideasyDecryptionDto>().result;
      return await this.buildVideos(server, decrypted, baseUrl, subLimit);
    } catch (e) {
      console.error(`MovyExtractor: error resolving video for server ${server.displayName}`, e);
      return [];
    }
  }

  /** Returns true if the given quality string is a language name masquerading as a resolution label. */
  private isLanguageAsQuality(server: VideasyServer, quality: string): boolean {
    if (qualityRegex.test(quality) || /4k/i.test(quality)) return false;
    if (isGenericQuality(quality)) return true;
    const lower = quality.toLowerCase();
    return lower === server.audioLabel?.toLowerCase() || (server.qualityFilter != null && lower === server.qualityFilter.toLowerCase());
  }

  private async buildVideos(server: VideasyServer, decrypted: VideasyDecryptedResult, baseUrl: string, subLimit: number): Promise<Video[]> {
    const subtitles = (decrypted.subtitles ?? [])
      .flatMap((sub) => {
        const u = sub.url ?? sub.file ?? sub.src;
        const l = sub.language ?? sub.label ?? sub.lang ?? sub.name;
        return u && l ? [new Track(u, l)] : [];
      })
      .slice(0, Math.max(subLimit, 0));

    // Use full domain (preserve www.) for video headers: some CDNs are sensitive to the exact Referer.
    const streamOrigin = this.getOrigin(baseUrl, false);
    const videoHeaders = new Headers(this.headers);
    videoHeaders.set("Referer", `${streamOrigin}/`);
    videoHeaders.set("Origin", streamOrigin);

    const label = (quality: string, url: string) => this.buildVideoLabel(server, quality, url, subtitles.length);
    const single = (url: string, quality: string) => new Video({ videoUrl: url, videoTitle: label(quality, url), headers: videoHeaders, subtitleTracks: subtitles });
    const expand = async (url: string, fallbackQuality: string) => {
      const expanded = await this.playlistUtils
        .extractFromHls(url, { videoNameGen: (quality) => label(quality, url), subtitleList: subtitles, masterHeaders: videoHeaders, videoHeaders })
        .catch(() => [] as Video[]);
      return expanded.length ? expanded : [single(url, fallbackQuality)];
    };

    const filter = server.qualityFilter?.toLowerCase();
    const filteredSources = filter ? decrypted.sources?.filter((s) => s.quality?.toLowerCase() === filter) : decrypted.sources;

    let videos: Video[] = [];
    if (filteredSources?.length) {
      const seen = new Set<string>();
      const unique = filteredSources.filter((s) => !seen.has(s.url) && seen.add(s.url));
      videos = (
        await Promise.all(
          unique.map((source) => {
            const rawQuality = source.quality?.trim() ? source.quality : "Auto";
            const lower = source.url.toLowerCase();
            const isHls = lower.includes(".m3u8");
            const isDash = lower.includes(".mpd");
            const isLang = this.isLanguageAsQuality(server, rawQuality);
            // Expand when the quality is not a real resolution and the URL is HLS/DASH, or the label is a language
            // or generic placeholder; Phoenix returns master playlists without an extension, so always expand it.
            const needsExpansion = (!isRealResolution(rawQuality) && (isHls || isDash || isLang || isGenericQuality(rawQuality))) || server.displayName === "Phoenix";
            return needsExpansion ? expand(source.url, rawQuality) : [single(source.url, rawQuality)];
          }),
        )
      ).flat();
    } else if (decrypted.streams != null) {
      videos = Object.entries(decrypted.streams).map(([quality, url]) => single(url, quality));
    } else if (decrypted.url != null) {
      videos = await expand(decrypted.url, "Auto");
    }

    const seen = new Set<string>();
    return videos.filter((v) => !seen.has(v.videoUrl) && seen.add(v.videoUrl));
  }

  private buildVideoLabel(server: VideasyServer, quality: string, url: string, subCount: number): string {
    const parts = [server.displayName];
    if (!this.isLanguageAsQuality(server, quality)) parts.push(quality);
    const has4k = /4k/i.test(quality);
    if (quality.includes("2160") && !has4k) parts.push("4K");
    const lower = url.toLowerCase();
    const container = lower.includes(".m3u8") ? "HLS" : lower.includes(".mpd") ? "DASH" : lower.includes(".mkv") ? "MKV" : lower.includes(".mp4") ? "MP4" : lower.includes(".webm") ? "WebM" : null;
    if (container != null) parts.push(container);
    if (server.audioLabel) parts.push(`${server.audioLabel} audio`);
    if (subCount > 0) parts.push(`${subCount} subs`);
    return parts.join(" · ");
  }

  //   Official servers (verified against website JS + reference table upstream)
  //   Austin filters quality == "English", Delhi quality == "Hindi"; Munich sends ?language=german.
  static readonly VIDEASY_SERVERS: VideasyServer[] = [
    { displayName: "Miami", apiBase: VIDEASY_API_BASE, path: "miami", mayHave4K: true, audioLabel: "Original" },
    { displayName: "Boise", apiBase: VIDEASY_API_BASE, path: "boise", mayHave4K: true, audioLabel: "Original" },
    { displayName: "Vegas", apiBase: VIDEASY_API_BASE, path: "vegas", audioLabel: "Original" },
    { displayName: "Reno", apiBase: VIDEASY_API_BASE, path: "reno", audioLabel: "Original" },
    { displayName: "Oakland", apiBase: VIDEASY_API_BASE, path: "oakland", audioLabel: "Original" },
    { displayName: "Seattle", apiBase: VIDEASY_API_BASE, path: "seattle", audioLabel: "Original" },
    { displayName: "Phoenix", apiBase: VIDEASY_API_BASE, path: "phoenix", audioLabel: "Original" },
    { displayName: "Atlanta", apiBase: VIDEASY_API_BASE, path: "atlanta", audioLabel: "Original" },
    { displayName: "Portland", apiBase: VIDEASY_API_BASE, path: "portland", audioLabel: "Original" },
    { displayName: "Austin", apiBase: VIDEASY_API_BASE, path: "austin", qualityFilter: "English", audioLabel: "Original" },
    { displayName: "Dallas", apiBase: VIDEASY_API_BASE, path: "dallas", audioLabel: "Original" },
    { displayName: "Tampa", apiBase: VIDEASY_API_BASE, path: "tampa", audioLabel: "Original" },
    { displayName: "Orlando", apiBase: VIDEASY_API_BASE, path: "orlando", audioLabel: "Original" },
    { displayName: "Munich", apiBase: VIDEASY_API_BASE, path: "munich", language: "german", audioLabel: "German" },
    { displayName: "Berlin", apiBase: VIDEASY_API_BASE, path: "berlin", audioLabel: "German" },
    { displayName: "Paris", apiBase: VIDEASY_API_BASE, path: "paris", audioLabel: "French" },
    { displayName: "Delhi", apiBase: VIDEASY_API_BASE, path: "delhi", qualityFilter: "Hindi", audioLabel: "Hindi" },
    { displayName: "Cancun", apiBase: VIDEASY_API_BASE, path: "cancun", audioLabel: "Spanish" },
  ];

  static readonly SERVER_DISPLAY_NAMES = MovyExtractor.VIDEASY_SERVERS.map((s) => s.displayName);
}

function isGenericQuality(quality: string): boolean {
  const normalized = quality.trim().toLowerCase();
  return GENERIC_QUALITY_PLACEHOLDERS.has(normalized) || !normalized || GENERIC_QUALITY_REGEX.test(normalized);
}

/** A real resolution ("1080p", "4K", bare digits) needs no HLS expansion: the server already labelled it. */
function isRealResolution(quality: string): boolean {
  return quality.trim() !== "" && (qualityRegex.test(quality) || /4k/i.test(quality) || /^\d+$/.test(quality));
}

/** Percent-encodes everything but RFC 3986 unreserved characters (encodeURIComponent also keeps !'()*), twice. */
const pctEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const doubleEncode = (s: string) => pctEncode(pctEncode(s));
