// Port of aniyomi lib/streamtapeextractor.
import { Video, type Track } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";

const TARGET_LINE = "document.getElementById('robotlink')";

export class StreamTapeExtractor {
  constructor(private readonly client: HttpClient) {}

  async videoFromUrl(url: string, quality = "Streamtape", subtitleList: Track[] = []): Promise<Video | null> {
    const baseUrl = "https://streamtape.com/e/";
    let newUrl = url;
    if (!url.startsWith(baseUrl)) {
      // ["https", "", "<domain>", "<???>", "<id>", ...]
      const id = url.split("/")[4];
      if (id == null) return null;
      newUrl = baseUrl + id;
    }
    const document = (await this.client.get(newUrl, new Headers(), { ensureSuccess: false })).asJsoup();
    const data = document.select("script").map((s) => s.data()).find((d) => d.includes(TARGET_LINE));
    if (data == null) return null;
    const script = substringAfter(data, `${TARGET_LINE}.innerHTML = '`);
    const videoUrl = "https:" + substringBefore(script, "'") + substringBefore(substringAfter(script, "+ ('xcd"), "'");
    return new Video({ videoUrl, videoTitle: quality, subtitleTracks: subtitleList });
  }

  async videosFromUrl(url: string, quality = "Streamtape", subtitleList: Track[] = []): Promise<Video[]> {
    const video = await this.videoFromUrl(url, quality, subtitleList);
    return video ? [video] : [];
  }
}
