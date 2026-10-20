// Port of yuzono/anime-extensions src/all/animexin/extractors/VidstreamingExtractor.kt
import { aesCbcDecrypt, Base64, fromUtf8, GET, utf8, Video, type HttpClient } from "../../../../sdk/index.ts";

export class VidstreamingExtractor {
  constructor(private readonly client: HttpClient) {}

  async videosFromUrl(serverUrl: string, prefix: string): Promise<Video[]> {
    try {
      const document = (await this.client.get(serverUrl)).asJsoup();
      const digits = (selector: string, attr: string, after: string) => {
        const v = document.select(selector).attr(attr);
        const i = v.indexOf(after);
        return utf8((i === -1 ? v : v.slice(i + after.length)).replace(/\D/g, ""));
      };
      const iv = digits("div.wrapper", "class", "container-");
      const secretKey = digits("body[class]", "class", "container-");
      const decryptionKey = digits("div.videocontent", "class", "videocontent-");
      const params = await decrypt(document.select("script[data-value]").attr("data-value"), iv, secretKey);
      const encryptAjaxParams = params.slice(params.indexOf("&") + 1);

      const httpUrl = new URL(serverUrl);
      const host = `https://${httpUrl.host}/`;
      const id = httpUrl.searchParams.get("id");
      if (!id) throw new Error("error getting id");
      const encryptedId = await encrypt(id, iv, secretKey);
      const qualitySuffix = httpUrl.searchParams.get("token") != null ? " (Vid-mp4 - Gogostream)" : " (Vid-mp4 - Vidstreaming)";

      const jsonResponse = (await this.client.execute(GET(`${host}encrypt-ajax.php?id=${encryptedId}&${encryptAjaxParams}&alias=${id}`, new Headers({ "X-Requested-With": "XMLHttpRequest" })))).parseAs<{ data: string }>();
      const decrypted = JSON.parse(await decrypt(jsonResponse.data, iv, decryptionKey)) as { source: { file: string; label?: string; type?: string }[] };
      const array = decrypted.source;
      const videoList: Video[] = [];
      const autoList: Video[] = [];
      if (array.length === 1 && array[0].type === "hls") {
        // ponytail: the master playlist is handed to hls.js whole instead of split per variant (as playlistutils does).
        videoList.push(new Video({ videoUrl: array[0].file, videoTitle: `${prefix}Auto${qualitySuffix}` }));
      } else {
        for (const it of array) {
          const label = (it.label ?? "").toLowerCase().replace(/ /g, "");
          const video = new Video({ videoUrl: it.file, videoTitle: label + qualitySuffix, headers: new Headers({ Referer: serverUrl }) });
          (label === "auto" ? autoList : videoList).push(video);
        }
      }
      const q = (v: Video) => Number.parseInt(v.videoTitle.split(qualitySuffix)[0].split("p")[0]) || -1;
      return [...videoList.sort((a, b) => q(b) - q(a)), ...autoList];
    } catch {
      return [];
    }
  }
}

async function decrypt(s: string, iv: Uint8Array, key: Uint8Array) {
  return fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(s)));
}

async function encrypt(s: string, iv: Uint8Array, key: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt"]);
  return Base64.encode(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, utf8(s) as BufferSource)));
}
