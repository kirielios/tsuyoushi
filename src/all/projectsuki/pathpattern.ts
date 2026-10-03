// Port of keiyoushi/extensions-source src/all/projectsuki/PathPattern.kt
// plus the top-level declarations of ProjectSuki.kt (kept apart from the source class so the other files can import
// them without an import cycle).
import { HttpUrl, toHttpUrl } from "../../../sdk/index.ts";

// --- PathPattern.kt

export class PathPattern {
  readonly paths: (RegExp | null)[];
  constructor(...paths: (RegExp | null)[]) {
    this.paths = paths;
    if (paths.length === 0) reportErrorToUser(null, () => "Invalid PathPattern, cannot be empty!");
  }
}

export class PathMatchResult {
  constructor(
    readonly doesMatch: boolean,
    readonly matchResults: (RegExpMatchArray | null)[] | null,
  ) {
    if (matchResults?.length === 0) reportErrorToUser(null, () => "Invalid PathMatchResult, matchResults must either be null or not empty!");
  }
  group(segmentIndex: number, groupIndex = 1): string | null {
    return this.matchResults?.[segmentIndex]?.[groupIndex] ?? null;
  }
}

/** Kotlin's Regex.matchEntire */
const matchEntire = (regex: RegExp, s: string) => new RegExp(`^(?:${regex.source})$`, regex.flags).exec(s);

export function matchAgainst(url: HttpUrl, pattern: PathPattern, allowSubPaths = false, ignoreEmptySegments = true): PathMatchResult {
  const actualSegments = ignoreEmptySegments ? url.pathSegments.filter((it) => it.trim()) : url.pathSegments;
  const sizeReq = allowSubPaths ? actualSegments.length >= pattern.paths.length : actualSegments.length === pattern.paths.length;

  if (!sizeReq) return new PathMatchResult(false, null);

  const matchResults: (RegExpMatchArray | null)[] = [];
  let matches = true;

  const n = Math.min(actualSegments.length, pattern.paths.length);
  for (let i = 0; i < n; i++) {
    const regex = pattern.paths[i];
    const match = regex ? matchEntire(regex, actualSegments[i]) : null;
    matchResults.push(match);
    matches = matches && (regex == null || match != null);
  }

  return new PathMatchResult(matches, matchResults);
}

// --- ProjectSuki.kt top level

export const SHORT_FORM_ID = "ps";

export const homepageUrl: HttpUrl = toHttpUrl("https://projectsuki.com");

/** PATTERN: `https://projectsuki.com/book/<bookid>`  */
export const bookUrlPattern = new PathPattern(/book/i, /(.+)/i);

/** PATTERN: `https://projectsuki.com/browse/<pagenum>` */
export const browsePattern = new PathPattern(/browse/i, /(\d+)/i);

/**
 * PATTERN: `https://projectsuki.com/read/<bookid>/<chapterid>/<startpage>`
 */
export const chapterUrlPattern = new PathPattern(/read/i, /(.+)/i, /(.+)/i, /(.+)/i);

/**
 * PATTERNS:
 *  - `https://projectsuki.com/images/gallery/<bookid>/thumb`
 *  - `https://projectsuki.com/images/gallery/<bookid>/thumb.<thumbextension>`
 *  - `https://projectsuki.com/images/gallery/<bookid>/<thumbwidth>-thumb`
 *  - `https://projectsuki.com/images/gallery/<bookid>/<thumbwidth>-thumb.<thumbextension>`
 */
export const thumbnailUrlPattern = new PathPattern(/images/i, /gallery/i, /(.+)/i, /(\d+-)?thumb(?:\.(.+))?/i);

/** PATTERN: `https://projectsuki.com/images/gallery/<bookid>/<uuid>/<pagenum>` */
export const pageUrlPattern = new PathPattern(/images/i, /gallery/i, /(.+)/i, /(.+)/i, /(.+)/i);

/** PATTERN: `https://projectsuki.com/genre/<genre>` */
export const genreSearchUrlPattern = new PathPattern(/genre/i, /(.+)/i);

/** PATTERN: `https://projectsuki.com/group/<groupid>` */
export const groupUrlPattern = new PathPattern(/group/i, /(.+)/i);

export const emptyImageUrl: HttpUrl = homepageUrl.newBuilder().addPathSegment("images").addPathSegment("gallery").addPathSegment("empty.jpg").build();

/** HttpUrl.rawRelative: homepageUri.relativize(uri) with a leading "/", null when the URL is not on the homepage. */
export function rawRelative(url: HttpUrl): string | null {
  const u = url.toURL();
  const home = homepageUrl.toURL();
  if (u.protocol !== home.protocol || u.host !== home.host) return null;
  return u.pathname + u.search + u.hash;
}

export const reportPrefix = "Error! Report on GitHub (tachiyomiorg/tachiyomi-extensions)";

export class ProjectSukiException extends Error {}

export function reportErrorToUser(locationHint: string | null, message: () => string): never {
  let s = `[${reportPrefix}]: ${message()}`;
  if (locationHint?.trim()) s += ` @${locationHint}`;
  throw new ProjectSukiException(s);
}

export const UNKNOWN_LANGUAGE = "unknown";

export type BookID = string;
export type ChapterID = string;
export type ScanGroup = string;
export type BookTitle = string;
