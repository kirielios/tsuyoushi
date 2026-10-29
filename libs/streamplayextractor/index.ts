// Port of yuzono/anime-extensions lib/streamplayextractor.
import { parallelCatchingFlatMap, Track, Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { PlaylistUtils } from "../playlistutils/index.ts";
import { JsUnpacker } from "../unpacker/index.ts";

const KAKEN_REGEX = /window\.kaken ?= ?"([^"]+)";/;

interface APIResponse {
  sources: { file: string; label: string; type: string }[];
  tracks?: { file: string; label: string }[] | null;
}

/** keiyoushi.utils.UrlUtils.fixUrl without a base */
const fixUrl = (u: string) => (u.startsWith("//") ? `https:${u}` : u.startsWith("http") ? u : null);

export class StreamPlayExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  async videosFromUrl(url: string, prefix = ""): Promise<Video[]> {
    const document = (await this.client.get(url, this.headers)).asJsoup();
    return parallelCatchingFlatMap([...document.select("#servers a")], (element) => this.extractAndDecodeFromDocument(element.attr("abs:href"), `${prefix} ${element.text()}`));
  }

  /** Server 3 has issue with playlist compatibility, it only plays the first segment */
  private async extractAndDecodeFromDocument(url: string, prefix: string): Promise<Video[]> {
    const document = (await this.client.get(url, this.headers)).asJsoup();
    const packedScript = document.selectFirst("script:containsData(function(p,a,c,k,e,d))");
    const script = packedScript ? JsUnpacker.unpackAndCombine(packedScript.data()) : document.selectFirst("script:containsData(window.kaken)")?.data(); // For mobile UA, it's non-packed
    const kaken = script && KAKEN_REGEX.exec(script)?.[1];
    if (!kaken) return [];

    const origin = new URL(url).origin;
    const apiHeaders = new Headers(this.headers);
    apiHeaders.append("Accept", "application/json, text/javascript, */*; q=0.01");
    apiHeaders.append("Origin", origin);
    apiHeaders.append("Referer", url);
    apiHeaders.append("X-Requested-With", "XMLHttpRequest");
    apiHeaders.set("Content-Type", "text/plain");
    const apiResponse = (await this.client.post("https://play.streamplay.co.in/api/", apiHeaders, kaken)).parseAs<APIResponse>();

    const subtitleList = (apiResponse.tracks ?? []).map((t) => new Track(t.file, t.label));
    const videoHeaders = new Headers(this.headers);
    videoHeaders.set("Referer", url);
    return parallelCatchingFlatMap(apiResponse.sources, async (source) => {
      const sourceUrl = fixUrl(source.file.replace("master.txt", "master.m3u8"));
      if (sourceUrl == null) return [];
      if (source.type === "hls" && sourceUrl.endsWith("master.m3u8")) {
        return this.playlistUtils.extractFromHls(sourceUrl, { referer: url, subtitleList, videoNameGen: (q) => `${prefix} ${q} (StreamPlay)` });
      }
      return [new Video({ videoUrl: sourceUrl, videoTitle: `${prefix} (StreamPlay) Original`, headers: videoHeaders, subtitleTracks: subtitleList })];
    });
  }
}
