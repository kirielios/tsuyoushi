// Port of aniyomi lib/gdriveplayerextractor.
import { Track, Video } from "../../sdk/anime.ts";
import { aesCbcDecrypt, Base64, evpBytesToKey, fromUtf8, hexBytes, utf8 } from "../../sdk/crypto.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { distinctBy } from "../../sdk/strings.ts";
import { JsUnpacker } from "../unpacker/index.ts";

const PLAYER_NAME = "GDRIVE";
const REGEX_DATAJSON = /data="(\S+?)";/;
const REGEX_PASSWORD = /var pass = "(\S+?)"/;
const REGEX_SOJSON = /null,['|"](\w+)['|"]/;
const REGEX_VIDEOURL = /file":"(\S+?)".*?res=(\d+)/g;

export class GdrivePlayerExtractor {
  constructor(private readonly client: HttpClient) {}

  async videosFromUrl(url: string, name: string, headers: Headers): Promise<Video[]> {
    const newUrl = url.replace(".us", ".to").replace(".me", ".to");
    const response = await this.client.get(newUrl, headers, { ensureSuccess: false });
    const body = response.text();

    const sub = response.asJsoup().selectFirst("div:contains(.srt)");
    const subtitleList = sub ? [new Track(`https://gdriveplayer.to/?subtitle=${sub.text()}`, "Subtitles")] : [];

    const evaluated = unpack(body).replaceAll("\\", "");
    const json = JSON.parse(getFirst(REGEX_DATAJSON, evaluated)) as { s: string; ct: string };
    const sojson = getFirst(REGEX_SOJSON, evaluated)
      .split(/\D+/)
      .filter(Boolean)
      .map((it) => String.fromCharCode(Number(it)))
      .join("");
    const password = getFirst(REGEX_PASSWORD, sojson);
    const decrypted = await decryptWithSalt(json.ct, json.s, password);
    if (!decrypted) return [];

    const secondEval = unpack(decrypted).replaceAll("\\", "");
    return distinctBy([...secondEval.matchAll(REGEX_VIDEOURL)], (m) => m[2]).map((m) => {
      const videoUrl = `https:${m[1]}&res=${m[2]}`;
      return new Video({ videoUrl, videoTitle: `${PLAYER_NAME} ${m[2]}p - ${name}`, subtitleTracks: subtitleList });
    });
  }
}

const unpack = (script: string) => JsUnpacker.unpackAndCombine(script) ?? "";

function getFirst(regex: RegExp, item: string): string {
  const v = regex.exec(item)?.[1];
  if (v == null) throw new Error(`GdrivePlayer: no match for ${regex.source}`);
  return v;
}

/** keiyoushi CryptoAES.decryptWithSalt: CryptoJS AES with a hex salt given apart from the base64 ciphertext; "" on failure. */
async function decryptWithSalt(cipherText: string, salt: string, password: string): Promise<string> {
  try {
    const { key, iv } = evpBytesToKey(utf8(password), hexBytes(salt), 32, 16);
    return fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(cipherText)));
  } catch {
    return "";
  }
}
