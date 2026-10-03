// Port of keiyoushi/extensions-source src/all/mangamillion/ImageInterceptor.kt
import { aesCbcDecrypt, hexBytes, type ChainInterceptor } from "../../../sdk/index.ts";

export const imageInterceptor: ChainInterceptor = async (chain) => {
  const request = chain.request();
  const response = await chain.proceed(request);
  // HttpUrl.fragment: the page URL carries "#<key hex>:<iv hex>"
  const fragment = new URL(request.url).hash.replace(/^#/, "");

  if (!fragment || !fragment.includes(":") || !response.isSuccessful) return response;

  const i = fragment.indexOf(":");
  const key = fragment.slice(0, i);
  const iv = fragment.slice(i + 1);
  // AES/CBC/PKCS5Padding
  return response.withBody(await aesCbcDecrypt(hexBytes(key), hexBytes(iv), response.bytes()));
};
