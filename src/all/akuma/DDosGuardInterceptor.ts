// Port of keiyoushi/extensions-source src/all/akuma/DDosGuardInterceptor.kt
import { substringAfter, substringBefore, type ChainInterceptor, type CookieJar } from "../../../sdk/index.ts";

const WELL_KNOWN_URL = "https://check.ddos-guard.net/check.js";
const ERROR_CODES = [403];
const SERVER_CHECK = ["ddos-guard"];

/**
 * Upstream reads/writes the WebView CookieManager and fetches the check URLs with the base client; here the source's
 * cookie jar stands in for both: the check response's Set-Cookie lands in the jar and is sent on the retry.
 */
export function DDosGuardInterceptor(cookieJar: () => CookieJar, userAgent: string): ChainInterceptor {
  return async (chain) => {
    const originalRequest = chain.request();
    const response = await chain.proceed(originalRequest);

    // Check if DDos-GUARD is on
    const server = response.header("Server");
    if (!ERROR_CODES.includes(response.code) || server == null || !SERVER_CHECK.includes(server)) {
      return response;
    }

    const ddg2Cookie = cookieJar()
      .loadForRequest(originalRequest.url)
      .find((it) => it.name === "__ddg2_");
    if (ddg2Cookie?.value) {
      return response;
    }

    const url = new URL(originalRequest.url);
    const headers = new Headers({ "User-Agent": userAgent });
    const wellKnown = substringBefore(substringAfter((await chain.proceed({ url: WELL_KNOWN_URL, method: "GET", headers })).text(), "'", ""), "'", "");
    const checkUrl = `${url.protocol}//${url.host + wellKnown}`;
    await chain.proceed({ url: checkUrl, method: "GET", headers });

    return chain.proceed(originalRequest);
  };
}
