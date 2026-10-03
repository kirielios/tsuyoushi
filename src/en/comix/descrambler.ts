// Port of keiyoushi/extensions-source src/en/comix/Descrambler.kt
import { Canvas, imageSize, Response, type Chain, type Host } from "../../../sdk/index.ts";

const GRID_COLS = 5;
const GRID_ROWS = 5;
const NUM_TILES = GRID_COLS * GRID_ROWS;

const ENC_MULTIPLIER = 1000005;
const ENC_INCREMENT = 1234567891;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

/** toLongOrNull()?.toInt(): the low 32 bits, signed. */
const toIntViaLong = (s: string | null) => (s != null && /^[+-]?\d{1,19}$/.test(s) ? Number(BigInt.asIntN(32, BigInt(s))) : null);
const toIntOrNull = (s: string | null) => (s != null && /^[+-]?\d+$/.test(s) && Math.abs(Number(s)) <= 2 ** 31 ? Number(s) | 0 : null);

export async function interceptor(host: Host, chain: Chain): Promise<Response> {
  const response = await chain.proceed(chain.request());
  if (!response.isSuccessful) return response;

  const rawScrambleSeed = response.header("x-scramble-seed");
  const rawScrambleGrid = response.header("x-scramble-grid");
  const rawScrambleAlgo = response.header("x-scramble-algo");
  const rawScrambleHash = response.header("x-scramble-hash");
  const rawEncSeed = response.header("x-enc-seed");
  const rawEncAlgo = response.header("x-enc-algo");

  const encSeed = toIntViaLong(rawEncSeed);
  const encLen = toIntOrNull(response.header("x-enc-len"));
  const scrambleSeed = toIntViaLong(rawScrambleSeed);
  const scrambleHash = decodeScrambleHash(rawScrambleHash);

  const needsXor = encSeed != null && encSeed !== 0 && encLen != null;
  const shouldDescrambleGrid =
    rawScrambleGrid === "5x5" && (rawScrambleAlgo == null || rawScrambleAlgo === "1" || rawScrambleAlgo === "2" || rawScrambleAlgo === "3") && scrambleSeed != null && scrambleSeed !== 0;

  if (!needsXor && !shouldDescrambleGrid) return response;

  const bodyMediaType = response.header("content-type") ?? "";
  const originalBytes = response.bytes();
  const bytes = needsXor ? decodeEncodedBytes(originalBytes, encSeed, encLen, rawEncAlgo) : originalBytes;
  const withBody = (body: Uint8Array, contentType: string) => new Response(host, { status: response.code, url: response.url, headers: { "content-type": contentType }, body });

  // Without Host.image, XOR-only pages go through decoded but not re-encoded
  const decodable = host.image ? await imageSize(host, bytes).catch(() => null) : null;
  if (shouldDescrambleGrid) {
    if (!host.image) throw new Error("Descrambling images needs Host.image");
    if (!decodable) return new Response(host, { status: 500, url: response.url, headers: { "content-type": "text/plain" }, body: new TextEncoder().encode("Failed to decode image") });
    return withBody(await descramble(host, bytes, decodable, scrambleSeed ^ scrambleHash, rawScrambleAlgo), "image/jpeg");
  }

  if (decodable) {
    const canvas = new Canvas(host, decodable.width, decodable.height);
    canvas.drawImage(bytes, 0, 0, decodable.width, decodable.height, 0, 0);
    return withBody(await canvas.encode("jpeg", 95), "image/jpeg");
  }

  return withBody(bytes, bodyMediaType);
}

function decodeEncodedBytes(bytes: Uint8Array, seed: number, length: number, algo: string | null): Uint8Array {
  if (algo !== "2") return decodeWithLcg(bytes, seed, length);

  const candidates = [decodeWithXorshift(bytes, seed | 1, length, false), decodeWithXorshift(bytes, seed, length, false), decodeWithXorshift(bytes, seed | 1, length, true), decodeWithLcg(bytes, seed, length)];
  return candidates.find(hasImageSignature) ?? candidates[0];
}

function decodeWithXorshift(bytes: Uint8Array, initialState: number, length: number, highByte: boolean): Uint8Array {
  const result = bytes.slice();
  let state = initialState;
  const limit = Math.min(result.length, length);
  for (let i = 0; i < limit; i++) {
    state = nextXorshiftState(state);
    const key = highByte ? state >>> 24 : state & 0xff;
    result[i] = result[i] ^ key;
  }
  return result;
}

function decodeWithLcg(bytes: Uint8Array, seed: number, length: number): Uint8Array {
  const result = bytes.slice();
  let state = seed;
  const limit = Math.min(result.length, length);
  for (let i = 0; i < limit; i++) {
    state = (Math.imul(state, ENC_MULTIPLIER) + ENC_INCREMENT) | 0;
    result[i] = result[i] ^ (state >>> 24);
  }
  return result;
}

function nextXorshiftState(state: number): number {
  let next = state;
  next ^= next << 13;
  next ^= next >>> 17;
  return next ^ (next << 5);
}

function decodeScrambleHash(hash: string | null): number {
  switch (hash?.trim()) {
    case "03632":
      return 58414;
    case "02900":
      return 117532;
    default:
      return 0;
  }
}

const hasImageSignature = (b: Uint8Array) =>
  b.length >= 12 &&
  ((b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) ||
    (b[0] === 0xff && b[1] === 0xd8) ||
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47));

async function descramble(host: Host, bytes: Uint8Array, { width, height }: { width: number; height: number }, seed: number, algo: string | null): Promise<Uint8Array> {
  const tileW = Math.trunc(width / GRID_COLS);
  const tileH = Math.trunc(height / GRID_ROWS);
  const order = algo === "3" ? buildOrder(seed, NUM_TILES) : buildOrderLcg(seed, NUM_TILES);
  const canvas = new Canvas(host, width, height);
  canvas.drawImage(bytes, 0, 0, width, height, 0, 0);
  for (let dstIdx = 0; dstIdx < NUM_TILES; dstIdx++) {
    const srcIdx = order[dstIdx];
    const srcCol = srcIdx % GRID_COLS;
    const srcRow = Math.trunc(srcIdx / GRID_COLS);
    const dstCol = dstIdx % GRID_COLS;
    const dstRow = Math.trunc(dstIdx / GRID_COLS);
    canvas.drawImage(bytes, srcCol * tileW, srcRow * tileH, tileW, tileH, dstCol * tileW, dstRow * tileH);
  }
  return canvas.encode("jpeg", 90);
}

function invert(arr: number[]): number[] {
  const inverse = new Array<number>(arr.length).fill(0);
  arr.forEach((v, i) => (inverse[v] = i));
  return inverse;
}

export function buildOrder(seed: number, n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  let state = seed | 1;
  for (let i = n - 1; i >= 1; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = (state >>> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return invert(arr);
}

export function buildOrderLcg(seed: number, n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  let state = seed;
  for (let i = n - 1; i >= 1; i--) {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) | 0;
    const j = (state >>> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return invert(arr);
}
