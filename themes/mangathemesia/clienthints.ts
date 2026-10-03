// Port of keiyoushi/extensions-source lib-multisrc/mangathemesia/ClientHintsInterceptor.kt
import type { Interceptor } from "../../sdk/index.ts";

const CHROME_REGEX = /Chrome\/(\d+)/;
const EDGE_REGEX = /Edg[^/]*\/(\d+)/;
const OPERA_REGEX = /OPR\/(\d+)/;

type BrowserInfo = { name: string; version: string; chromiumVersion: string };

function detectBrowser(ua: string): BrowserInfo | null {
  if (ua.includes("Firefox/") && !ua.includes("Chrome")) return null;
  if (ua.includes("Safari/") && !ua.includes("Chrome") && !ua.includes("Chromium")) return null;
  if (ua.includes("Edg/") || ua.includes("EdgA/") || ua.includes("EdgiOS/")) {
    const edge = EDGE_REGEX.exec(ua)?.[1] ?? "134";
    return { name: "Microsoft Edge", version: edge, chromiumVersion: CHROME_REGEX.exec(ua)?.[1] ?? edge };
  }
  if (ua.includes("OPR/")) return { name: "Opera", version: OPERA_REGEX.exec(ua)?.[1] ?? "118", chromiumVersion: CHROME_REGEX.exec(ua)?.[1] ?? "134" };
  if (ua.includes("Chrome/")) {
    const chrome = CHROME_REGEX.exec(ua)?.[1] ?? "134";
    return { name: "Google Chrome", version: chrome, chromiumVersion: chrome };
  }
  return null;
}

function detectPlatform(ua: string) {
  if (ua.includes("Windows")) return '"Windows"';
  if (ua.includes("Android")) return '"Android"';
  if (ua.includes("iPhone") || ua.includes("iPad")) return '"iOS"';
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return '"macOS"';
  if (ua.includes("Linux")) return '"Linux"';
  return '"Windows"';
}

/** Sends the Sec-CH-UA client hints a real Chromium would, derived from the User-Agent. */
export const clientHintsInterceptor: Interceptor = (request) => {
  const ua = request.headers.get("User-Agent");
  if (!ua) return request;
  const info = detectBrowser(ua);
  if (!info) return request;
  const isMobile = ["Mobile", "Android", "iPhone", "iPad"].some((it) => ua.includes(it));
  const headers = new Headers(request.headers);
  headers.set("Sec-CH-UA", `"${info.name}";v="${info.version}", "Chromium";v="${info.chromiumVersion}", "Not A(Brand";v="24"`);
  headers.set("Sec-CH-UA-Mobile", isMobile ? "?1" : "?0");
  headers.set("Sec-CH-UA-Platform", detectPlatform(ua));
  headers.set("DNT", "1");
  return { ...request, headers };
};
