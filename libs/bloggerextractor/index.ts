// Port of aniyomi lib/bloggerextractor: the page's "streams" list, else the batchexecute RPC.
import { Video } from "../../sdk/anime.ts";
import { POST } from "../../sdk/httpsource.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";

const BLOGGER_BASE = "https://www.blogger.com/";
const QUALITY: Record<string, string> = { "7": "240p", "18": "360p", "22": "720p", "37": "1080p" };
const quality = (format: string) => QUALITY[format] ?? "Unknown";

export class BloggerExtractor {
  constructor(private readonly client: HttpClient) {}

  async videosFromUrl(url: string, headers: Headers, suffix = ""): Promise<Video[]> {
    const body = (await this.client.get(url, headers, { ensureSuccess: true })).text();
    const stream = this.streamVideos(body, headers, suffix);
    return stream.length ? stream : this.rpcVideos(url, body, headers, suffix);
  }

  private streamVideos(body: string, headers: Headers, suffix: string): Video[] {
    if (body.includes("errorContainer")) return [];
    return substringBefore(substringAfter(body, '"streams":[', ""), "]")
      .split("},")
      .flatMap((it) => {
        const videoUrl = substringBefore(substringAfter(it, '"play_url":"'), '"');
        if (!videoUrl.trim()) return [];
        const format = substringBefore(substringAfter(it, '"format_id":'), "}");
        return [new Video({ videoUrl, videoTitle: `Blogger - ${quality(format)} ${suffix}`.trimEnd(), headers })];
      });
  }

  private async rpcVideos(url: string, body: string, headers: Headers, suffix: string): Promise<Video[]> {
    const token = new URL(url).searchParams.get("token");
    if (!token?.trim()) return [];
    const rpcUrl = new URL("_/BloggerVideoPlayerUi/data/batchexecute", BLOGGER_BASE);
    for (const [k, v] of [
      ["rpcids", "WcwnYd"],
      ["source-path", "/video.g"],
      ["f.sid", substringBefore(substringAfter(body, 'FdrFJe":"'), '"')],
      ["bl", substringBefore(substringAfter(body, 'cfb2h":"'), '"')],
      ["hl", "en-US"],
      ["_reqid", String(Math.floor(Date.now() / 1000) % 86400)],
      ["rt", "c"],
    ])
      rpcUrl.searchParams.append(k, v);
    const rpcBody = `f.req=%5B%5B%5B%22WcwnYd%22%2C%22%5B%5C%22${token}%5C%22%2C%5C%22%5C%22%2C0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&`;
    const rpcHeaders = new Headers({
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "x-same-domain": "1",
      "User-Agent": headers.get("User-Agent") ?? "",
      Referer: BLOGGER_BASE,
    });
    const rpc = (await this.client.execute(POST(rpcUrl, rpcHeaders, rpcBody, "application/x-www-form-urlencoded;charset=UTF-8"), true)).text();
    if (!rpc.includes("https://")) return [];
    return `\\"${substringBefore(substringAfter(rpc, '[[\\"', ""), "]]]")}]`
      .split("],[")
      .flatMap((it) => {
        const raw = substringBefore(substringAfter(it, '\\"', ""), '\\"');
        const videoUrl = raw.trim() ? decodeDoubleEscapedJson(raw) : null;
        if (!videoUrl) return [];
        const format = substringBefore(substringAfter(it, "["), "]");
        return [new Video({ videoUrl, videoTitle: `Blogger - ${quality(format)} ${suffix}`.trimEnd(), headers })];
      });
  }
}

/** The RPC wraps URLs in double-escaped JSON strings: two decoding passes. */
function decodeDoubleEscapedJson(value: string): string | null {
  try {
    return JSON.parse(`"${JSON.parse(`"${value}"`) as string}"`) as string;
  } catch {
    return null;
  }
}
