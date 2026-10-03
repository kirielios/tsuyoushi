// keiyoushi.zip: read single entries of a remote ZIP over HTTP range requests. Offsets are plain numbers (exact up to
// 2^53, far beyond any archive a site serves). DEFLATE goes through DecompressionStream("deflate-raw").
import type { HttpClient } from "./network.ts";

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_MIN_LEN = 22;
const EOCD64_MIN_LEN = 56;
const CDH_MIN_LEN = 46;
const LFH_MIN_LEN = 30;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP64_EXTRA_ID = 0x0001;

export const MAX_EOCD_SEARCH = EOCD_MIN_LEN + 0xffff + 1;
export const MAX_LOCAL_FILE_HEADER = 512;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}
export interface ZipDirectory {
  entries: ZipEntry[];
  cdOffset: number;
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, i: number) => u32(b, i) + u32(b, i + 4) * 2 ** 32;

/** Inclusive [first, last] range covering the local header and the entry's data. */
export const dataRange = (localHeaderOffset: number, compressedSize: number): [number, number] => [localHeaderOffset, localHeaderOffset + MAX_LOCAL_FILE_HEADER + compressedSize];

export function findEocd(tail: Uint8Array) {
  for (let i = tail.length - EOCD_MIN_LEN; i >= 0; i--) {
    if (u32(tail, i) !== EOCD_SIG) continue;
    if (i + EOCD_MIN_LEN + u16(tail, i + 20) !== tail.length) continue;
    let cdSize = u32(tail, i + 12);
    let cdOffset = u32(tail, i + 16);
    let recordOffset = i;
    if (cdOffset === ZIP64_SENTINEL || cdSize === ZIP64_SENTINEL) {
      for (let j = i - EOCD64_MIN_LEN; j >= 0; j--) {
        if (u32(tail, j) !== EOCD64_SIG) continue;
        cdSize = u64(tail, j + 40);
        cdOffset = u64(tail, j + 48);
        recordOffset = j;
        break;
      }
    }
    return { cdOffset, cdSize, recordOffset };
  }
  throw new Error("EOCD record not found");
}

export function parseCentralDirectory(cd: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + CDH_MIN_LEN <= cd.length && u32(cd, p) === CDH_SIG) {
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let compressedSize = u32(cd, p + 20);
    const uncompressedSize = u32(cd, p + 24);
    let localHeaderOffset = u32(cd, p + 42);
    if (compressedSize === ZIP64_SENTINEL || localHeaderOffset === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      // zip64ExtraOffset
      let z = -1;
      for (let q = p + CDH_MIN_LEN + nameLen, end = q + extraLen; q + 4 <= end; q += 4 + u16(cd, q + 2)) {
        if (u16(cd, q) === ZIP64_EXTRA_ID) {
          z = q + 4;
          break;
        }
      }
      if (z >= 0) {
        if (uncompressedSize === ZIP64_SENTINEL) z += 8;
        if (compressedSize === ZIP64_SENTINEL) {
          compressedSize = u64(cd, z);
          z += 8;
        }
        if (localHeaderOffset === ZIP64_SENTINEL) localHeaderOffset = u64(cd, z);
      }
    }
    entries.push({ name: new TextDecoder().decode(cd.subarray(p + CDH_MIN_LEN, p + CDH_MIN_LEN + nameLen)), method: u16(cd, p + 10), compressedSize, localHeaderOffset });
    p += CDH_MIN_LEN + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** readZipDirectory(tail, totalSize, fetch): the directory with absolute offsets; fetch runs only when it lies outside the tail. */
export async function readZipDirectory(tail: Uint8Array, totalSize: number, fetch: (range: [number, number]) => Promise<Uint8Array>): Promise<ZipDirectory> {
  const tailStart = totalSize - tail.length;
  const eocd = findEocd(tail);
  const zipStart = tailStart + eocd.recordOffset - eocd.cdSize - eocd.cdOffset;
  const cdWithinTail = eocd.recordOffset - eocd.cdSize;
  const cdStart = zipStart + eocd.cdOffset;
  const cd = cdWithinTail >= 0 ? tail.slice(cdWithinTail, cdWithinTail + eocd.cdSize) : await fetch([cdStart, cdStart + eocd.cdSize - 1]);
  const entries = parseCentralDirectory(cd).map((it) => (zipStart === 0 ? it : { ...it, localHeaderOffset: zipStart + it.localHeaderOffset }));
  return { entries, cdOffset: zipStart + eocd.cdOffset };
}

/** Reads one entry from bytes that start at its local file header: STORED passes through, DEFLATE is inflated. */
export async function readEntry(source: Uint8Array, compressedSize: number, method: number): Promise<Uint8Array> {
  if (method !== METHOD_STORED && method !== METHOD_DEFLATE) throw new Error(`Unsupported ZIP method: ${method}`);
  if (source.length < LFH_MIN_LEN || u32(source, 0) !== LFH_SIG) throw new Error("Not a local file header");
  const start = LFH_MIN_LEN + u16(source, 26) + u16(source, 28);
  if (source.length < start + compressedSize) throw new Error(`Source ended ${start + compressedSize - source.length} byte(s) early`);
  const payload = source.slice(start, start + compressedSize);
  if (method === METHOD_STORED) return payload;
  const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const withRange = (headers: Headers, value: string) => {
  const h = new Headers(headers);
  h.set("Range", value);
  return h;
};

/** client.zipDirectory(url, headers): one `bytes=-N` suffix request yields the size (Content-Range) and the tail. */
export async function zipDirectory(client: HttpClient, url: string, headers: Headers): Promise<ZipDirectory> {
  const response = await client.get(url, withRange(headers, `bytes=-${MAX_EOCD_SEARCH}`));
  const total = Number(response.header("Content-Range")?.split("/").pop());
  if (!Number.isFinite(total) || !response.header("Content-Range")) throw new Error("Missing or invalid Content-Range");
  return readZipDirectory(response.bytes(), total, async ([first, last]) => (await client.get(url, withRange(headers, `bytes=${first}-${last}`))).bytes());
}
