// Port of yuzono/anime-extensions lib/rumbleextractor.
import { Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { PlaylistUtils } from "../playlistutils/index.ts";

const REGEX = /rumble\.com\/embed\/v([a-zA-Z0-9]+)/;
const MP4_REGEX = /"(\d+)":\{"url":"(https:[^"]+?\.mp4)"/g;

export class RumbleExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  async videosFromUrl(url: string, prefix = ""): Promise<Video[]> {
    const id = REGEX.exec(url)?.[1];
    if (id == null) return [];
    // Not upstream: short clips (previews) have no HLS (hls-vod answers 404), only the mp4 renditions in the embed's "ua" block.
    const html = (await this.client.get(url, this.headers)).text();
    const ua = html.split('"ua":{"mp4":{')[1];
    if (!html.includes('"tar":{') && ua != null) {
      return [...ua.split("}}}")[0].matchAll(MP4_REGEX)]
        .reverse()
        .map((m) => new Video({ videoUrl: m[2].replaceAll("\\/", "/"), videoTitle: `${prefix} ${m[1]}p`, headers: this.headers }));
    }
    return this.playlistUtils.extractFromHls(`https://rumble.com/hls-vod/${id}/playlist.m3u8`, { referer: url, videoNameGen: (q) => `${prefix} ${q}` });
  }
}
