// Port of keiyoushi/extensions-source lib/e4p/XebpDecoder.kt
//
// XEBP watermark remover
// Watermark also contains a barcode to identify the user.
// WASM xebp_render = f_sn
// master key from pbexSeed WASM func f_pn
//
// compositePatch: upstream decodes the WebP into an Android Bitmap, paints the TIFF patch over its top-left corner
// and re-encodes a WebP. There is no WebP codec here, so the result is an SVG that stacks the original WebP and the
// patch (encoded as PNG) as embedded data: images - no scripts, no external references.
import { Base64, concat, hexBytes, toHex } from "../../sdk/crypto.ts";
import { Argb8888, TiffDecoder, readIntLE } from "./tiffDecoder.ts";

export class XebpContext {
  constructor(
    readonly iv: Uint8Array,
    readonly contentId: string,
    readonly consumerId: Uint8Array,
    readonly pbexSeed: Uint8Array,
  ) {}
}

// WASM data offset 128708
const XXTEA_KEY = hexBytes("6ca87b0fa8513e36165347af5de51989");

// TIFF little-endian magic "II*\x00", must appear after tfix decrypt
const TIFF_MAGIC_LE = [0x49, 0x49, 0x2a, 0x00];

const require = (cond: boolean, msg: () => string) => {
  if (!cond) throw new Error(msg());
};
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);
const writeIntLE = (b: Uint8Array, o: number, v: number) => new DataView(b.buffer, b.byteOffset).setInt32(o, v, true);

interface Container {
  vp8RiffAsWebp: Uint8Array;
  zstr: Uint8Array;
  tfix: Uint8Array;
}

// WASM f_sn XXTEA decrypt + nonce extraction
interface ZstrMeta {
  version: number;
  nonce: Uint8Array;
  xorLen: number;
}

export const XebpDecoder = {
  async decrypt(xebpBytes: Uint8Array, ctx: XebpContext): Promise<{ bytes: Uint8Array; contentType: string }> {
    const container = parseContainer(xebpBytes);
    const zstrMeta = parseZstr(container.zstr);
    const perImageKey = Uint8Array.from({ length: 32 }, (_, it) => ctx.pbexSeed[16 + it] ^ ctx.iv[it]);

    // WASM f_ln(c+80, ..., 1821454, ...)
    const tfix = container.tfix;
    const xorLen = Math.min(zstrMeta.xorLen, tfix.length);
    for (let i = 0; i < xorLen; i++) tfix[i] ^= 0x11;
    const tiffBytes = XebpDecoder.chaCha8Decrypt(tfix, perImageKey, zstrMeta.nonce, zstrMeta.xorLen);

    if (!TIFF_MAGIC_LE.every((b, i) => tiffBytes[i] === b)) {
      throw new Error(`tfix did not decrypt to TIFF (expected II*\\0, got ${toHex(tiffBytes.slice(0, 4))})`);
    }

    const patch = TiffDecoder.decode(tiffBytes);
    return compositePatch(container.vp8RiffAsWebp, patch);
  },

  // ChaCha8 (8 rounds, 64-byte keystream block)
  chaCha8Decrypt(data: Uint8Array, key: Uint8Array, nonce: Uint8Array, initialCounter = 0): Uint8Array {
    require(key.length === 32, () => `ChaCha8 key must be 32 bytes, got ${key.length}`);
    require(nonce.length === 8, () => `ChaCha8 nonce must be 8 bytes, got ${nonce.length}`);

    const state = new Int32Array(16);
    state[0] = 0x61707865; // "expa"
    state[1] = 0x3320646e; // "nd 3"
    state[2] = 0x79622d32; // "2-by"
    state[3] = 0x6b206574; // "te k"
    for (let i = 0; i < 8; i++) state[4 + i] = readIntLE(key, i * 4);
    state[14] = readIntLE(nonce, 0);
    state[15] = readIntLE(nonce, 4);

    const out = new Uint8Array(data.length);
    const work = new Int32Array(16);
    let counter = initialCounter;
    let pos = 0;
    while (pos < data.length) {
      state[12] = counter % 0x100000000;
      state[13] = Math.floor(counter / 0x100000000);
      work.set(state);
      for (let r = 0; r < 4; r++) {
        // column rounds
        qround(work, 0, 4, 8, 12);
        qround(work, 1, 5, 9, 13);
        qround(work, 2, 6, 10, 14);
        qround(work, 3, 7, 11, 15);
        // diagonal rounds
        qround(work, 0, 5, 10, 15);
        qround(work, 1, 6, 11, 12);
        qround(work, 2, 7, 8, 13);
        qround(work, 3, 4, 9, 14);
      }
      for (let i = 0; i <= 15; i++) work[i] += state[i];

      const blockLen = Math.min(64, data.length - pos);
      for (let i = 0; i < blockLen; i++) {
        const ks = (work[i >>> 2] >>> ((i & 3) << 3)) & 0xff;
        out[pos + i] = data[pos + i] ^ ks;
      }
      pos += blockLen;
      counter++;
    }
    return out;
  },
};

