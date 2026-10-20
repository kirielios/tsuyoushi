// Port of yuzono/anime-extensions src/all/javguru/extractors/MaxStreamExtractor.kt
import { substringAfter, substringBefore, type HttpClient, type Video } from "../../../../sdk/index.ts";
import { PlaylistUtils } from "../../../../libs/playlistutils/index.ts";
import { JsUnpacker } from "../../../../libs/unpacker/index.ts";

export class MaxStreamExtractor {
  private readonly playListUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playListUtils = new PlaylistUtils(client, headers);
  }

  async videoFromUrl(url: string): Promise<Video[]> {
    const document = (await this.client.get(url, this.headers, { ensureSuccess: false })).asJsoup();
    const packed = document.selectFirst("script:containsData(function(p,a,c,k,e,d))")?.data();
    const script = packed ? JsUnpacker.unpackAndCombine(packed) : null;
    if (!script) return [];
    const videoUrl = substringBefore(substringAfter(script, 'file:"'), '"');
    if (!URL.canParse(videoUrl)) return [];
    return this.playListUtils.extractFromHls(videoUrl, { referer: url, videoNameGen: (quality) => `MaxStream: ${quality}` });
  }
}
