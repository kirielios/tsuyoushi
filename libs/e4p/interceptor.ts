// Port of keiyoushi/extensions-source lib/e4p/E4PInterceptor.kt
//
// `addInterceptor(E4PInterceptor())` upstream is `addChainInterceptor(E4PInterceptor())` here. The page URL's
// fragment carries "qscKey\niv\ncontentId\nconsumerId\npbexSeed"; a WHATWG URL drops raw newlines, so
// E4PManifestReader joins the parts with "%0A" and they are split and decoded here.
import { hexBytes } from "../../sdk/crypto.ts";
import { Response, type ChainInterceptor, type Request } from "../../sdk/network.ts";
import { readIntLE } from "./tiffDecoder.ts";
import { XebpContext, XebpDecoder } from "./xebpDecoder.ts";

const WEBP_MEDIA_TYPE = "image/webp";

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const withRange = (request: Request, range: string): Request => {
  const headers = new Headers(request.headers);
  headers.set("Range", range);
  return { ...request, headers };
};

// drm_worker.js f128 + wasm xebp_render
export function E4PInterceptor(): ChainInterceptor {
  return async (chain) => {
    const request = chain.request();
    const hash = new URL(request.url).hash.replace(/^#/, "");
    const fragmentParts = hash ? hash.split(/%0A/i).map(decode) : null;
    const qscKey = fragmentParts?.[0];

    if (!qscKey) return chain.proceed(request);

    const dirResponse = await chain.proceed(withRange(request, `bytes=0-${QscArchive.DIR_SIZE - 1}`));
    if (!dirResponse.isSuccessful) return dirResponse;
    const dirBytes = dirResponse.bytes();

    const entry = QscArchive.findEntry(dirBytes, qscKey);
    if (!entry) throw new Error(`QSC file not found: ${qscKey}`);

    const fileStart = QscArchive.DIR_SIZE + entry.offset;
    const fileEnd = fileStart + entry.size - 1;
    const fileResponse = await chain.proceed(withRange(request, `bytes=${fileStart}-${fileEnd}`));
    const xebpBytes = fileResponse.bytes();

    const ctx =
      fragmentParts!.length === 5
        ? new XebpContext(hexBytes(fragmentParts![1]), fragmentParts![2], hexBytes(fragmentParts![3]), hexBytes(fragmentParts![4]))
        : null;

    const body = ctx != null ? await XebpDecoder.decrypt(xebpBytes, ctx) : { bytes: stripToWebp(xebpBytes), contentType: WEBP_MEDIA_TYPE };

    return Response.of(fileResponse.url, body.bytes, body.contentType, 200);
  };
}

function stripToWebp(xebp: Uint8Array): Uint8Array {
  const isRiff = xebp.length >= 20 && xebp[0] === 0x52 && xebp[1] === 0x49 && xebp[2] === 0x46 && xebp[3] === 0x46; // "RIFF"
  if (!isRiff) return xebp;

  const vp8Size = readIntLE(xebp, 16);
  const webpEnd = 20 + vp8Size + (vp8Size & 1);
  if (webpEnd > xebp.length) return xebp;

  const out = new Uint8Array(webpEnd);
  out.set(xebp.subarray(0, webpEnd));
  new DataView(out.buffer).setInt32(4, webpEnd - 8, true); // "RIFF" <size>
  out.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return out;
}

// in qsc_worker.js
export class QscEntry {
  constructor(
    readonly fourCC: string,
    readonly size: number,
    readonly name: string,
    readonly offset: number,
  ) {}
}

export const QscArchive = {
  DIR_SIZE: 4096,

  findEntry(directory: Uint8Array, name: string): QscEntry | null {
    if (directory.length < QscArchive.DIR_SIZE) throw new Error(`QSC must be at least ${QscArchive.DIR_SIZE} bytes (${directory.length})`);

    for (let i = 0; i < MAGIC_SIZE; i++) {
      if (directory[i] !== MAGIC[i]) throw new Error(`Invalid QSC magic at offset ${i}`);
    }

    let runningOffset = 0;
    for (let i = 0; i < ENTRY_COUNT; i++) {
      const base = 32 + i * ENTRY_SIZE;
      const size = readIntLE(directory, base + 4);
      if (size === 0) break;
      const fourCC = String.fromCharCode(...directory.subarray(base, base + 4));
      const rawName = String.fromCharCode(...directory.subarray(base + 8, base + 32));
      const entryName = rawName.replace(/\u0000+$/, "");
      if (entryName === name) return new QscEntry(fourCC, size, entryName, runningOffset);
      runningOffset += size;
    }
    return null;
  },
};

const ENTRY_COUNT = 127;
const ENTRY_SIZE = 32;
const MAGIC_SIZE = 8;
// Magic: ASCII "E4PQSC" + version "\x01\x00"
const MAGIC = [0x45, 0x34, 0x50, 0x51, 0x53, 0x43, 0x01, 0x00];
