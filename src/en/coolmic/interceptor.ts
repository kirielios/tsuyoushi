// Port of keiyoushi/extensions-source src/en/coolmic/ImageInterceptor.kt
import { Base64, HttpUrl, Response, aesCbcDecrypt, substringAfter, utf8, type Chain } from "../../../sdk/index.ts";
import type { PageResponse } from "./dto.ts";

const KEY_SIZE_BITS = 256;

export async function imageInterceptor(chain: Chain): Promise<Response> {
  const request = chain.request();
  const fragment = HttpUrl.parseOrNull(request.url)?.fragment;
  const response = await chain.proceed(request);

  if (!fragment || !fragment.startsWith("key=") || !response.isSuccessful) return response;

  const key = substringAfter(decodeURIComponent(fragment), "key=");
  const page = response.parseAs<PageResponse>();
  const aesKey = await deriveKey(key, Base64.decode(page.salt), page.iterations);
  const body = await aesCbcDecrypt(aesKey, Base64.decode(page.iv), Base64.decode(page.encrypted_image));

  return Response.of(response.url, body, "image/jpeg", response.code);
}

/** PBKDF2WithHmacSHA256 -> AES key bytes */
async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", utf8(password) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, KEY_SIZE_BITS));
}
