// Port of yuzono/anime-extensions src/all/chineseanime/extractors/VatchusExtractor.kt
import { Base64, fromUtf8, GET, substringAfter, substringBefore, Track, type HttpClient, type Video } from "../../../../sdk/index.ts";
import { PlaylistUtils } from "../../../../libs/playlistutils/index.ts";

export class VatchusExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  async videosFromUrl(url: string, prefix: string): Promise<Video[]> {
    const doc = (await this.client.execute(GET(url, this.headers))).asJsoup();
    const script = doc.select("script").map((s) => s.data()).find((d) => d.includes("document.write"));
    if (!script) return [];

    const numberList = substringBefore(substringAfter(script, " = ["), "];")
      .replace(/"/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => fromUtf8(Base64.decode(s)))
      .map((s) => Number.parseInt(s.replace(/\D/g, "")))
      .filter((n) => !Number.isNaN(n));

    const offset = numberList[0] - 60;
    const decodedData = numberList.map((n) => String.fromCharCode(n - offset)).join("").trim();

    const playlistUrl = substringBefore(substringAfter(decodedData, "file:'"), "'");
    const subs = substringBefore(substringAfter(decodedData, "tracks:["), "]")
      .split("{")
      .slice(1)
      .filter((it) => it.includes('"kind":"captions"'))
      .flatMap((it) => {
        const trackUrl = substringBefore(substringAfter(it, 'file":"'), '"');
        if (!trackUrl.startsWith("http")) return [];
        return [new Track(trackUrl, substringBefore(substringAfter(it, 'label":"'), '"'))];
      });

    return this.playlistUtils.extractFromHls(playlistUrl, { referer: url, subtitleList: subs, videoNameGen: (q) => prefix + q });
  }
}
