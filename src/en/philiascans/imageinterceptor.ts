// Port of keiyoushi/extensions-source src/en/philiascans/ImageInterceptor.kt
import { Base64, Canvas, hexBytes, hmacSha256, imageSize, toHttpUrl, utf8, type Chain, type Host, type Response } from "../../../sdk/index.ts";

const AES_MAGIC = hexBytes("ff02");
const CHACHA_MAGIC = hexBytes("ff03");
const AES4_MAGIC = hexBytes("ff04");
const SCRAMBLED = /^.*_s\.[^.]+$/s;

/** Buffered stand-ins for okio's streaming Source wrappers: the whole page is already in memory. */
export async function imageInterceptor(host: Host, chain: Chain): Promise<Response> {
  const request = chain.request();
  const response = await chain.proceed(request);
  const url = toHttpUrl(request.url);
  const fragment = url.fragment;

  if (!fragment || !response.isSuccessful || !SCRAMBLED.test(url.pathSegments.at(-1)!)) return response;

  const parts = splitLimit(fragment, ";", 7);
  const [isScrambled, mimeType, chapterKeyB64, gridSize, payloadA] = parts;
  const payloadB = parts[5];
  const pageIndex = Number.parseInt(parts[6], 10);

  let chapterKey: Uint8Array;
  if (payloadA !== "null" && payloadA.trim() && payloadB !== "null" && payloadB.trim()) {
    const a = decodeBase64(payloadA);
    const b = decodeBase64(payloadB);
    if (!a || !b) return response;
    chapterKey = Uint8Array.from({ length: 32 }, (_, i) => a[i] ^ b[i]);
  } else {
    const k = decodeBase64(chapterKeyB64);
    if (!k) return response;
    chapterKey = k;
  }

  const source = response.bytes();
  if (source.length < 2) return response;
  const isAesScheme = source[0] === AES_MAGIC[0] && source[1] === AES_MAGIC[1];
  const isChachaScheme = source[0] === CHACHA_MAGIC[0] && source[1] === CHACHA_MAGIC[1];
  const isAes4Scheme = source[0] === AES4_MAGIC[0] && source[1] === AES4_MAGIC[1];
  const hasSchemeMagic = isAesScheme || isChachaScheme || isAes4Scheme;
  if (source.length < (hasSchemeMagic ? 6 : 4)) return response;
  let pos = hasSchemeMagic ? 2 : 0;

  const header = new DataView(source.buffer, source.byteOffset + pos, 4);
  const originalWidth = header.getUint16(0, false);
  const originalHeight = header.getUint16(2, false);
  pos += 4;
  const rest = source.subarray(pos);

  let plain: Uint8Array;
  if (isAes4Scheme) plain = await aesCtr(rest, chapterKey, pageIndex, "aesctr4:");
  else if (isChachaScheme) plain = chacha20Xor(rest, await hmacSha256(chapterKey, utf8(`cc:${pageIndex}`)));
  else if (isAesScheme) plain = await aesCtr(rest, chapterKey, pageIndex, "aesctr:");
  else plain = await xorKeystream(rest, chapterKey, pageIndex);

  if (isScrambled !== "1" || isChachaScheme || isAes4Scheme) return response.withBody(plain);

  const bitmap = await imageSize(host, plain);
  const result = await unscramble(host, plain, bitmap, chapterKey, pageIndex, Number.parseInt(gridSize, 10), originalWidth, originalHeight, mimeType);
  return response.withBody(result);
}

/** Kotlin's String.split(delimiter, limit): at most `limit` parts, the last keeping the rest. */
function splitLimit(s: string, d: string, limit: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (out.length < limit - 1) {
    const i = rest.indexOf(d);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + d.length);
  }
  out.push(rest);
  return out;
}

/** okio's String.decodeBase64(): null when invalid. */
function decodeBase64(s: string): Uint8Array | null {
  try {
    return Base64.decode(s);
  } catch {
    return null;
  }
}

