// Port of keiyoushi/extensions-source src/id/doujindesu/Decryptor.kt
import type { ChainInterceptor } from "../../../sdk/index.ts";

export interface EncryptedDto {
  _enc_resp_: string;
}

const SALT = "doujindesu-scrapers-cannot-read-this-super-secret-salt-2026-v2";
const HOUR_MS = 3600000;

export class Decryptor {
  constructor(private readonly apiUrlProvider: () => string) {}

  xorInterceptor(): ChainInterceptor {
    return async (chain) => {
      const request = chain.request();
      if (!request.url.includes(this.apiUrlProvider())) return chain.proceed(request);

      const response = await chain.proceed(request);

      const dto = response.parseAs<EncryptedDto>();
      const decryptedJson = this.decrypt(dto._enc_resp_);
      if (decryptedJson == null) throw new Error("Decryption failed");

      return response.withBody(new TextEncoder().encode(decryptedJson));
    };
  }

  // index-*.js
  toSigned32(x: number): number {
    return x | 0;
  }

  wH(e: number): string {
    const t = SALT + "_" + e;
    let a = 0;
    for (let i = 0; i < t.length; i++) a = this.toSigned32((a << 5) - a + t.charCodeAt(i));
    // Kotlin's abs(Int.MIN_VALUE) stays negative
    let l = a !== 0 ? (a === -2147483648 ? a : Math.abs(a)) : 123456789;
    let out = "";
    for (let i = 0; i < 32; i++) {
      l = Number((BigInt(l) * 1664525n + 1013904223n) % 4294967296n);
      out += String.fromCharCode(33 + (l % 93));
    }
    return out;
  }

  lU(): string[] {
    const now = Date.now();
    const t = Math.trunc(now / HOUR_MS);
    return [this.wH(t), this.wH(t - 1), this.wH(t + 1)];
  }

  yre(encryptedHex: string, key: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < encryptedHex.length; i += 2) {
      const chunk = encryptedHex.slice(i, i + 2);
      if (/^[+-]?[0-9a-fA-F]+$/.test(chunk)) bytes.push(parseInt(chunk, 16));
    }
    let d = 42;
    const keyLen = key.length;
    let out = "";
    bytes.forEach((byteVal, idx) => {
      const keyChar = key.charCodeAt(idx % keyLen);
      const k = byteVal ^ keyChar ^ (idx * 13) ^ d;
      out += String.fromCharCode(k & 0xff);
      d = (d + byteVal) % 256;
    });
    return out;
  }

  decrypt(encryptedHex: string): string | null {
    for (const key of this.lU()) {
      try {
        const decoded = this.yre(encryptedHex, key);
        // URLDecoder.decode: "+" is a space, malformed escapes throw
        return decodeURIComponent(decoded.replace(/\+/g, " "));
      } catch {
        // next key
      }
    }
    return null;
  }
}
