// What sources reach for from java.security / javax.crypto / android.util.Base64. AES goes through WebCrypto (async,
// so ports of decrypting code become async); MD5 is not in WebCrypto, hence the small implementation below.

export const utf8 = (s: string) => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export const Base64 = {
  decode(s: string): Uint8Array {
    const bin = atob(s.replace(/[\r\n\s]/g, "").replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
  encode(b: Uint8Array): string {
    let bin = "";
    for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin);
  },
};

export const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) (out.set(p, i), (i += p.length));
  return out;
};

// RFC 1321
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(input: Uint8Array | string): Uint8Array {
  const msg = typeof input === "string" ? utf8(input) : input;
  const len = ((msg.length + 8) >>> 6) * 64 + 64;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(len - 8, (msg.length * 8) >>> 0, true);
  view.setUint32(len - 4, Math.floor(msg.length / 0x20000000), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < len; off += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16);
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16);
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}

/** OpenSSL's EVP_BytesToKey with MD5 (what CryptoJS and many WordPress protectors use): key + iv from a password and salt. */
export function evpBytesToKey(password: Uint8Array, salt: Uint8Array, keyLen = 32, ivLen = 16) {
  const parts: Uint8Array[] = [];
  let prev = new Uint8Array(0);
  let total = 0;
  while (total < keyLen + ivLen) {
    prev = md5(concat(prev, password, salt)) as Uint8Array<ArrayBuffer>;
    parts.push(prev);
    total += prev.length;
  }
  const all = concat(...parts);
  return { key: all.slice(0, keyLen), iv: all.slice(keyLen, keyLen + ivLen) };
}

/** AES/CBC/PKCS7Padding decrypt. */
export async function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, data as BufferSource));
}

/** keiyoushi.utils ByteArray.rc4(key, skip): RC4, discarding `skip` keystream bytes first (symmetric). */
export function rc4(data: Uint8Array, key: Uint8Array, skip = 0): Uint8Array {
  if (key.length < 1 || key.length > 256 || skip < 0) throw new Error("RC4 key must be 1..256 bytes and skip non-negative");
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = data.slice();
  let a = 0;
  let b = 0;
  for (let n = -skip; n < out.length; n++) {
    a = (a + 1) & 0xff;
    b = (b + s[a]) & 0xff;
    [s[a], s[b]] = [s[b], s[a]];
    if (n >= 0) out[n] ^= s[(s[a] + s[b]) & 0xff];
  }
  return out;
}

/** keiyoushi.utils ByteArray.inflate(nowrap): zlib (default) or raw DEFLATE. */
export async function inflate(data: Uint8Array, nowrap = false): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(nowrap ? "deflate-raw" : "deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** javax.crypto.Mac "HmacSHA256": mac.init(SecretKeySpec(key)); mac.doFinal(data). */
export async function hmacSha256(key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", (typeof key === "string" ? utf8(key) : key) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, (typeof data === "string" ? utf8(data) : data) as BufferSource));
}

/**
 * AES/CBC/NoPadding decrypt (trailing bytes short of a block are dropped). WebCrypto only does PKCS7, so a block that
 * decrypts to a full padding block is appended: E(0x10*16 XOR lastBlock), i.e. the first block of CBC-encrypting it.
 */
export async function aesCbcDecryptNoPadding(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const body = data.subarray(0, data.length - (data.length % 16));
  if (!body.length) return new Uint8Array(0);
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
  const last = body.subarray(body.length - 16);
  const pad = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: last as BufferSource }, k, new Uint8Array(16).fill(16))).subarray(0, 16);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, concat(body, pad) as BufferSource));
}
