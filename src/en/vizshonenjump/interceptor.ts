// Port of keiyoushi/extensions-source src/en/vizshonenjump/ImageInterceptor.kt
import { Canvas, HttpUrl, Response, imageSize, type Chain, type Host } from "../../../sdk/index.ts";

const CELL_WIDTH_COUNT = 10;
const CELL_HEIGHT_COUNT = 15;
const INNER_CELL_COUNT = CELL_WIDTH_COUNT - 2;
const GAP = 10;

export function imageInterceptor(host: Host) {
  return async (chain: Chain): Promise<Response> => {
    const request = chain.request();
    const response = await chain.proceed(request);
    const fragment = HttpUrl.parseOrNull(request.url)?.fragment;

    if (!fragment || fragment !== "scramble" || !response.isSuccessful) return response;

    const bytes = response.bytes();
    let key: number[] | null = null;
    try {
      key = readScrambleKey(bytes);
    } catch {
      key = null;
    }
    if (!key) return response;

    const result = await unscramble(host, bytes, key);
    return Response.of(response.url, result, "image/jpeg", response.code);
  };
}

async function unscramble(host: Host, image: Uint8Array, key: number[]): Promise<Uint8Array> {
  const size = await imageSize(host, image);
  const width = size.width - (CELL_WIDTH_COUNT - 1) * GAP;
  const height = size.height - (CELL_HEIGHT_COUNT - 1) * GAP;

  const blockWidth = Math.trunc(width / CELL_WIDTH_COUNT);
  const blockHeight = Math.trunc(height / CELL_HEIGHT_COUNT);
  const strideWidth = blockWidth + GAP;
  const strideHeight = blockHeight + GAP;

  const canvas = new Canvas(host, width, height);
  const draw = (srcX: number, srcY: number, srcW: number, srcH: number, dstX: number, dstY: number) => canvas.drawImage(image, srcX, srcY, srcW, srcH, dstX, dstY);

  draw(0, 0, width, blockHeight, 0, 0);

  draw(0, strideHeight, blockWidth, height - 2 * blockHeight, 0, blockHeight);

  const lastRowSrcY = (CELL_HEIGHT_COUNT - 1) * strideHeight;
  draw(0, lastRowSrcY, width, size.height - lastRowSrcY, 0, (CELL_HEIGHT_COUNT - 1) * blockHeight);

  const lastColSrcX = (CELL_WIDTH_COUNT - 1) * strideWidth;
  const rightBlockWidth = blockWidth + (width - CELL_WIDTH_COUNT * blockWidth);
  draw(lastColSrcX, strideHeight, rightBlockWidth, height - 2 * blockHeight, (CELL_WIDTH_COUNT - 1) * blockWidth, blockHeight);

  key.forEach((destIndex, sourceIndex) => {
    const srcX = ((sourceIndex % INNER_CELL_COUNT) + 1) * strideWidth;
    const srcY = (Math.trunc(sourceIndex / INNER_CELL_COUNT) + 1) * strideHeight;
    const dstX = ((destIndex % INNER_CELL_COUNT) + 1) * blockWidth;
    const dstY = (Math.trunc(destIndex / INNER_CELL_COUNT) + 1) * blockHeight;
    draw(srcX, srcY, blockWidth, blockHeight, dstX, dstY);
  });
  return canvas.encode("jpeg", 90);
}

/** Kim.readMetadata(...).findStringValue(EXIF_TAG_IMAGE_UNIQUE_ID): the Exif ImageUniqueID (0xA420) of a JPEG. */
export function readScrambleKey(jpeg: Uint8Array): number[] | null {
  const uniqueId = readExifImageUniqueId(jpeg);
  if (!uniqueId) return null;
  return uniqueId.split(":").map((it) => {
    if (!/^[+-]?[0-9a-f]+$/i.test(it)) throw new Error(`For input string: "${it}"`);
    return Number.parseInt(it, 16);
  });
}

function readExifImageUniqueId(b: Uint8Array): string | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) return null;
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // scan data / end: no EXIF
    const len = dv.getUint16(pos + 2);
    // APP1 "Exif\0\0"
    if (marker === 0xe1 && len >= 8 && String.fromCharCode(...b.subarray(pos + 4, pos + 8)) === "Exif") {
      return readTiff(dv, pos + 10, pos + 2 + len);
    }
    pos += 2 + len;
  }
  return null;
}

function readTiff(dv: DataView, base: number, end: number): string | null {
  const little = dv.getUint16(base) === 0x4949;
  const u16 = (o: number) => dv.getUint16(base + o, little);
  const u32 = (o: number) => dv.getUint32(base + o, little);
  const searched = new Set<number>();
  const scan = (ifd: number): string | null => {
    if (searched.has(ifd) || base + ifd + 2 > end) return null;
    searched.add(ifd);
    const n = u16(ifd);
    let exifPtr = -1;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (base + e + 12 > end) break;
      const tag = u16(e);
      if (tag === 0x8769) exifPtr = u32(e + 8);
      else if (tag === 0xa420) {
        const count = u32(e + 4);
        const off = count <= 4 ? e + 8 : u32(e + 8);
        const bytes = new Uint8Array(dv.buffer, dv.byteOffset + base + off, count);
        return new TextDecoder("latin1").decode(bytes).replace(/\0+$/, "");
      }
    }
    return exifPtr >= 0 ? scan(exifPtr) : null;
  };
  return scan(u32(4));
}
