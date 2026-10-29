// Port of yuzono/anime-extensions src/en/kisskh/SubDecryptor.kt
//
// Each cue's text lines are AES-CBC base64 with one of two fixed key/IV pairs. Upstream writes the SRT to a temp file;
// here it becomes a WebVTT data: URL.
import { aesCbcDecrypt, Base64, fromUtf8, Track, utf8, type HttpClient } from "../../../sdk/index.ts";
import { toWebVtt } from "../../../libs/playlistutils/index.ts";

const CHUNK_REGEX = /^\d+$/m;

const KEY = "AmSmZVcH93UQUezi";
const KEY2 = "8056483646328763";
const IV = [1382367819, 1465333859, 1902406224, 1164854838];
const IV2 = [909653298, 909193779, 925905208, 892483379];

/** Big-endian bytes of each Int. */
const intsToBytes = (ints: number[]) => {
  const bytes = new Uint8Array(ints.length * 4);
  const view = new DataView(bytes.buffer);
  ints.forEach((v, i) => view.setInt32(i * 4, v));
  return bytes;
};

const KEY_IV_PAIRS: [Uint8Array, Uint8Array][] = [
  [utf8(KEY), intsToBytes(IV)],
  [utf8(KEY2), intsToBytes(IV2)],
];

export async function decrypt(encryptedB64: string): Promise<string> {
  if (!encryptedB64.trim()) return "";
  for (const [key, iv] of KEY_IV_PAIRS) {
    try {
      return fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(encryptedB64)));
    } catch {
      // next pair
    }
  }
  return "";
}

export class SubDecryptor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
    private readonly baseUrl: string,
  ) {}

  async getSubtitles(subUrl: string, subLang: string): Promise<Track> {
    const subHeaders = new Headers(this.headers);
    subHeaders.set("Accept", "application/json, text/plain, */*");
    subHeaders.set("Origin", this.baseUrl);
    subHeaders.set("Referer", `${this.baseUrl}/`);

    const subtitleData = (await this.client.get(subUrl, subHeaders)).text();

    const chunks = subtitleData
      .split(CHUNK_REGEX)
      .filter((it) => it.trim())
      .map((it) => it.trim());

    let decryptedCount = 0;
    const cues = await Promise.all(
      chunks.map(async (chunk, index) => {
        const parts = chunk.split(/\r?\n/);
        const lines = await Promise.all(parts.slice(1).map(decrypt));
        decryptedCount += lines.filter((it) => it.trim()).length;
        return `${index + 1}\n${parts[0]}\n${lines.join("\n")}`;
      }),
    );

    if (chunks.length && decryptedCount === 0) throw new Error("Failed to decrypt subtitles: no cues could be decrypted");

    return new Track(`data:text/vtt;charset=utf-8,${encodeURIComponent(toWebVtt(cues.join("\n\n")))}`, subLang);
  }
}
