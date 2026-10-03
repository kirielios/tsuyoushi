// Port of keiyoushi/extensions-source lib/e4p/E4PDecoder.kt
//
// SHA-1 goes through WebCrypto and the manifest may need inflating, so decodeManifestFull is async here. BLAKE2b-256
// (org.kotlincrypto.hash:blake2 upstream) is implemented below.
import { Base64, concat, inflate, rc4, utf8 } from "../../sdk/crypto.ts";
import { DataType, TicketType, WrapperType, decodeProtoPub, type E4PQSTicket, type E4PQSWrapper, type ProtoPub } from "./dto.ts";
import { readIntLE } from "./tiffDecoder.ts";
import { XebpDecoder } from "./xebpDecoder.ts";

export class DecodedManifest {
  constructor(
    readonly pub: ProtoPub,
    readonly pbexSeed: Uint8Array | null,
  ) {}
}

const require = (cond: boolean, msg: () => string) => {
  if (!cond) throw new Error(msg());
};

export class E4PDecoder {
  async decodeManifestFull(ticket: E4PQSTicket): Promise<DecodedManifest> {
    let wrapper: E4PQSWrapper;
    if (ticket.type === TicketType.TDRM_V1) wrapper = await this.unwrapTdrmV1(ticket);
    else if (ticket.type === TicketType.PLAIN_UNSPECIFIED) wrapper = ticket.child;
    else throw new Error(`Unsupported ticket type: ${ticket.type}`);

    let decrypted: Uint8Array;
    if (wrapper.type === WrapperType.PLAIN_UNSPECIFIED) decrypted = wrapper.data;
    else if (wrapper.type === WrapperType.CDRM_V1) decrypted = this.decryptCdrmV1(ticket.contentId, wrapper.iv, wrapper.data);
    else throw new Error(`Unsupported wrapper type: ${wrapper.type}`);

    const hasPbex = decrypted.length >= 52 && decrypted[0] === 0x50 && decrypted[1] === 0x42 && decrypted[2] === 0x45 && decrypted[3] === 0x58; // "PBEX"
    const pbexSeed = hasPbex ? decrypted.slice(4, 52) : null;
    const payload = hasPbex ? decrypted.slice(52) : decrypted;

    let inflated: Uint8Array;
    if (wrapper.dataType === DataType.PROTOPUB) inflated = payload;
    else if (wrapper.dataType === DataType.PROTOPUB_ZLIB) inflated = await inflate(payload);
    else throw new Error(`Unsupported dataType: ${wrapper.dataType}`);

    return new DecodedManifest(decodeProtoPub(inflated), pbexSeed);
  }

  // func 'f127' in drm_worker.js
  private async unwrapTdrmV1(ticket: E4PQSTicket): Promise<E4PQSWrapper> {
    const wrapper = ticket.child;
    require(wrapper.iv.length === 32, () => `CDRM iv must be 32 bytes, got ${wrapper.iv.length}`);
    require(ticket.contentId.length >= 3, () => "contentId too short");
    require(ticket.consumer.length >= 3, () => "consumer too short");

    // Blowfish IV derivation
    const expires = ticket.expires.seconds;
    const cid = ticket.contentId;
    const tweak = Uint8Array.from([
      expires % 100,
      Math.trunc(expires / 100) % 100,
      Math.trunc(expires / 10_000) % 100,
      Math.trunc(expires / 1_000_000) % 100,
      Math.trunc(expires / 100_000_000) % 100,
      cid.charCodeAt(cid.length - 1),
      cid.charCodeAt(cid.length - 2),
      cid.charCodeAt(cid.length - 3),
    ]);
    xorMaskA6(tweak, 0);

    const sha1 = new Uint8Array(await crypto.subtle.digest("SHA-1", concat(VF124(), tweak) as BufferSource));
    const blowfishIv = sha1.slice(7, 15); // 8 bytes
    xorMaskA6(blowfishIv, 3);

    // RC4 key: consumer || contentId || VF124, truncated to 256 bytes
    const consumerBytes = utf8(ticket.consumer);
    const contentIdBytes = utf8(ticket.contentId);
    const rc4Key = concat(consumerBytes, contentIdBytes, VF124()).slice(0, 256);

    // RC4-decrypt (iv || data[0...v261]) with 769-byte discard
    const v261 = Math.min(wrapper.data.length, 123 + contentIdBytes[2]);
    const rc4Input = concat(wrapper.iv, wrapper.data.subarray(0, v261));
    const rc4Out = rc4(rc4Input, rc4Key, 769);

    // Blowfish-CBC-decrypt the first 32 bytes of the RC4 output
    const newIv = blowfishCbcDecrypt(rc4Out.slice(0, wrapper.iv.length), blowfishIv);

    // RC4-decrypted prefix || original tail
    const newData = new Uint8Array(wrapper.data.length);
    newData.set(rc4Out.subarray(wrapper.iv.length, wrapper.iv.length + v261), 0);
    newData.set(wrapper.data.subarray(v261), v261);

    return { ...wrapper, iv: newIv, data: newData };
  }

