// Port of keiyoushi/extensions-source src/en/batcave/DleGuardResolver.kt
import type { ChainInterceptor } from "../../../sdk/index.ts";

/**
 * Upstream solves the DLE Guard challenge (a redirect to /_c/...) by loading the page in a WebView until the
 * __guard_trust cookie appears. There is no WebView here, so the redirect ends in upstream's failure message.
 */
export function dleGuardInterceptor(_baseUrl: string): ChainInterceptor {
  return async (chain) => {
    const response = await chain.proceed(chain.request());
    if (new URL(response.url).pathname.split("/")[1] !== "_c") return response;
    throw new Error("Open in WebView to bypass site protection");
  };
}
