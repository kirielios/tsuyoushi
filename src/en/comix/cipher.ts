// Port of keiyoushi/extensions-source src/en/comix/Cipher.kt
import { Base64, fromUtf8, utf8 } from "../../../sdk/index.ts";

export interface WebViewCapture {
  payload: string;
  material?: CipherMaterial | null;
}

export interface CipherMaterial {
  sboxes: number[][];
  keys: number[][];
}
export const isValidMaterial = (m: CipherMaterial) => m.sboxes.length === 3 && m.sboxes.every((it) => it.length === 256) && m.keys.length === 3 && m.keys.every((it) => it.length > 0);

export interface EncryptedResponse {
  e: string;
}

const PREVIOUS = [189, 133, 32];

export class ComixCipher {
  private readonly sboxes: number[][];
  private readonly keys: number[][];

  constructor(material: CipherMaterial) {
    this.sboxes = material.sboxes;
    this.keys = material.keys;
    if (!isValidMaterial(material)) throw new Error("Invalid Comix cipher material");
  }

  sign(path: string, query: string): string {
    let data: Uint8Array = utf8((path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path) + (query ? `?${query}` : ""));
    for (let round = 0; round < 3; round++) data = this.substitute(data, this.sboxes[round], this.keys[round], PREVIOUS[round]);
    // Base64.URL_SAFE or NO_WRAP or NO_PADDING
    return Base64.encode(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  decrypt(value: string): string {
    let data: Uint8Array = Base64.decode(value);
    for (let round = 2; round >= 0; round--) data = this.substituteInverse(data, this.sboxes[round], this.keys[round], PREVIOUS[round]);
    return fromUtf8(data);
  }

  private substitute(data: Uint8Array, sbox: number[], key: number[], previous: number): Uint8Array {
    const output = new Uint8Array(data.length);
    let prev = previous;
    data.forEach((b, index) => {
      const substituted = sbox[b ^ key[index % key.length] ^ prev];
      output[index] = substituted;
      prev = substituted;
    });
    return output;
  }

  private substituteInverse(data: Uint8Array, sbox: number[], key: number[], previous: number): Uint8Array {
    const inverse = new Array<number>(256).fill(0);
    sbox.forEach((v, i) => (inverse[v] = i));
    const output = new Uint8Array(data.length);
    let prev = previous;
    data.forEach((value, index) => {
      output[index] = inverse[value] ^ key[index % key.length] ^ prev;
      prev = value;
    });
    return output;
  }
}