function parseContainer(xebp: Uint8Array): Container {
  require(xebp.length >= 20, () => `XEBP too small: ${xebp.length}`);
  require(latin1(xebp.subarray(0, 4)) === "RIFF", () => "XEBP missing RIFF magic");

  // Skip RIFF + size; next 4 bytes are WEBP
  // Then chunks: 4 fourcc + 4 size + payload (padded to even)
  let off = 12;
  let vp8Start = -1;
  let vp8Len = -1;
  let zstrStart = -1;
  let zstrLen = -1;
  let tfixStart = -1;
  let tfixLen = -1;
  while (off + 8 <= xebp.length) {
    const fourCC = latin1(xebp.subarray(off, off + 4));
    const size = readIntLE(xebp, off + 4);
    const payloadStart = off + 8;
    switch (fourCC) {
      case "VP8 ":
      case "VP8L":
      case "VP8X":
        vp8Start = off;
        vp8Len = size;
        break;
      case "ZSTR":
        zstrStart = payloadStart;
        zstrLen = size;
        break;
      case "tfix":
        tfixStart = payloadStart;
        tfixLen = size;
        break;
    }
    off = payloadStart + size + (size & 1); // padded to even
  }

  require(zstrStart >= 0 && tfixStart >= 0, () => "XEBP missing ZSTR or tfix chunk");

  let vp8RiffAsWebp = new Uint8Array(0);
  if (vp8Start >= 0) {
    const vp8ChunkEnd = vp8Start + 8 + vp8Len + (vp8Len & 1);
    vp8RiffAsWebp = xebp.slice(0, vp8ChunkEnd);
    writeIntLE(vp8RiffAsWebp, 4, vp8ChunkEnd - 8);
    vp8RiffAsWebp.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  }

  return {
    vp8RiffAsWebp,
    zstr: xebp.slice(zstrStart, zstrStart + zstrLen),
    tfix: xebp.slice(tfixStart, tfixStart + tfixLen),
  };
}

