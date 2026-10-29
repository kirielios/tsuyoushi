// Port of yuzono/anime-extensions src/en/animekhor/extractors/VidaraExtractor.kt
import { Track, type HttpClient, type Video } from "../../../../sdk/index.ts";
import { PlaylistUtils } from "../../../../libs/playlistutils/index.ts";

const FILECODE_REGEX = /\/[ev]\/([a-zA-Z0-9]+)/;
const ORIGIN_REGEX = /MIRROR_ORIGIN\s*=\s*['"]([^'"]+)/;

interface VidaraResponse {
  streaming_url?: string | null;
  subtitles?: { file_path?: string | null; language?: string | null }[] | null;
}

export class VidaraExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  async videosFromUrl(url: string, prefix = ""): Promise<Video[]> {
    const filecode = FILECODE_REGEX.exec(url)?.[1];
    if (filecode == null) return [];

    let defaultOrigin: string;
    try {
      defaultOrigin = new URL(url).origin;
    } catch {
      defaultOrigin = url.includes("vidara.to") ? "https://vidara.to" : "https://vidvara.fit";
    }
    let origin = defaultOrigin;
    try {
      const script = (await this.client.get(url)).asJsoup().selectFirst("script:containsData(MIRROR_ORIGIN)")?.data() ?? "";
      origin = ORIGIN_REGEX.exec(script)?.[1] ?? defaultOrigin;
    } catch {
      // keep the default
    }

    const requestHeaders = new Headers(this.headers);
    requestHeaders.set("Referer", url);
    requestHeaders.set("Origin", origin);
    requestHeaders.set("Content-Type", "application/json; charset=utf-8");
    const response = (await this.client.post(`${origin}/api/stream`, requestHeaders, JSON.stringify({ filecode, device: "web" }))).parseAs<VidaraResponse>();

    const streamingUrl = response.streaming_url;
    if (!streamingUrl) return [];
    const subtitles = (response.subtitles ?? []).flatMap((it) => (it.file_path?.trim() && it.language?.trim() ? [new Track(it.file_path, it.language)] : []));
    return this.playlistUtils.extractFromHls(streamingUrl, { referer: `${origin}/`, subtitleList: subtitles, videoNameGen: (it) => `${prefix}${it}` });
  }
}
