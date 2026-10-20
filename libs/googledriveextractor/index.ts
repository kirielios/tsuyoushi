// Port of aniyomi lib/googledriveextractor.
import { Video } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";

const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

export class GoogleDriveExtractor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  private get cookieList() {
    return this.client.cookieJar.loadForRequest("https://drive.google.com");
  }

  async videosFromUrl(itemId: string, videoName = "Video"): Promise<Video[]> {
    const url = `https://drive.usercontent.google.com/download?id=${itemId}`;
    const docHeaders = new Headers(this.headers);
    docHeaders.set("Accept", ACCEPT);
    const cookies = this.cookieList.map((c) => `${c.name}=${c.value}`).join("; ");
    if (cookies) docHeaders.set("Cookie", cookies);

    // ponytail: upstream peeks 15 bytes of a streamed body; the host buffers whole bodies, so the probe asks for one
    // byte (the warning page ignores Range and comes back whole)
    const probeHeaders = new Headers(docHeaders);
    probeHeaders.set("Range", "bytes=0-0");
    const docResp = await this.client.get(url, probeHeaders, { ensureSuccess: false });

    if (docResp.text().slice(0, 15).toLowerCase() !== "<!doctype html>") {
      return [new Video({ videoUrl: url, videoTitle: videoName, headers: docHeaders })];
    }

    const document = docResp.asJsoup();
    const size = document.selectFirst("span.uc-name-size");
    const itemSize = size ? ` ${size.ownText().trim()} ` : "";

    const videoUrl = new URL(url);
    for (const input of document.select("input[type=hidden]")) videoUrl.searchParams.set(input.attr("name"), input.attr("value"));

    return [new Video({ videoUrl: videoUrl.href, videoTitle: videoName + itemSize, headers: docHeaders })];
  }
}
