// Port of keiyoushi/extensions-source src/all/mangafire/ChallengeSolverInterceptor.kt
import type { Chain, Response } from "../../../sdk/index.ts";

/**
 * Detects the shape-selecting captcha (403 with {"error":"captcha_required"}). Upstream solves it in a WebView running
 * /assets/solver.html (OpenCV.js) against the site; running site-served scripts is not allowed here, so that step
 * throws instead.
 */
export function challengeSolverInterceptor(doSolve: () => boolean) {
  return async (chain: Chain): Promise<Response> => {
    const response = await chain.proceed(chain.request());
    if (response.code !== 403) return response;
    let captcha: boolean;
    try {
      captcha = (JSON.parse(response.text()) as { error?: string | null }).error === "captcha_required";
    } catch {
      return response; // SerializationException -> return the response as is
    }
    if (!captcha) return response;

    if (!doSolve()) {
      throw new Error("Shape-selecting captcha detected. Open in WebView to solve manually or turn on the setting to solve automatically.");
    }
    // runWebViewBlocking(solver.html) is not ported
    throw new Error("Failed to solve shape-selecting captcha. Open in WebView to solve manually.");
  };
}
