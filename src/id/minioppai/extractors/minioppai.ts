// Port of yuzono/anime-extensions src/id/minioppai/extractors/MiniOppaiExtractor.kt
import { GET, substringAfter as after, substringBefore as before, Track, Video, type HttpClient } from "../../../../sdk/index.ts";
import { JsUnpacker } from "../../../../libs/unpacker/index.ts";

export class MiniOppaiExtractor {
  constructor(private readonly client: HttpClient) {}

  async videosFromUrl(url: string, headers: Headers): Promise<Video[]> {
    const playerDoc = (await this.client.execute(GET(url, headers), true)).asJsoup();
    const packed = playerDoc.selectFirst("script:containsData(eval):containsData(p,a,c,k,e,d)")?.data();
    const scriptData = packed ? JsUnpacker.unpackAndCombine(packed) : null;
    if (!scriptData) return [];

    const baseUrl = `https://${url.split("//")[1].split("/")[0]}`;
    const subs = getItems(scriptData, '"tracks"', baseUrl, (subUrl, label) => new Track(subUrl, label));
    return getItems(scriptData, "sources", baseUrl, (videoUrl, quality) => new Video({ videoUrl, videoTitle: `MiniOppai - ${quality}`, headers, subtitleTracks: subs })).filter(
      (v) => !v.videoUrl.includes("/uploads/unavailable.mp4"),
    );
  }
}

function getItems<T>(data: string, key: string, baseUrl: string, transformer: (url: string, label: string) => T): T[] {
  return before(after(data, `${key}:[`), "]")
    .split("{")
    .slice(1)
    .map((it) => {
      const file = extractKey(it, "file");
      return transformer(file.startsWith("http") ? file : baseUrl + file, extractKey(it, "label"));
    });
}

// the unpacked payload keeps the packer's escaped quotes (\'label\':\'360p\')
const extractKey = (s: string, key: string) =>
  after(before(before(after(s, key), "}"), ","), ":")
    .replace(/\\/g, "")
    .replace(/^["']+|["']+$/g, "");
