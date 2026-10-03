// Port of keiyoushi/extensions-source src/en/alphamanga/ImageInterceptor.kt
import { Base64, Canvas, HttpUrl, Response, imageSize, substringAfter, type Chain, type Host } from "../../../sdk/index.ts";

export function imageInterceptor(host: Host) {
  return async (chain: Chain): Promise<Response> => {
    const request = chain.request();
    const response = await chain.proceed(request);
    let fragment = HttpUrl.parseOrNull(request.url)?.fragment;
    if (fragment) {
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // keep the raw fragment
      }
    }

    if (!fragment || !fragment.startsWith("key=") || !response.isSuccessful) return response;

    const key = substringAfter(fragment, "key=");
    const result = await unscramble(host, response.bytes(), key);
    // unscramble returns null where upstream returns the decoded image untouched
    if (!result) return response;
    return Response.of(response.url, result, "image/webp", response.code);
  };
}

// "createData" wasm export
async function unscramble(host: Host, image: Uint8Array, keyBase64: string): Promise<Uint8Array | null> {
  const key = Base64.decode(keyBase64);
  if (key.length < 8) return null;
  const kv = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const readInt = (o: number) => kv.getInt32(o, true);

  const v0 = readInt(0);
  const ha0 = readInt(4);
  const tileSize = (ha0 >>> 24) & 0xff;
  const w = (v0 >>> 27) & 7;
  if (tileSize === 0) return null;

  const { width: srcWidth, height: srcHeight } = await imageSize(host, image);
  const cols = Math.ceil(srcWidth / tileSize);
  const rows = Math.ceil(srcHeight / tileSize);
  const r = w * 2;
  const t = tileSize - r;
  const outW = srcWidth - cols * r;
  const outH = srcHeight - rows * r;
  const lastCol = cols - 1;
  const lastRow = rows - 1;
  if (outW <= 0 || outH <= 0) return null;

  const canvas = new Canvas(host, outW, outH);
  const coerceIn = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  const tileCount = Math.trunc(key.length / 8);
  for (let idx = 0; idx < tileCount; idx++) {
    const off = idx * 8;
    const v = readInt(off);
    const ha = readInt(off + 4);

    const flip = v & 1; // mirror flag
    const ca = (v >>> 1) & 3; // rotation, 0..3 -> 0/-90/-180/-270deg
    const ba = (v >>> 3) & 4095; // dest top (minus w)
    const aa = (v >>> 15) & 4095; // dest left (minus w)
    const srcRow = (ha >>> 8) & 0xff;
    const srcCol = (ha >>> 16) & 0xff;

    const b = (t !== 0 && Math.trunc(aa / t) === lastCol ? outW - aa : t) + r;
    const s = (t !== 0 && Math.trunc(ba / t) === lastRow ? outH - ba : t) + r;
    let dw: number;
    let dh: number;
    if (ca % 2 === 1) {
      // 90/270deg rotation swaps width/height
      dw = s;
      dh = b;
    } else {
      dw = b;
      dh = s;
    }

    const dx = aa - w;
    const dy = ba - w;

    const sx = coerceIn(srcCol * tileSize, 0, srcWidth);
    const sy = coerceIn(srcRow * tileSize, 0, srcHeight);
    const cropW = Math.max(Math.min(dw, srcWidth - sx), 0);
    const cropH = Math.max(Math.min(dh, srcHeight - sy), 0);
    if (cropW <= 0 || cropH <= 0) continue;

    canvas.drawImageTransformed(image, sx, sy, cropW, cropH, dx + dw / 2, dy + dh / 2, ca, flip !== 0);
  }

  return canvas.encode("webp", 100);
}
