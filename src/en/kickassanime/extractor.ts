// Port of yuzono/anime-extensions src/en/kickassanime/extractors/KickAssAnimeExtractor.kt
import { fromUtf8, hexBytes, toHex, Track, utf8, Video, type HttpClient } from "../../../sdk/index.ts";
import { CryptoAES } from "../../../libs/cryptoaes/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";

interface VideoDto {
  hls?: string;
  dash?: string;
  subtitles?: { name: string; language: string; src: string }[];
}

const httpRegex = /^(https?:)\/\/+/;
const manifestRegex = /manifest":\[0,"(?:https?:)?(\/\/[^"]+)"]/;
const trackRegex = /"language":\[\d+,"([^"]+)"][^}]+?"name":\[\d+,"([^"]+)"][^}]+?"src":\[\d+,"([^"]+)"]/g;

const VIDEO_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

/**
 * https:////host/path → https://host/path (BirdStream), //host/path → https://host/path, /path → https://host/path.
 */
function fixUrl(rawUrl: string, baseUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed.replace(httpRegex, "$1//");
  if (trimmed.startsWith("//")) return `https://${trimmed.substring(2)}`;
  if (trimmed.startsWith("/")) {
    const base = new URL(baseUrl);
    return `${base.protocol}//${base.host}${trimmed}`;
  }
  return trimmed;
}

const isHttpUrl = (url: string) => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

async function sha1sum(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-1", utf8(value))));
}

