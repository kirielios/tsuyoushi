// Port of yuzono/anime-extensions src/all/javguru/extractors/EmTurboExtractor.kt
import { distinctBy, type HttpClient, type Video } from "../../../../sdk/index.ts";
import { PlaylistUtils } from "../../../../libs/playlistutils/index.ts";

const URLPLAY = /urlPlay\s*=\s*'([^']+)/;

export class EmTurboExtractor {
  private readonly playlistExtractor: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistExtractor = new PlaylistUtils(client, headers);
  }

  async getVideos(url: string): Promise<Video[]> {
    const document = (await this.client.get(url, this.headers, { ensureSuccess: false })).asJsoup();
    const script = document.selectFirst("script:containsData(urlplay)")?.data();
    if (!script) return [];
    const urlPlay = URLPLAY.exec(script)?.[1];
    if (!urlPlay || !URL.canParse(urlPlay)) return [];
    // they have the same stream repeated twice in the playlist file
    return distinctBy(await this.playlistExtractor.extractFromHls(urlPlay, { referer: url, videoNameGen: (quality) => `EmTurboVid: ${quality}` }), (it) => it.videoUrl);
  }
}
