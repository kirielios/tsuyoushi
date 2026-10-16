// Port of aniyomi lib/streamwishextractor. The master playlist is returned as one video: the player (hls.js) reads its
// variants and switches quality itself, so PlaylistUtils' per-variant split is not needed.
import { Track, Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";
import { JsUnpacker } from "../unpacker/index.ts";

const M3U8_REGEX = /https[^"]*m3u8[^"]*/;
const DOMAINS = ["streamwish.com", "niramirus.com", "medixiru.com"];

export class StreamWishExtractor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  async videosFromUrl(url: string, videoNameGen: (quality: string) => string = (q) => `StreamWish - ${q}`): Promise<Video[]> {
    const id = getEmbedId(url);
    const isAbsoluteId = /^https?:\/\//.test(id);
    const urls = isAbsoluteId ? [id] : DOMAINS.map((d) => new URL(id, `https://${d}`).href);
    // ponytail: upstream follows a /main.js redirect through the Synchrony deobfuscator; not ported, the direct page is tried only
    for (const fullUrl of urls) {
      try {
        const doc = (await this.client.get(fullUrl, this.headers)).asJsoup();
        let script = doc.selectFirst("script:containsData(m3u8)")?.data();
        if (script?.includes("eval(function(p,a,c")) script = JsUnpacker.unpackAndCombine(script) ?? undefined;
        const masterUrl = script && M3U8_REGEX.exec(script)?.[0];
        if (!script || !masterUrl) continue;
        const origin = new URL(masterUrl).origin;
        const headers = new Headers(this.headers);
        headers.set("Referer", `${origin}/`);
        headers.set("Origin", origin);
        return [new Video({ videoUrl: masterUrl, videoTitle: videoNameGen("Auto"), headers, subtitleTracks: subtitles(script) })];
      } catch {
        if (isAbsoluteId) return [];
      }
    }
    return [];
  }
}

function getEmbedId(url: string): string {
  return /.*\/[efd]\/([a-zA-Z0-9]+)/.exec(url)?.[1] ?? url;
}

function subtitles(script: string): Track[] {
  try {
    const list = substringBefore(substringAfter(substringAfter(script, "tracks"), "["), "]");
    const items = JSON.parse(`[${list.replace(/(?<!")\b(file|kind|label)\b(?!")/g, '"$1"')}]`) as { file: string; kind: string; label?: string }[];
    return items.filter((t) => t.kind?.toLowerCase() === "captions").map((t) => new Track(t.file, t.label ?? ""));
  } catch {
    return [];
  }
}
