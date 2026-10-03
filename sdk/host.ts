import type { CheerioAPI } from "cheerio";

/** A fully buffered response; the host follows redirects, applies a timeout and keeps a cookie jar per source. */
export interface HostResponse {
  status: number;
  /** Final URL after redirects: relative links resolve against it, as Jsoup does with OkHttp's request URL. */
  url: string;
  headers: Record<string, string>; // lower-case names
  /** Every Set-Cookie value (a header record keeps only one); the SDK's CookieJar stores them. */
  setCookies?: string[];
  body: Uint8Array;
}

/**
 * Everything an extension gets from the app at runtime. A bundle never imports the app: this object is the whole
 * contract, so the same bundle runs in the reader and in `tools/check.ts`.
 */
export interface Host {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<HostResponse>;
  /** cheerio.load, injected so bundles do not each carry their own copy. */
  load: CheerioAPI["load"];
  userAgent: string;
  /** Source preferences, loaded before the source is created so reads stay synchronous like SharedPreferences. */
  prefs: { get(key: string): unknown; set(key: string, value: unknown): void };
  /** Image decode/compose/encode (Android Bitmap + Canvas), for descrambling and stitching. Use sdk/image.ts. */
  image?: HostImage;
}

/** A source rectangle of an encoded image, drawn unscaled at (dx, dy). Rects lie within the source and the canvas. */
export interface ImageLayer {
  bytes: Uint8Array;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  /** Optional transform of the source rect, applied before drawing: mirror horizontally, then rotate counter-clockwise by `rotate` quarter turns. (dx, dy) is then the top-left of the transformed rect, which the host clips to the canvas. */
  flip?: boolean;
  rotate?: number;
}
export interface HostImage {
  size(bytes: Uint8Array): Promise<{ width: number; height: number }>;
  /** Draws the layers in order onto a transparent canvas and encodes it (JPEG flattens onto black, as Bitmap.compress). quality 0-100. */
  compose(opts: { width: number; height: number; format: "jpeg" | "webp" | "png"; quality?: number; layers: ImageLayer[] }): Promise<Uint8Array>;
}

/** Written by tools/generate.ts from the upstream build.gradle.kts; baked into the bundle at build time. */
export interface Meta {
  id: string; // "kei:en.mangapill:en" - unique across repos, one per source
  pkg: string; // "en.mangapill" - the upstream extension directory
  name: string;
  lang: string;
  baseUrl: string;
  /** `baseUrl { mirrors(...) }` upstream: the user picks one (MirrorPreferences). Baked into the bundle by tools/build.ts. */
  mirrors?: string[];
  /** `baseUrl { custom("…") }` upstream: the user may override baseUrl (CustomUrlPreferences). */
  customUrl?: boolean;
  contentWarning: "SAFE" | "MIXED" | "NSFW";
  theme?: string;
  version: string; // "<upstreamVersionCode>.<portRevision>+<bundle hash>"
  upstreamVersionCode: number;
}
