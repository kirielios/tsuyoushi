// Port of keiyoushi/extensions-source lib/dataimage/DataImageInterceptor.kt
//
// If a source provides images via a data:image string instead of a URL, use these functions and interceptor.
// Element extension functions take the element as their first argument; `addInterceptor(DataImageInterceptor())`
// upstream is `addChainInterceptor(DataImageInterceptor())` here.
import { Base64 } from "../../sdk/crypto.ts";
import type { Element } from "../../sdk/jsoup.ts";
import { Response, type ChainInterceptor } from "../../sdk/network.ts";
import { substringAfter } from "../../sdk/strings.ts";

/**
 * Use if the attribute tag could have a data:image string or URL
 * Transforms data:image in to a fake URL that OkHttp won't die on
 */
export function dataImageAsUrl(element: Element, attr: string): string {
  return element.attr(attr).startsWith("data") ? "https://127.0.0.1/?" + substringAfter(element.attr(attr), ":") : element.attr(`abs:${attr}`);
}

/** Use if the attribute tag has a data:image string but real URLs are on a different attribute */
export function dataImageAsUrlOrNull(element: Element, attr: string): string | null {
  return element.attr(attr).startsWith("data") ? "https://127.0.0.1/?" + substringAfter(element.attr(attr), ":") : null;
}

/**
 * Interceptor that detects the URLs we created with the above functions, base64 decodes the data if necessary,
 * and builds a response with a valid image that Tachiyomi can display
 */
export function DataImageInterceptor(): ChainInterceptor {
  const mediaTypePattern = /(^[^;,]*)[;,]/;
  return async (chain) => {
    const url = chain.request().url;
    if (!url.startsWith("https://127.0.0.1/?image")) return chain.proceed(chain.request());
    const dataString = substringAfter(url, "?");
    const byteArray = dataString.includes("base64")
      ? Base64.decode(substringAfter(dataString, "base64,"))
      : new TextEncoder().encode(substringAfter(dataString, ","));
    // upstream passes the match including its ";" / "," to toMediaTypeOrNull; the bare type is what that parses to
    const mediaType = mediaTypePattern.exec(dataString)![1];
    return Response.of(url, byteArray, mediaType);
  };
}
