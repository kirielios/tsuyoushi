// Port of aniyomi lib/youruploadextractor.
import { Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";

export class YourUploadExtractor {
  constructor(private readonly client: HttpClient) {}

  async videoFromUrl(url: string, headers: Headers, name = "YourUpload", prefix = ""): Promise<Video[]> {
    const newHeaders = new Headers(headers);
    newHeaders.set("referer", "https://www.yourupload.com/");
    try {
      const document = (await this.client.get(url, newHeaders)).asJsoup();
      const baseData = document.selectFirst("script:containsData(jwplayerOptions)")?.data();
      if (!baseData) return [];
      const basicUrl = substringBefore(substringAfter(baseData, "file: '"), "',");
      return [new Video({ videoUrl: basicUrl, videoTitle: prefix + name, headers: newHeaders })];
    } catch {
      return [];
    }
  }
}
