// Port of yuzono/anime-extensions src/en/animekhor/extractors/TurboVidExtractor.kt
import { Track, Video, type HttpClient } from "../../../../sdk/index.ts";
import { PlaylistUtils } from "../../../../libs/playlistutils/index.ts";

const URL_PLAY_REGEX = /urlPlay\s*=\s*['"]([^'"]+)/;
const URL_SUB_REGEX = /urlSub\s*=\s*['"]([^'"]+)/;
const HUNTER_REGEX = /}\s*\(\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/;

export class TurboVidExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
    private readonly referer: string,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  async videosFromUrl(url: string, prefix = ""): Promise<Video[]> {
    const pageHeaders = new Headers(this.headers);
    pageHeaders.set("Referer", this.referer);
    const html = (await this.client.get(url, pageHeaders)).text();

    let urlPlay = URL_PLAY_REGEX.exec(html)?.[1];
    let urlSub = URL_SUB_REGEX.exec(html)?.[1];
    if (urlPlay == null) {
      const m = HUNTER_REGEX.exec(html);
      if (m != null) {
        const unpacked = unpackHunter(m[1], m[3], Number.parseInt(m[4], 10) || 0, Number.parseInt(m[5], 10) || 0);
        urlPlay = URL_PLAY_REGEX.exec(unpacked)?.[1];
        urlSub ??= URL_SUB_REGEX.exec(unpacked)?.[1];
      }
    }
    if (!urlPlay?.trim()) return [];

    const subtitles = urlSub?.trim() ? [new Track(urlSub, "Subtitles")] : [];
    // ponytail: upstream forces mpv/ffmpeg to demux the extensionless MPEG-TS segments; hls.js sniffs them itself.
    if (urlPlay.includes(".m3u8")) return this.playlistUtils.extractFromHls(urlPlay, { referer: url, subtitleList: subtitles, videoNameGen: (it) => `${prefix}${it}` });
    const videoHeaders = new Headers(this.headers);
    videoHeaders.set("Referer", url);
    return [new Video({ videoUrl: urlPlay, videoTitle: `${prefix}Turbovid`, headers: videoHeaders, subtitleTracks: subtitles })];
  }
}

/** The "hunter" packer: h is split on n[e], each chunk spells a base-e number with n's characters as digits, minus t. */
function unpackHunter(h: string, n: string, t: number, e: number): string {
  if (e < 2 || e > 36) return "";
  const delimiter = n[e];
  if (delimiter == null) return "";
  const chunks = h.split(delimiter);
  if (chunks.length <= 1) return "";
  const bytes = new Uint8Array(chunks.length - 1);
  for (let idx = 0; idx < chunks.length - 1; idx++) {
    let s = chunks[idx];
    for (let j = 0; j < n.length; j++) s = s.replaceAll(n[j], String(j));
    if (!/^[0-9a-z]+$/i.test(s)) return "";
    bytes[idx] = (Number.parseInt(s, e) - t) & 0xff;
  }
  return new TextDecoder().decode(bytes);
}
