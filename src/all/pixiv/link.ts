// Port of keiyoushi/extensions-source src/all/pixiv/PixivLinkUtil.kt
import { HttpUrl } from "../../../sdk/index.ts";
import { KNOWN_LOCALES } from "./types.ts";

const BASE_URI = HttpUrl.parse("https://www.pixiv.net");

export type PixivTarget = PixivUser | PixivIllustration | PixivSeriesTarget;

export class PixivUser {
  readonly kind = "user";
  static readonly searchPrefix = "user:";
  constructor(readonly userId: string) {}
  toHttpUrl() {
    return BASE_URI.newBuilder().addPathSegment("users").addPathSegment(this.userId).build();
  }
  toSearchQuery() {
    return PixivUser.searchPrefix + this.userId;
  }
}

export class PixivIllustration {
  readonly kind = "illustration";
  static readonly searchPrefix = "aid:";
  constructor(readonly illustId: string) {}
  toHttpUrl() {
    return BASE_URI.newBuilder().addPathSegment("artworks").addPathSegment(this.illustId).build();
  }
  toSearchQuery() {
    return PixivIllustration.searchPrefix + this.illustId;
  }
}

export class PixivSeriesTarget {
  readonly kind = "series";
  static readonly searchPrefix = "sid:";
  constructor(
    readonly seriesId: string,
    readonly authorUserId: string | null = null,
  ) {}
  toHttpUrl() {
    if (this.authorUserId === null) throw new Error("TBD what should be done in this case");
    return BASE_URI.newBuilder().addPathSegment("user").addPathSegment(this.authorUserId).addPathSegment("series").addPathSegment(this.seriesId).build();
  }
  toSearchQuery() {
    return PixivSeriesTarget.searchPrefix + this.seriesId;
  }
}

const companions: { searchPrefix: string; make: (id: string) => PixivTarget }[] = [
  { searchPrefix: PixivUser.searchPrefix, make: (id) => new PixivUser(id) },
  { searchPrefix: PixivSeriesTarget.searchPrefix, make: (id) => new PixivSeriesTarget(id) },
  { searchPrefix: PixivIllustration.searchPrefix, make: (id) => new PixivIllustration(id) },
];

export function fromSearchQuery(query: string): PixivTarget | null {
  for (const c of companions) {
    if (!query.startsWith(c.searchPrefix)) continue;
    const id = query.slice(c.searchPrefix.length);
    if (!/^\d+$/.test(id)) continue;
    return c.make(id);
  }
  return null;
}

export function fromUri(uri: string | HttpUrl): PixivTarget | null {
  if (typeof uri === "string") {
    const parsed = HttpUrl.parseOrNull(uri);
    return parsed ? fromUri(parsed) : null;
  }
  // if an absolute domain is specified, check if it matches. Tolerate relative urls as-is.
  if (!(["http", "https"].includes(uri.scheme) && uri.host.replace(/^www\./, "") === "pixiv.net")) return null;

  let pathSegments = uri.pathSegments;
  if (!pathSegments.length) return null;

  if (KNOWN_LOCALES.includes(pathSegments[0])) pathSegments = pathSegments.slice(1);
  if (pathSegments.length < 2) return null;

  const first = pathSegments[0];
  if (first === "artworks") return new PixivIllustration(pathSegments[1]);
  if (first === "users") return new PixivUser(pathSegments[1]);
  if (first === "user" && pathSegments.length >= 4 && pathSegments[2] === "series") return new PixivSeriesTarget(pathSegments[3], pathSegments[1]);
  return null;
}