export class KickAssAnimeExtractor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  private getVideoHeaders(url: string): Headers {
    const host = new URL(url).host;
    const h = new Headers(this.headers);
    h.delete("Referer");
    h.set("Accept", "*/*");
    h.set("Accept-Language", "en-US,en;q=0.9");
    h.set("Origin", `https://${host}`);
    // ponytail: Sec-Fetch-* are forbidden request headers in a browser; the browser sets them itself
    h.set("User-Agent", VIDEO_UA);
    return h;
  }

  async videosFromUrl(url: string, name: string): Promise<Video[]> {
    let finalUrl = url;
    if (url.includes("/vast")) {
      const u = new URL(url);
      u.pathname = "/cat-player/player";
      finalUrl = u.toString();
    }

    const html = (await this.client.get(finalUrl, this.headers)).text();
    const cleanHtml = html.replaceAll("&quot;", '"');

    if (cleanHtml.includes('manifest":[0,"')) return this.parseNewPlayer(cleanHtml, finalUrl, name);
    if (!html.includes("cid: '")) return [];

    const finalHttpUrl = new URL(finalUrl);
    const host = finalHttpUrl.host;
    const mid = name === "DuckStream" ? "mid" : "id";
    const isBird = name === "BirdStream";
    const query = finalHttpUrl.searchParams.get(mid);
    if (query == null) return [];

    const keys: Record<string, string> = {
      VidStreaming: "e13d38099bf562e8b9851a652d2043d3",
      DuckStream: "4504447b74641ad972980a6b8ffd7631",
      BirdStream: "4b14d0ff625163e3c9c7a47926484bf2",
      CatStream: "", // No keys to decrypt
    };
    if (!(name in keys)) return [];
    const key = keys[name];

    const sig = await this.getSignature(html, name, query, key);
    if (sig == null) return [];
    const { signature, timeStamp, route } = sig;
    let sourceUrl = `https://${host}${route}?${mid}=${query}`;
    if (!isBird) sourceUrl += `&e=${timeStamp}`;
    sourceUrl += `&s=${signature}`;

    const reqHeaders = new Headers(this.headers);
    reqHeaders.set("Referer", finalUrl);
    reqHeaders.set("Origin", `https://${host}`);
    const response = (await this.client.get(sourceUrl, reqHeaders)).text();

    const after = response.includes(':"') ? response.substring(response.indexOf(':"') + 2) : response;
    const [encryptedData, ivhex = ""] = (after.includes('"') ? after.substring(0, after.indexOf('"')) : after).replaceAll("\\", "").split(":");

    let videoObject: VideoDto;
    try {
      const decrypted = await CryptoAES.decrypt(encryptedData, utf8(key), hexBytes(ivhex));
      videoObject = JSON.parse(decrypted) as VideoDto;
    } catch {
      return [];
    }

    const videoHeaders = this.getVideoHeaders(finalUrl);
    const playlistUtils = new PlaylistUtils(this.client, videoHeaders);

    const rawSubtitles = (videoObject.subtitles ?? []).map((it) => new Track(fixUrl(it.src, finalUrl), `${it.name} (${it.language})`));
    const subtitles = name === "CatStream" ? await playlistUtils.fixSubtitles(rawSubtitles) : rawSubtitles;

    const hls = videoObject.hls ?? "";
    const playlistUrl = fixUrl(hls || (videoObject.dash ?? ""), finalUrl);

    const rawVideos = !hls.trim()
      ? await playlistUtils.extractFromDash(playlistUrl, (res: string) => `${name} - ${res}`, {
          subtitleList: subtitles,
          mpdHeaders: videoHeaders,
          videoHeaders,
        })
      : await playlistUtils.extractFromHls(playlistUrl, {
          videoNameGen: (q) => `${name} - ${q}`,
          subtitleList: subtitles,
          masterHeaders: videoHeaders,
          videoHeaders,
        });

    return rawVideos.map(
      (it) =>
        new Video({
          videoUrl: it.videoUrl,
          videoTitle: it.videoTitle,
          headers: videoHeaders,
          subtitleTracks: it.subtitleTracks,
          audioTracks: it.audioTracks,
        }),
    );
  }

  private async parseNewPlayer(cleanHtml: string, url: string, name: string): Promise<Video[]> {
    const videoHeaders = this.getVideoHeaders(url);
    const playlistUtils = new PlaylistUtils(this.client, videoHeaders);

    const rawManifestUrl = manifestRegex.exec(cleanHtml)?.[1];
    if (rawManifestUrl == null) return [];
    const manifestUrl = fixUrl(rawManifestUrl, url);

    const subtitles = [...cleanHtml.matchAll(trackRegex)]
      .map(([, lang, subName, rawSubUrl]) => {
        const subUrl = fixUrl(rawSubUrl.replaceAll("\\/", "/"), url);
        return isHttpUrl(subUrl) ? new Track(subUrl, `${subName} (${lang})`) : null;
      })
      .filter((it): it is Track => it != null);

    let rawVideos: Video[];
    try {
      rawVideos = manifestUrl.includes(".m3u8")
        ? await playlistUtils.extractFromHls(manifestUrl, {
            videoNameGen: (q) => `${name} - ${q}`,
            subtitleList: subtitles,
            masterHeaders: videoHeaders,
            videoHeaders,
          })
        : await playlistUtils.extractFromDash(manifestUrl, (q: string) => `${name} - ${q}`, {
            subtitleList: subtitles,
            mpdHeaders: videoHeaders,
            videoHeaders,
          });
    } catch {
      rawVideos = [];
    }

    return rawVideos.map(
      (it) =>
        new Video({
          videoUrl: it.videoUrl,
          videoTitle: it.videoTitle,
          headers: videoHeaders,
          subtitleTracks: it.subtitleTracks,
          audioTracks: it.audioTracks,
        }),
    );
  }

  private async getSignature(html: string, server: string, query: string, key: string) {
    let order: string[];
    if (server === "VidStreaming" || server === "DuckStream") order = ["IP", "USERAGENT", "ROUTE", "MID", "TIMESTAMP", "KEY"];
    else if (server === "BirdStream") order = ["IP", "USERAGENT", "ROUTE", "MID", "KEY"];
    else return null;

    const cidHex = html.substring(html.indexOf("cid: '") + 6);
    const cid = fromUtf8(hexBytes(cidHex.substring(0, cidHex.indexOf("'")))).split("|");
    const timeStamp = String(Math.trunc(Date.now() / 1000) + 60);
    const route = cid[1].replace("player.php", "source.php");

    const parts: Record<string, string> = {
      IP: cid[0],
      USERAGENT: this.headers.get("User-Agent") ?? "",
      ROUTE: route,
      MID: query,
      TIMESTAMP: timeStamp,
      KEY: key,
    };
    return {
      signature: await sha1sum(order.map((it) => parts[it]).join("")),
      timeStamp,
      route,
    };
  }
}
