// StreamRuby (rubyvidhub.com): the /e/<code> page is a click-to-play form; posting it to /dl returns an XFileSharing
// player whose packed script holds the HLS master playlist.
import { Video } from "../../../../sdk/anime.ts";
import type { HttpClient } from "../../../../sdk/network.ts";
import { autoUnpacker } from "../../../../libs/unpacker/index.ts";

const M3U8 = /https?:\/\/[^"']+\.m3u8[^"']*/;

export async function streamRubyVideos(client: HttpClient, url: string, headers: Headers, title: string): Promise<Video[]> {
  const code = new URL(url).pathname.replace(/\.html?$/, "").split("/").pop()!.split("-").pop()!;
  const origin = new URL(url).origin;
  const h = new Headers(headers);
  h.set("Referer", url);
  h.set("Origin", origin);
  const body = new URLSearchParams({ op: "embed", file_code: code, auto: "1", referer: headers.get("Referer") ?? "" });
  const html = (await client.post(`${origin}/dl`, h, body)).text();
  const packed = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/.exec(html)?.[0];
  const videoUrl = M3U8.exec((packed && autoUnpacker(packed)) || html)?.[0];
  const videoHeaders = new Headers(headers);
  videoHeaders.set("Referer", `${origin}/`);
  videoHeaders.set("Origin", origin);
  return videoUrl ? [new Video({ videoUrl, videoTitle: title, headers: videoHeaders })] : [];
}