async function unscramble(
  host: Host,
  bytes: Uint8Array,
  bitmap: { width: number; height: number },
  chapterKey: Uint8Array,
  pageIndex: number,
  gridSize: number,
  originalWidth: number,
  originalHeight: number,
  mimeType: string,
): Promise<Uint8Array> {
  const tileWidth = Math.floor(bitmap.width / gridSize);
  const tileHeight = Math.floor(bitmap.height / gridSize);
  const gridSizeSq = gridSize * gridSize;
  const c = Array.from({ length: gridSizeSq }, (_, i) => i);

  if (gridSizeSq >= 2) {
    const tilesSig = await hmacSha256(chapterKey, utf8(`tiles:${pageIndex}`));
    let nCounter = 0;
    let rBuf: DataView | null = null;
    let aIndex = 8;

    const nextRandom = async (): Promise<number> => {
      if (aIndex >= 8) {
        const d = await hmacSha256(tilesSig, utf8(`perm:${nCounter++}`));
        rBuf = new DataView(d.buffer, d.byteOffset, d.byteLength);
        aIndex = 0;
      }
      return rBuf!.getUint32(aIndex++ * 4, true);
    };

    for (let idx = gridSizeSq - 1; idx >= 1; idx--) {
      const swapIdx = (await nextRandom()) % (idx + 1);
      const temp = c[idx];
      c[idx] = c[swapIdx];
      c[swapIdx] = temp;
    }
  }

  const w = new Array<number>(gridSizeSq);
  for (let i = 0; i < gridSizeSq; i++) w[c[i]] = i;

  const canvas = new Canvas(host, originalWidth, originalHeight);
  for (let t = 0; t < gridSizeSq; t++) {
    const srcIdx = w[t];
    const srcX = (srcIdx % gridSize) * tileWidth;
    const srcY = Math.floor(srcIdx / gridSize) * tileHeight;
    const dstX = (t % gridSize) * tileWidth;
    const dstY = Math.floor(t / gridSize) * tileHeight;
    canvas.drawImage(bytes, srcX, srcY, tileWidth, tileHeight, dstX, dstY);
  }

  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return canvas.encode("jpeg", 90);
    case "image/png":
      return canvas.encode("png", 100);
    default:
      return canvas.encode("webp", 100);
  }
}

async function aesCtr(data: Uint8Array, chapterKey: Uint8Array, pageIndex: number, prefix: string): Promise<Uint8Array> {
  const derivedKey = await hmacSha256(chapterKey, utf8(`${prefix}${pageIndex}`));
  const key = await crypto.subtle.importKey("raw", derivedKey as BufferSource, { name: "AES-CTR" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CTR", counter: new Uint8Array(16), length: 128 }, key, data as BufferSource));
}

async function xorKeystream(data: Uint8Array, chapterKey: Uint8Array, pageIndex: number): Promise<Uint8Array> {
  const out = new Uint8Array(data.length);
  for (let block = 0; block * 32 < data.length; block++) {
    const hash = await hmacSha256(chapterKey, utf8(`page:${pageIndex}:${block}`));
    const end = Math.min(data.length, block * 32 + 32);
    for (let i = block * 32; i < end; i++) out[i] = data[i] ^ hash[i - block * 32];
  }
  return out;
}

function chacha20Xor(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  const nonce = new Uint8Array(12);
  for (let counter = 0; counter * 64 < data.length; counter++) {
    const block = chacha20Block(key, nonce, counter);
    const end = Math.min(data.length, counter * 64 + 64);
    for (let i = counter * 64; i < end; i++) out[i] = data[i] ^ block[i - counter * 64];
  }
  return out;
}

const rotl = (v: number, n: number) => (v << n) | (v >>> (32 - n));

function chacha20Block(key: Uint8Array, nonce: Uint8Array, counter: number): Uint8Array {
  const kv = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const nv = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const state = new Int32Array(16);
  state[0] = 0x61707865;
  state[1] = 0x3320646e;
  state[2] = 0x79622d32;
  state[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) state[4 + i] = kv.getInt32(i * 4, true);
  state[12] = counter;
  state[13] = nv.getInt32(0, true);
  state[14] = nv.getInt32(4, true);
  state[15] = nv.getInt32(8, true);

  const working = state.slice();
  const quarterRound = (a: number, b: number, c: number, d: number) => {
    working[a] += working[b];
    working[d] = rotl(working[d] ^ working[a], 16);
    working[c] += working[d];
    working[b] = rotl(working[b] ^ working[c], 12);
    working[a] += working[b];
    working[d] = rotl(working[d] ^ working[a], 8);
    working[c] += working[d];
    working[b] = rotl(working[b] ^ working[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    quarterRound(0, 4, 8, 12);
    quarterRound(1, 5, 9, 13);
    quarterRound(2, 6, 10, 14);
    quarterRound(3, 7, 11, 15);
    quarterRound(0, 5, 10, 15);
    quarterRound(1, 6, 11, 12);
    quarterRound(2, 7, 8, 13);
    quarterRound(3, 4, 9, 14);
  }

  const block = new Uint8Array(64);
  const bv = new DataView(block.buffer);
  for (let i = 0; i < 16; i++) bv.setInt32(i * 4, (working[i] + state[i]) | 0, true);
  return block;
}
