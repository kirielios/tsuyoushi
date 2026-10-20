// Port of aniyomi lib/okruextractor.
import { Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringBefore, trimEnd } from "../../sdk/strings.ts";
import { PlaylistUtils } from "../playlistutils/index.ts";

const STRING_REGEX = /\\+u0026/g;
const NAME_REGEX = /\{\s*\\*"name\\*"\s*:\s*\\*"/;
const VIDEOS_JSON_REGEX = /videos\\*"\s*:\s*\\*\[(.*?)(?:\]|$)/;
const QUALITIES: Record<string, string> = { ultra: "2160p", quad: "1440p", full: "1080p", hd: "720p", sd: "480p", low: "360p", lowest: "240p", mobile: "144p" };

export class OkruExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers = new Headers(),
  ) {
    this.playlistUtils = new PlaylistUtils(client);
  }

  private fixQuality(quality: string): string {
    return QUALITIES[quality] ?? quality;
  }

  async videosFromUrl(url: string, prefix = "", fixQualities = true): Promise<Video[]> {
    const document = (await this.client.get(url, this.headers)).asJsoup();
    const videoString = document.selectFirst("div[data-options]")?.attr("data-options");
    if (videoString == null) return [];
    if (videoString.includes("ondemandHls")) {
      return this.playlistUtils.extractFromHls(extractLink(videoString, "ondemandHls"), { videoNameGen: (q) => addPrefix(`Okru:${q}`, prefix) });
    }
    if (videoString.includes("ondemandDash")) {
      return this.playlistUtils.extractFromDash(extractLink(videoString, "ondemandDash"), (q: string) => addPrefix(`Okru:${q}`, prefix));
    }
    return this.videosFromJson(videoString, prefix, fixQualities);
  }

  private videosFromJson(videoString: string, prefix = "", fixQualities = true): Video[] {
    const arrayData = VIDEOS_JSON_REGEX.exec(videoString)?.[1];
    if (arrayData == null) return [];
    return arrayData
      .split(NAME_REGEX)
      .reverse()
      .flatMap((data) => {
        const videoUrl = extractLink(data, "url");
        const raw = trimEnd(substringBefore(data, '"'), "\\");
        const quality = fixQualities ? this.fixQuality(raw) : raw;
        return videoUrl.startsWith("https://") ? [new Video({ videoUrl, videoTitle: addPrefix(`Okru:${quality}`, prefix) })] : [];
      });
  }
}

const addPrefix = (s: string, prefix: string) => (prefix.trim() ? `${prefix} ${s}` : s);

const extractLink = (s: string, attr: string) => new RegExp(`${attr}(\\\\*")\\s*:\\s*\\1(.*?)\\1`).exec(s)?.[2]?.replace(STRING_REGEX, "&") ?? "";
