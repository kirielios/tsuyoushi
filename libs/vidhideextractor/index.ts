// Port of aniyomi lib/vidhideextractor. The master playlist is returned as one video: the player (hls.js) reads its
// variants and switches quality itself, so PlaylistUtils' per-variant split is not needed.
import { Track, Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { autoUnpacker } from "../unpacker/index.ts";

const SOURCE = /"((?:https?:\/)?\/[^"]*m3u8[^"]*)"/g;
const fix = (u: string, base: string) => {
  try {
    return new URL(u.startsWith("//") ? `https:${u}` : u, base).href;
  } catch {
    return null;
  }
};

export class VidHideExtractor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  async videosFromUrl(url: string, videoNameGen: (quality: string) => string = (q) => `VidHide - ${q}`): Promise<Video[]> {
    const doc = (await this.client.get(url, this.headers, { ensureSuccess: true })).asJsoup();
    const packed = doc.select("script").map((s) => s.html()).find((h) => h.includes("eval(function(p,a,c,k,e,d)"));
    const script = packed && autoUnpacker(packed);
    if (!script) return [];
    const playlists = [...script.matchAll(SOURCE)].map((m) => fix(m[1], url)).filter((u): u is string => !!u);
    const subtitleTracks = subtitles(script, url);
    const origin = new URL(url).origin;
    const headers = new Headers(this.headers);
    headers.set("Referer", url);
    headers.set("Origin", origin);
    return playlists.map((videoUrl) => new Video({ videoUrl, videoTitle: videoNameGen("Auto"), headers, subtitleTracks }));
  }
}

function subtitles(script: string, base: string): Track[] {
  try {
    const at = script.indexOf("tracks");
    if (at < 0) return [];
    const list = script.slice(at).split("[")[1]?.split("]")[0] ?? "";
    // lenient JSON upstream: keys may be unquoted
    const items = JSON.parse(`[${list.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')}]`) as { file: string; kind: string; label?: string }[];
    return items.filter((t) => t.kind?.toLowerCase() === "captions").flatMap((t) => {
      const u = fix(t.file, base);
      return u ? [new Track(u, t.label ?? "")] : [];
    });
  } catch {
    return [];
  }
}
