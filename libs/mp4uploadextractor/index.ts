// Port of aniyomi lib/mp4uploadextractor.
import { Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";
import { JsUnpacker } from "../unpacker/index.ts";

const REFERER = "https://mp4upload.com/";

export class Mp4uploadExtractor {
  constructor(private readonly client: HttpClient) {}

  async videosFromUrl(url: string, headers: Headers, prefix = "", suffix = ""): Promise<Video[]> {
    const newHeaders = new Headers(headers);
    newHeaders.set("referer", REFERER);
    const doc = (await this.client.get(url, newHeaders)).asJsoup();
    const packed = doc.select("script").map((s) => s.data()).find((d) => d.includes("eval") && d.includes("p,a,c,k,e,d"));
    const script = (packed && JsUnpacker.unpackAndCombine(packed)) ?? doc.select("script").map((s) => s.data()).find((d) => d.includes("player.src"));
    if (!script) return [];
    const videoUrl = substringBefore(substringAfter(substringAfter(substringBefore(substringAfter(script, ".src("), ")"), "src:"), '"'), '"');
    if (!videoUrl) return [];
    const res = /\WHEIGHT=(\d+)/.exec(script);
    return [new Video({ videoUrl, videoTitle: `${prefix}Mp4Upload - ${res ? `${res[1]}p` : "Unknown resolution"}${suffix}`, headers: newHeaders })];
  }
}
