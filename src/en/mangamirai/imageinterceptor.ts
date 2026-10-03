// Port of keiyoushi/extensions-source src/en/mangamirai/ImageInterceptor.kt
import { Base64, Canvas, aesCbcDecrypt, imageSize, toHttpUrl, utf8, type Chain, type Host, type Response } from "../../../sdk/index.ts";

export async function imageInterceptor(host: Host, chain: Chain): Promise<Response> {
  const request = chain.request();
  const response = await chain.proceed(request);
  const fragment = toHttpUrl(request.url).fragment;

  if (!fragment || !response.isSuccessful) return response;

  const contentsId = toHttpUrl(request.url).pathSegments[1];
  const seed = utf8(`manga${contentsId}mirai`);
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", seed as BufferSource));

  const bytes = response.bytes();
  const decrypted = await aesCbcDecrypt(keyBytes, bytes.subarray(0, 16), bytes.subarray(16));

  const { width, height } = await imageSize(host, decrypted);
  const result = await unscramble(host, decrypted, width, height, fragment);
  return response.withBody(result);
}

async function unscramble(host: Host, bitmap: Uint8Array, width: number, height: number, key: string): Promise<Uint8Array> {
  const canvas = new Canvas(host, width, height);

  // .split(',', '[', ']')
  const scrambleOrder: number[] = [];
  const bytes = Base64.decode(key);
  let current = -1;
  for (const b of bytes) {
    if (b >= 48 && b <= 57) current = (current === -1 ? 0 : current) * 10 + (b - 48);
    else if (current !== -1) {
      scrambleOrder.push(current);
      current = -1;
    }
  }
  if (current !== -1) scrambleOrder.push(current);

  const columns = Math.floor((width + 95) / 96);
  scrambleOrder.forEach((srcIndex, index) => {
    const srcX = (srcIndex % columns) * 96;
    const srcY = Math.floor(srcIndex / columns) * 96;
    const sw = Math.min(96, width - srcX);
    const sh = Math.min(96, height - srcY);
    const dstX = (index % columns) * 96;
    const dstY = Math.floor(index / columns) * 96;
    canvas.drawImage(bitmap, srcX, srcY, sw, sh, dstX, dstY);
  });

  return canvas.encode("jpeg", 90);
}
