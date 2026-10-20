// Port of aniyomi lib/mixdropextractor.
import { Track, Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";
import { JsUnpacker } from "../unpacker/index.ts";

const DEFAULT_REFERER = "https://mixdrop.co/";

export class MixDropExtractor {
  constructor(private readonly client: HttpClient) {}

  async videoFromUrl(url: string, lang = "", prefix = "", externalSubs: Track[] = [], referer = DEFAULT_REFERER): Promise<Video[]> {
    const headers = new Headers({
      Referer: referer,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    });
    const doc = (await this.client.get(url, headers)).asJsoup();
    const packed = doc.selectFirst("script:containsData(eval):containsData(MDCore)")?.data();
    const unpacked = packed && JsUnpacker.unpackAndCombine(packed);
    if (!unpacked) return [];

    const videoUrl = "https:" + substringBefore(substringAfter(unpacked, 'Core.wurl="'), '"');

    const sub = substringBefore(substringAfter(unpacked, 'Core.remotesub="'), '"');
    const subs = sub.trim() ? [new Track(decodeURIComponent(sub.replace(/\+/g, " ")), "sub")] : [];

    const quality = `${prefix}MixDrop${lang.trim() ? `(${lang})` : ""}`;

    return [new Video({ videoUrl, videoTitle: quality, headers, subtitleTracks: [...subs, ...externalSubs] })];
  }

  videosFromUrl(url: string, lang = "", prefix = "", externalSubs: Track[] = [], referer = DEFAULT_REFERER): Promise<Video[]> {
    return this.videoFromUrl(url, lang, prefix, externalSubs, referer);
  }
}