  // 'f_on' func in wasm
  private decryptCdrmV1(contentId: string, iv: Uint8Array, data: Uint8Array): Uint8Array {
    require(iv.length === 32, () => `CDRM iv must be 32 bytes, got ${iv.length}`);
    const key = deriveCdrmKey(contentId, iv);
    const nonce = iv.slice(16, 24);
    const initialCounter = iv[24];
    return XebpDecoder.chaCha8Decrypt(data, key, nonce, initialCounter);
  }
}

function xorMaskA6(buf: Uint8Array, shift: number) {
  for (let i = 0; i < buf.length; i++) buf[i] ^= A6[(A6[i] + shift) % A6.length];
}

function deriveCdrmKey(contentId: string, iv: Uint8Array): Uint8Array {
  const contentIdBytes = utf8(contentId);
  const e = Math.min(contentIdBytes.length, 24);
  const material = new Uint8Array(64);
  material.set(contentIdBytes.subarray(0, e), 0);
  material.set(ALPHABET.subarray(0, 64 - e), e);

  const key = blake2b256(material);

  // Stride-2 XOR: iv[0..16] into key[0,2,...,30]
  for (let c = 0; c < 16; c++) key[2 * c] ^= iv[c];

  // Scatter-XOR using low nibbles of iv[25..31]
  const [ivk, ivl, ivm, ivn, ivo, ivp, ivq] = iv.subarray(25, 32);
  const xorAt = (index: number, v: number) => (key[index] ^= v);
  xorAt((ivq & 15) + 2, ivk);
  xorAt((ivp & 15) + 5, ivl);
  xorAt((ivo & 15) + 5, ivm);
  xorAt((ivn & 15) + 6, ivn);
  xorAt((ivm & 15) + 5, ivo);
  xorAt((ivl & 15) + 0, ivp);
  xorAt((ivk & 15) + 0, ivq);

  // Final per-byte mask XOR
  for (let c = 0; c < 32; c++) key[c] ^= FINAL_MASK[((c + 3) & 0xff) % 7];
  return key;
}

// vA6 table in drm_worker.js, 19-byte XOR-mask table
const A6 = [11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 67, 71, 73, 79, 83, 69];

// vF124 in drm_worker.js:
// 16 bytes of RC4(key="error", data=[fixed 16 bytes], discard=771)
let vf124: Uint8Array | undefined;
const VF124 = () =>
  (vf124 ??= rc4(
    Uint8Array.from([0x8f, 0x08, 0xbe, 0x6c, 0x0f, 0xde, 0x6a, 0xf8, 0x20, 0xed, 0x7e, 0xaf, 0x0e, 0x52, 0xdd, 0x9d]),
    Uint8Array.from([101, 114, 114, 111, 114]), // "error"
    771,
  ));

// Alphabet, WASM data offset 106704
const ALPHABET = utf8("R5zRO0qEKFDfaP3OrLIbbQkjrcwWdgb4f7k6LLJjehQtvTrNXuzLp2_NT-eRnHK1");

// 7-byte repeating mask, WASM data offset 106784 (first 7 bytes)
const FINAL_MASK = [0xd9, 0xad, 0xbe, 0xef, 0xc0, 0xde, 0xad];

// --- Blowfish-CBC decrypt with custom P-array and S-boxes (drm_worker.js)

interface BlowfishTables {
  p: Int32Array;
  s: Int32Array[];
}

const UNDEFINED_KEY = Uint8Array.from([117, 110, 100, 101, 102, 105, 110, 101, 100]); // "undefined"

let blowfish: BlowfishTables | undefined;
const BLOWFISH = (): BlowfishTables => {
  if (blowfish) return blowfish;
  const sBytes = rc4(Base64.decode(BLOWFISH_S_B64), UNDEFINED_KEY, 769);
  const pBytes = rc4(Base64.decode(BLOWFISH_P_B64), UNDEFINED_KEY, 769);
  const p = Int32Array.from({ length: 18 }, (_, i) => readIntLE(pBytes, i * 4));
  const s = Array.from({ length: 4 }, (_, box) => Int32Array.from({ length: 256 }, (_, i) => readIntLE(sBytes, (box * 256 + i) * 4)));
  return (blowfish = { p, s });
};