// "1\n77\nae1e76f1a91981cab70e07c2"  -> xorLen = 77^65 = 12, 3 u32s
// "1\n112\n9126b48ac09943af1286dc18" -> xorLen = 112^65 = 49, 3 u32s
function parseZstr(zstr: Uint8Array): ZstrMeta {
  const text = latin1(zstr).replace(/\u0000+$/, "");
  const lines = text.split("\n");
  require(lines.length >= 3, () => `ZSTR too few lines: ${lines.length}`);

  const version = Number.parseInt(lines[0].trim(), 10);
  require(version === 1, () => `Unsupported ZSTR version: ${version}`);

  const rawCount = Number.parseInt(lines[1].trim(), 10);
  require(!Number.isNaN(rawCount), () => `ZSTR count is not a number: ${lines[1]}`);
  const xorLen = (rawCount ^ 65) & 0xffff;

  const encryptedHex = lines[2].trim();
  require(encryptedHex.length % 8 === 0 && encryptedHex.length > 0, () => `ZSTR encrypted hex must encode whole uint32s, got length ${encryptedHex.length}`);
  const countU32 = encryptedHex.length / 8;
  require(countU32 >= 2, () => `ZSTR needs at least 2 uint32s, got ${countU32}`);

  const encrypted = hexBytes(encryptedHex);
  const u32s = new Int32Array(countU32);
  for (let i = 0; i < countU32; i++) u32s[i] = readIntLE(encrypted, i * 4);

  xxteaDecrypt(u32s, XXTEA_KEY);

  // Last uint32 is the real byte length; first N bytes are the nonce
  const realLen = u32s[countU32 - 1];
  require(realLen >= 1 && realLen <= (countU32 - 1) * 4, () => `ZSTR length-tag out of range: ${realLen}`);
  const decrypted = Uint8Array.from({ length: realLen }, (_, i) => (u32s[i >>> 2] >>> ((i & 3) << 3)) & 0xff);

  // For ChaCha8, 8 bytes of nonce
  const nonce = new Uint8Array(8);
  nonce.set(decrypted.subarray(0, 8));
  return { version, nonce, xorLen };
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

function qround(s: Int32Array, a: number, b: number, c: number, d: number) {
  s[a] += s[b];
  s[d] = rotl(s[d] ^ s[a], 16);
  s[c] += s[d];
  s[b] = rotl(s[b] ^ s[c], 12);
  s[a] += s[b];
  s[d] = rotl(s[d] ^ s[a], 8);
  s[c] += s[d];
  s[b] = rotl(s[b] ^ s[c], 7);
}

// WASM XXTEA loop f_sn
const DELTA = 0x9e3779b9 | 0;

function xxteaDecrypt(v: Int32Array, keyBytes: Uint8Array) {
  const n = v.length;
  if (n < 2) return;
  const k = Int32Array.from({ length: 4 }, (_, it) => readIntLE(keyBytes, it * 4));
  const rounds = 6 + Math.trunc(52 / n);
  let sum = Math.imul(rounds, DELTA);
  let y = v[0];
  const mx = (z: number, p: number, e: number) =>
    ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) | 0;
  for (let r = 0; r < rounds; r++) {
    const e = (sum >>> 2) & 3;
    for (let p = n - 1; p >= 1; p--) {
      const z = v[p - 1];
      v[p] -= mx(z, p, e);
      y = v[p];
    }
    const z = v[n - 1];
    v[0] -= mx(z, 0, e);
    y = v[0];
    sum = (sum - DELTA) | 0;
  }
}

/** Canvas size of a WebP (VP8X canvas, or the VP8 / VP8L frame header). */
function webpSize(webp: Uint8Array): { width: number; height: number } {
  for (let off = 12; off + 8 <= webp.length; ) {
    const fourCC = latin1(webp.subarray(off, off + 4));
    const size = readIntLE(webp, off + 4);
    const p = off + 8;
    if (fourCC === "VP8X") return { width: 1 + (webp[p + 4] | (webp[p + 5] << 8) | (webp[p + 6] << 16)), height: 1 + (webp[p + 7] | (webp[p + 8] << 8) | (webp[p + 9] << 16)) };
    if (fourCC === "VP8 ") return { width: (webp[p + 6] | (webp[p + 7] << 8)) & 0x3fff, height: (webp[p + 8] | (webp[p + 9] << 8)) & 0x3fff };
    if (fourCC === "VP8L") {
      const bits = readIntLE(webp, p + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    off = p + size + (size & 1);
  }
  throw new Error("XEBP has no VP8 image");
}

async function compositePatch(vp8Webp: Uint8Array, patch: Argb8888): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { width, height } = webpSize(vp8Webp);
  const pw = Math.min(patch.width, width);
  const ph = Math.min(patch.height, height);
  const png = await encodePng(patch, pw, ph);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" xlink:href="data:image/webp;base64,${Base64.encode(vp8Webp)}"/>` +
    `<image width="${pw}" height="${ph}" xlink:href="data:image/png;base64,${Base64.encode(png)}"/>` +
    `</svg>`;
  return { bytes: new TextEncoder().encode(svg), contentType: "image/svg+xml" };
}

// --- minimal PNG encoder (8-bit RGB, filter 0) for the patch

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b: Uint8Array) => {
  let c = -1;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return ~c;
};
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setInt32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The top-left pw x ph of `img` as a PNG. */
export async function encodePng(img: Argb8888, pw: number, ph: number): Promise<Uint8Array> {
  const raw = new Uint8Array(ph * (1 + pw * 3));
  let o = 0;
  for (let y = 0; y < ph; y++) {
    raw[o++] = 0;
    for (let x = 0; x < pw; x++) {
      const p = img.pixels[y * img.width + x];
      raw[o++] = (p >>> 16) & 0xff;
      raw[o++] = (p >>> 8) & 0xff;
      raw[o++] = p & 0xff;
    }
  }
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, pw);
  dv.setUint32(4, ph);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0)));
}
