// Port of yuzono/anime-extensions src/id/neonime/extractors/LinkBoxExtractor.kt
import { GET, Video, type HttpClient } from "../../../../sdk/index.ts";

type LinkBoxResponse = { data?: { rList?: { url: string; resolution: string }[] } };

export class LinkBoxExtractor {
  constructor(private readonly client: HttpClient) {}

  async videosFromUrl(url: string, name: string): Promise<Video[]> {
    const id = url.includes("/file/") ? url.split("/file/")[1] : url.slice(url.indexOf("?id=") + 4);
    const response = (await this.client.execute(GET(`https://www.linkbox.to/api/open/get_url?itemId=${id}`))).parseAs<LinkBoxResponse>();
    return response.data!.rList!.map((it) => new Video({ videoUrl: it.url, videoTitle: `${it.resolution} - ${name}` }));
  }
}
