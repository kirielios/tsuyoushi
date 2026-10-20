// Port of yuzono/anime-extensions src/all/animeworldindia/MyStreamExtractor.kt
import { GET, substringAfter, substringBefore, type HttpClient, type Video } from "../../../sdk/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";

export class MyStreamExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  async videosFromUrl(url: string, language: string): Promise<Video[]> {
    const host = substringBefore(url, "/watch");
    try {
      const response = await this.client.execute(GET(url, this.headers));
      const body = response.text();
      const streamCode = substringBefore(substringAfter(substringAfter(body, "sniff("), ', "'), '"');
      const streamUrl = `${host}/m3u8/${streamCode}/master.txt?s=1&cache=1`;
      const cookie = /PHPSESSID=[^;,]*/i.exec(response.header("set-cookie") ?? "")?.[0] ?? "";
      const newHeaders = new Headers(this.headers);
      newHeaders.set("cookie", cookie);
      newHeaders.set("accept", "*/*");
      return this.playlistUtils.extractFromHls(streamUrl, { masterHeaders: newHeaders, videoHeaders: newHeaders, videoNameGen: (q) => `[${language}] MyStream: ${q}` });
    } catch {
      return [];
    }
  }
}