const readIntBE = (b: Uint8Array, o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const writeIntBE = (b: Uint8Array, o: number, v: number) => new DataView(b.buffer, b.byteOffset).setInt32(o, v);

function blowfishCbcDecrypt(ciphertext: Uint8Array, iv: Uint8Array): Uint8Array {
  require(iv.length === 8, () => "Blowfish IV must be 8 bytes");
  require(ciphertext.length % 8 === 0, () => "Blowfish ciphertext must be a multiple of 8 bytes");
  const t = BLOWFISH();

  // IV split into two big-endian uint32s
  let prevL = readIntBE(iv, 0);
  let prevR = readIntBE(iv, 4);

  const out = new Uint8Array(ciphertext.length);
  for (let off = 0; off < ciphertext.length; off += 8) {
    const cl = readIntBE(ciphertext, off);
    const cr = readIntBE(ciphertext, off + 4);
    const [dl, dr] = blowfishDecryptBlock(cl, cr, t);
    writeIntBE(out, off, dl ^ prevL);
    writeIntBE(out, off + 4, dr ^ prevR);
    prevL = cl;
    prevR = cr;
  }
  return out;
}

// 64-bit Blowfish decrypt of one block (two 32-bit halves)
function blowfishDecryptBlock(xlIn: number, xrIn: number, t: BlowfishTables): [number, number] {
  // 'dr()' in drm_worker.js, custom Blowfish class
  let xl = xlIn ^ t.p[17];
  let xr = xrIn ^ t.p[16];
  // Initial swap
  [xl, xr] = [xr, xl];
  for (let i = 15; i >= 0; i--) {
    // Swap
    [xl, xr] = [xr, xl];
    // F-function + Feistel XOR
    xr ^= bF(xl, t);
    // Round-key XOR
    xl ^= t.p[i];
  }
  return [xl, xr];
}

// Blowfish F-function, 'yr()' in drm_worker.js:
// F(x) = ((S0[a] + S1[b]) xor S2[c]) + S3[d]
function bF(x: number, t: BlowfishTables): number {
  const a = (x >>> 24) & 0xff;
  const b = (x >>> 16) & 0xff;
  const c = (x >>> 8) & 0xff;
  const d = x & 0xff;
  return (((t.s[0][a] + t.s[1][b]) ^ t.s[2][c]) + t.s[3][d]) | 0;
}

// --- BLAKE2b (RFC 7693), unkeyed, 32-byte digest

const BLAKE2B_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const M64 = (1n << 64n) - 1n;
const rotr64 = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & M64;

/** BLAKE2b with a 32-byte digest; ponytail: BigInt rounds, fine for the one 64-byte key derivation per manifest. */
export function blake2b256(input: Uint8Array, outLen = 32): Uint8Array {
  const h = [...BLAKE2B_IV];
  h[0] ^= 0x01010000n ^ BigInt(outLen);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let bi = 0; bi < blocks; bi++) {
    const block = new Uint8Array(128);
    block.set(input.subarray(bi * 128, bi * 128 + 128));
    const dv = new DataView(block.buffer);
    const m = Array.from({ length: 16 }, (_, i) => dv.getBigUint64(i * 8, true));
    const last = bi === blocks - 1;
    const t = BigInt(Math.min(input.length, (bi + 1) * 128));
    const v = [...h, ...BLAKE2B_IV];
    v[12] ^= t & M64;
    v[13] ^= t >> 64n;
    if (last) v[14] ^= M64;
    const G = (a: number, b: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a] + v[b] + x) & M64;
      v[d] = rotr64(v[d] ^ v[a], 32n);
      v[c] = (v[c] + v[d]) & M64;
      v[b] = rotr64(v[b] ^ v[c], 24n);
      v[a] = (v[a] + v[b] + y) & M64;
      v[d] = rotr64(v[d] ^ v[a], 16n);
      v[c] = (v[c] + v[d]) & M64;
      v[b] = rotr64(v[b] ^ v[c], 63n);
    };
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      G(0, 4, 8, 12, m[s[0]], m[s[1]]);
      G(1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(2, 6, 10, 14, m[s[4]], m[s[5]]);
      G(3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(0, 5, 10, 15, m[s[8]], m[s[9]]);
      G(1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(2, 7, 8, 13, m[s[12]], m[s[13]]);
      G(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  h.forEach((x, i) => odv.setBigUint64(i * 8, x, true));
  return out.slice(0, outLen);
}

// vA0_0x5cc756.Er
const BLOWFISH_P_B64 = "DvkjivaXokwc2uOuQv7MCnIYSqteJh5cCoK/vx0BMyf1IvfsEnVw5wzMOTSwI7WW7s7+x71uM9VgSspOTfCxQS5knBlOncoD";

// vA0_0x5cc756.hr
const BLOWFISH_S_B64 =
  "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" +
  "q+BqevGcdUWK7bb2ClfkCg==";
