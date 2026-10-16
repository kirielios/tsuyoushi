// Port of aniyomi lib/doodextractor.
import { Video, type Track } from "../../sdk/anime.ts";
import type { HttpClient } from "../../sdk/network.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export class DoodExtractor {
  constructor(private readonly client: HttpClient) {}

  async videoFromUrl(url: string, prefix: string | null = null, redirect = true, externalSubs: Track[] = []): Promise<Video | null> {
    try {
      const response = await this.client.get(url, undefined, { ensureSuccess: false });
      const newUrl = redirect ? response.url : url;
      const doodHost = new URL(newUrl).origin;
      const content = response.text();
      if (!content.includes("'/pass_md5/")) return null;

      const title = content.split("<title>")[1]?.split("</title>")[0] ?? "";
      const extractedQuality = /\d{3,4}p/.exec(title)?.[0];
      const newQuality = [prefix, `Doodstream ${extractedQuality ?? (redirect ? "mirror" : "")}`].filter((s) => s != null).join(" - ");

      const path = /\/pass_md5\/[^']*/.exec(content)?.[0];
      if (!path) return null;
      const md5 = doodHost + path;
      const token = md5.substring(md5.lastIndexOf("/") + 1);
      const randomString = Array.from({ length: 10 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
      const expiry = Date.now();

      const videoUrlStart = (await this.client.get(md5, new Headers({ referer: newUrl }), { ensureSuccess: false })).text();
      const videoUrl = `${videoUrlStart}${randomString}?token=${token}&expiry=${expiry}`;
      return new Video({ videoUrl, videoTitle: newQuality, headers: doodHeaders(doodHost), subtitleTracks: externalSubs });
    } catch {
      return null;
    }
  }

  async videosFromUrl(url: string, quality: string | null = null, redirect = true): Promise<Video[]> {
    const video = await this.videoFromUrl(url, quality, redirect);
    return video ? [video] : [];
  }
}

// Upstream builds "https://$host/" from a host that already carries the scheme; the origin is what Dood checks.
function doodHeaders(origin: string) {
  return new Headers({ "User-Agent": "Aniyomi", Referer: `${origin}/` });
}
