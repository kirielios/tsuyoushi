// Port of aniyomi lib/voeextractor (VoeExtractor + DdosGuardInterceptor). The HLS playlist is returned as one video:
// the player (hls.js) reads its variants and switches quality itself, so PlaylistUtils' per-variant split is not needed.
import { Track, Video } from "../../sdk/anime.ts";
import type { HttpClient, Response } from "../../sdk/network.ts";
import { escapeRegex, substringAfter, substringBefore, substringBeforeLast } from "../../sdk/strings.ts";

const REDIRECT_REGEX = /window.location.href\s*=\s*'([^']+)';/;
const PATTERNS_REGEX = new RegExp(["@$", "^^", "~@", "%?", "*~", "!!", "#&"].map(escapeRegex).join("|"), "g");

export class VoeExtractor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  async videosFromUrl(url: string, prefix = ""): Promise<Video[]> {
    let document = (await this.getDdos(url, this.headers)).asJsoup();
    let baseUrl = url;
    const scriptData = document.selectFirst("script")?.data();
    const redirectMatch = scriptData ? REDIRECT_REGEX.exec(scriptData) : null;

    if (redirectMatch) {
      const originalUrl = redirectMatch[1];
      baseUrl = originalUrl;
      document = (await this.getDdos(originalUrl, this.headers)).asJsoup();
    }

    const data = document.selectFirst("script[type=application/json]")?.data();
    if (data == null) return [];
    const encodedString = substringBeforeLast(substringAfter(data.trim(), '["'), '"]');

    const decryptedJson = decryptF7(encodedString);
    if (!decryptedJson) return [];
    const m3u8 = typeof decryptedJson.source === "string" ? decryptedJson.source : null;
    const mp4 = typeof decryptedJson.direct_access_url === "string" ? decryptedJson.direct_access_url : null;

    let cleanPrefix = prefix.trim();
    if (cleanPrefix.startsWith("(") && cleanPrefix.endsWith(")")) cleanPrefix = cleanPrefix.slice(1, -1).trim();
    if (cleanPrefix.endsWith("-")) cleanPrefix = cleanPrefix.slice(0, -1).trim();
    const displayPrefix = cleanPrefix || "VOE";
    // ponytail: upstream converts the SubRip captions to WebVTT through temp files (PlaylistUtils.fixSubtitles); here
    // they are passed on as served, the player has to read SRT
    let tracks: Track[] = [];
    try {
      const captions = Array.isArray(decryptedJson.captions) ? (decryptedJson.captions as { file?: unknown; label?: unknown }[]) : [];
      tracks = captions.flatMap((c) => {
        if (typeof c?.file !== "string") return [];
        const u = fixUrl(c.file, baseUrl);
        return u ? [new Track(u, typeof c.label === "string" ? c.label : "Subtitle")] : [];
      });
    } catch {
      tracks = [];
    }
    const subHint = tracks.length ? ` [CC ${tracks.length}]` : "";

    if (m3u8 != null) {
      // Fails on a non-playlist response, which PlaylistUtils would otherwise pass on as a single video.
      const res = await this.getDdos(m3u8, this.headers).catch(() => null);
      const isPlaylist = !!res?.isSuccessful && res.text().trimStart().replace(/^﻿/, "").startsWith("#EXTM3U");
      if (isPlaylist) {
        const quality = "Auto";
        const base = displayPrefix === "VOE" ? `VOE:${quality}` : `${displayPrefix} - VOE ${quality}`;
        return [new Video({ videoUrl: m3u8, videoTitle: base + subHint, headers: new Headers(this.headers), subtitleTracks: tracks })];
      }
      if (!mp4?.trim()) throw new Error("VOE: HLS playlist is unavailable");
    }
    // The MP4 duplicates the top HLS variant, so it is only offered when HLS is unavailable.
    if (mp4 != null) {
      const videoHeaders = new Headers(this.headers);
      videoHeaders.set("Referer", baseUrl);
      // ponytail: upstream reads the MP4's size with MediaMetadataRetriever; not available here, so no resolution
      const resolution = "Unknown quality";
      const mp4Quality = displayPrefix === "VOE" ? `VOE:MP4 - ${resolution}` : `${displayPrefix} - VOE MP4 - ${resolution}`;
      return [new Video({ videoUrl: mp4, videoTitle: mp4Quality + subHint, headers: videoHeaders, subtitleTracks: tracks })];
    }
    return [];
  }

  /**
   * DdosGuardInterceptor: a 403 from a ddos-guard server is retried once with the __ddg2_ cookie, which the
   * check.ddos-guard.net well-known path sets (the client's cookie jar keeps it).
   */
  private async getDdos(url: string, headers: Headers): Promise<Response> {
    const response = await this.client.get(url, headers, { ensureSuccess: false });
    if (response.code !== 403 || response.header("Server")?.toLowerCase() !== "ddos-guard") return response;
    const has = () => this.client.cookieJar.loadForRequest(url).some((c) => c.name === "__ddg2_" && c.value);
    if (!has()) {
      // ponytail: upstream also reads __ddg2_ from the WebView's CookieManager; only the client's jar exists here
      const wellKnown = substringBefore(substringAfter((await this.client.get(WELL_KNOWN_URL, undefined, { ensureSuccess: false })).text(), "'", ""), "'", "");
      const u = new URL(url);
      await this.client.get(`${u.protocol}//${u.host}${wellKnown}`, undefined, { ensureSuccess: false });
    }
    return this.client.get(url, headers, { ensureSuccess: false });
  }
}

const WELL_KNOWN_URL = "https://check.ddos-guard.net/check.js";

/** keiyoushi.utils.UrlUtils.fixUrl */
function fixUrl(u: string, base: string): string | null {
  try {
    return new URL(u.startsWith("//") ? `https:${u}` : u, base).href;
  } catch {
    return null;
  }
}

function decryptF7(p8: string): Record<string, unknown> | null {
  try {
    const vF = rot13(p8);
    const vF2 = replacePatterns(vF);
    const vF3 = removeUnderscores(vF2);
    const vF4 = base64Decode(vF3);
    const vF5 = charShift(vF4, 3);
    const vF6 = reverse(vF5);
    const vAtob = base64Decode(vF6);
    // ISO-8859-1 above, as upstream; the JSON itself is ASCII with \u escapes
    return JSON.parse(vAtob) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const rot13 = (input: string) =>
  input.replace(/[A-Za-z]/g, (c) => {
    const a = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - a + 13) % 26) + a);
  });
const replacePatterns = (input: string) => input.replace(PATTERNS_REGEX, "_");
const removeUnderscores = (input: string) => input.replace(/_/g, "");
const charShift = (input: string, shift: number) => Array.from(input, (c) => String.fromCharCode(c.charCodeAt(0) - shift)).join("");
const reverse = (input: string) => input.split("").reverse().join("");
// atob yields one char per byte: Charsets.ISO_8859_1
const base64Decode = (input: string) => atob(input.replace(/\s/g, ""));
