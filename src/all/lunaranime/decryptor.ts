// Port of keiyoushi/extensions-source src/all/lunaranime/LunarDecryptor.kt
import { Base64, aesCbcDecrypt, extractNextJsFromDocument, utf8, type Document } from "../../../sdk/index.ts";
import { LunarSeedPropsDto, type LunarSeeds } from "./dto.ts";
import type { LunarSerenity } from "./serenity.ts";

export class LunarMintedToken {
  constructor(
    readonly token: string,
    readonly nonce: string,
  ) {}
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NONCE_LENGTH = 12;
const SEPARATOR = "\u0001";
const THUMBPRINT_SEPARATOR = "\u0002";

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text) as BufferSource));
const randomInt = (until: number) => Math.floor(Math.random() * until);
const randomString = (length: number) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const base64Url = (b: Uint8Array) => Base64.encode(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class LunarDecryptor {
  constructor(private readonly serenity: LunarSerenity) {}

  // ============================== Seeds ==============================

  extractSeeds(document: Document): LunarSeeds {
    const props = extractNextJsFromDocument<Record<string, string>>(document, LunarSeedPropsDto.matches);
    const seeds = props != null ? new LunarSeedPropsDto(props).toSeeds() : null;
    if (seeds == null) throw new Error("Failed to find payload seeds");
    return seeds;
  }

  // ============================== Token ==============================

  /**
   * `mint()` in the site's bundle: a timestamped payload naming the chapter, stream-encrypted with a key blended from
   * both seeds. The nonce is folded into the response key, so it has to be kept around for unpack.
   */
  async mint(seeds: LunarSeeds, slug: string, chapter: string): Promise<LunarMintedToken> {
    const key = await this.blend(seeds.axis, seeds.pitch);
    if (!key.length) throw new Error("Failed to derive chapter key");

    const nonce = randomString(NONCE_LENGTH);
    const timestamp = Math.floor(Date.now() / 1000).toString(16);
    const payload = `${timestamp}|${nonce}|${slug}|${chapter}|${randomString(6)}`;

    const offset = randomInt(256);
    const out = [offset];
    for (let i = 0; i < payload.length; i++) out.push((payload.charCodeAt(i) ^ key[(i + offset) % key.length] ^ ((offset + 83 * i) & 0xff)) & 0xff);

    return new LunarMintedToken(base64Url(Uint8Array.from(out)), nonce);
  }

  private async blend(axis: string, pitch: string): Promise<number[]> {
    const digest = await sha256(axis + SEPARATOR + pitch);
    const size = Math.max(axis.length, pitch.length);
    return Array.from({ length: size }, (_, i) => (axis.charCodeAt(i % axis.length) ^ pitch.charCodeAt(i % pitch.length) ^ digest[i % 32] ^ ((83 * i + 29) & 0xff)) & 0xff);
  }

  // ============================= Session =============================

  /**
   * The response body is AES-CBC over a key derived from the first seed, the nonce that was minted with the token,
   * and - when the server enforces it - the Serenity key thumbprint.
   */
  async unpack(sessionData: string, seeds: LunarSeeds, nonce: string): Promise<string> {
    const ciphertext = Base64.decode(sessionData.replace(/-/g, "+").replace(/_/g, "/"));
    const base = seeds.axis + SEPARATOR + nonce;

    for (const material of [base + THUMBPRINT_SEPARATOR + (await this.serenity.thumbprint()), base]) {
      let plaintext: string;
      try {
        plaintext = new TextDecoder().decode(await aesCbcDecrypt(await sha256(material), new Uint8Array(16), ciphertext));
      } catch {
        continue;
      }
      if (plaintext.startsWith("{") || plaintext.startsWith("[")) return plaintext;
    }
    throw new Error("Failed to decrypt chapter session data");
  }
}
