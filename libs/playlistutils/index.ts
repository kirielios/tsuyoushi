// Port of aniyomi lib/playlistutils. The player (hls.js) reads a master playlist's variants and switches quality
// itself, so extractFromHls returns the playlist as one video instead of one per variant, and does not fetch it.
// The Kotlin overloads are one function each; their named arguments are an options object.
import { Track, Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";

type HeadersGen = (baseHeaders: Headers, referer: string) => Headers;
type VideoHeadersGen = (baseHeaders: Headers, referer: string, videoUrl: string) => Headers;

export interface HlsOptions {
  referer?: string;
  masterHeaders?: Headers;
  videoHeaders?: Headers;
  masterHeadersGen?: HeadersGen;
  videoHeadersGen?: VideoHeadersGen;
  videoNameGen?: (quality: string) => string;
  subtitleList?: Track[];
  audioList?: Track[];
  toStandardQuality?: (quality: string) => string;
}

export interface DashOptions {
  referer?: string;
  mpdHeaders?: Headers;
  videoHeaders?: Headers;
  mpdHeadersGen?: HeadersGen;
  videoHeadersGen?: VideoHeadersGen;
  subtitleList?: Track[];
  audioList?: Track[];
  toStandardQuality?: (quality: string) => string;
}

const STANDARD_QUALITIES = [144, 240, 360, 480, 720, 1080, 1440, 2160];
const FIX_SUBTITLE_REGEX =
  /$(\n{2,})(?!(?:(?:\d+:)*\d+(?:\.\d+)?\s-+>\s(?:\d+:)*\d+(?:\.\d+)?|(?:NOTE|STYLE|REGION)(?:[ \t\n]|$)|[^\n]+\n(?:(?:\d+:)*\d+(?:\.\d+)?\s-+>\s)))/gm;
const SRT_TIMECODE_REGEX = /((?:\d{1,3}:)?\d{1,3}:\d{2})[,.](\d{1,3})[ \t]*-->[ \t]*((?:\d{1,3}:)?\d{1,3}:\d{2})[,.](\d{1,3})/g;
const SRT_CUE_INDEX_REGEX = /^\d+[ \t]*\n(?=(?:\d{1,3}:)?\d{1,3}:\d{2}\.\d{1,3}[ \t]*-->)/gm;

export class PlaylistUtils {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers = new Headers(),
  ) {}

  // ================================ M3U8 ================================

  extractFromHls(playlistUrl: string, o: HlsOptions = {}): Promise<Video[]> {
    const referer = o.referer ?? toDefaultReferer(playlistUrl);
    const masterHeadersGen = o.masterHeadersGen ?? (o.masterHeaders ? () => o.masterHeaders! : this.generateMasterHeaders);
    const masterHeaders = masterHeadersGen(this.headers, referer);
    const videoNameGen = o.videoNameGen ?? ((q: string) => q);
    // ponytail: the master's EXT-X-MEDIA subtitle/audio renditions are left to hls.js; only the given lists are attached
    return Promise.resolve([
      new Video({ videoUrl: playlistUrl, videoTitle: videoNameGen("Auto"), headers: masterHeaders, subtitleTracks: o.subtitleList, audioTracks: o.audioList }),
    ]);
  }

  generateMasterHeaders(baseHeaders: Headers, referer: string): Headers {
    const h = new Headers(baseHeaders);
    h.set("Accept", "*/*");
    if (referer) {
      h.set("Origin", `https://${new URL(referer).host}`);
      h.set("Referer", referer);
    }
    return h;
  }

  // ================================ DASH ================================

  /**
   * `videoNameGen(quality)` gets " - <bitrate>" appended, as the Kotlin (String) -> String overloads do;
   * `videoNameGen(quality, bandwidth)` names the video itself.
   */
  async extractFromDash(mpdUrl: string, videoNameGen: ((quality: string) => string) | ((quality: string, bandwidth: string) => string), o: DashOptions = {}): Promise<Video[]> {
    const nameGen =
      videoNameGen.length >= 2
        ? (videoNameGen as (q: string, b: string) => string)
        : (res: string, bandwidth: string) => [(videoNameGen as (q: string) => string)(res), formatBitrate(Number(bandwidth))].filter(Boolean).join(" - ");
    const referer = o.referer ?? toDefaultReferer(mpdUrl);
    const mpdHeaders = (o.mpdHeadersGen ?? (o.mpdHeaders ? () => o.mpdHeaders! : this.generateMasterHeaders))(this.headers, referer);
    const videoHeadersGen: VideoHeadersGen = o.videoHeadersGen ?? (o.videoHeaders ? () => o.videoHeaders! : (b, r) => this.generateMasterHeaders(b, r));
    const toStandardQuality = o.toStandardQuality ?? ((q: string) => this.standardQuality(q));

    const doc = (await this.client.get(mpdUrl, mpdHeaders, { ensureSuccess: false })).asJsoup();
    const audioTracks = [
      ...(o.audioList ?? []),
      ...doc.select("Representation[mimetype~=audio]").map((a) => new Track(a.text(), formatBitrate(Number(a.attr("bandwidth"))))),
    ];
    // ponytail: DASH video representations are video-only; the host does not play the separate audio tracks yet
    return doc.select("Representation[mimetype~=video]").map((v) => {
      const res = `${toStandardQuality(v.attr("height"))} (${v.attr("width")}x${v.attr("height")})`;
      const videoUrl = v.text();
      return new Video({ videoUrl, videoTitle: nameGen(res, v.attr("bandwidth")), headers: videoHeadersGen(this.headers, referer, videoUrl), subtitleTracks: o.subtitleList, audioTracks });
    });
  }

  // ============================= Utilities ==============================

  /** Returns the closest standard resolution label, such as `720p`, for a pixel height. */
  standardQuality(quality: string): string {
    const t = quality.trim();
    if (!/^[+-]?\d+$/.test(t)) return quality;
    const int = Number(t);
    return `${STANDARD_QUALITIES.reduce((a, b) => (Math.abs(b - int) < Math.abs(a - int) ? b : a))}p`;
  }

  /**
   * Fixes illegal blank lines in WebVTT and converts SubRip to WebVTT. Upstream writes the result to a temp file;
   * here it becomes a data: URL. Tracks that fail to load are dropped.
   */
  async fixSubtitles(subtitleList: Track[]): Promise<Track[]> {
    const fixed = await Promise.all(
      subtitleList.map(async (track) => {
        try {
          const vtt = toWebVtt((await this.client.get(track.url, new Headers())).text());
          const cleaned = vtt.startsWith("WEBVTT") ? vtt.replace(FIX_SUBTITLE_REGEX, (_, gap: string) => "\n" + "&nbsp;\n".repeat(gap.length - 1)) : vtt;
          return new Track(`data:text/vtt;charset=utf-8,${encodeURIComponent(cleaned)}`, track.lang);
        } catch {
          return null;
        }
      }),
    );
    return fixed.filter((t): t is Track => t != null);
  }
}

function toDefaultReferer(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return "";
  }
}

/** Formats an HLS/DASH bandwidth, which is given in bits per second. */
function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps)) return "";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${Math.trunc(bps / 1_000)} kbps`;
  return bps > 0 ? `${bps} bps` : "";
}

/** SubRip (or WebVTT) text to WebVTT. */
export function toWebVtt(subData: string): string {
  const data = subData.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimStart();
  if (data.startsWith("WEBVTT") || !new RegExp(SRT_TIMECODE_REGEX.source).test(data)) return data;
  return "WEBVTT\n\n" + data.replace(SRT_TIMECODE_REGEX, "$1.$2 --> $3.$4").replace(SRT_CUE_INDEX_REGEX, "");
}
