// Mihon's source models, same field names (snake_case included) so ported code reads line for line against the Kotlin.

export interface SManga {
  url: string; // path without domain, see urlWithoutDomain
  title: string;
  artist?: string;
  author?: string;
  description?: string;
  genre?: string; // comma separated, as in Mihon
  status: number;
  thumbnail_url?: string;
  initialized?: boolean;
  /** Mihon 1.6: data the source keeps on the manga and gets back on every call (the host persists it). */
  memo: Record<string, unknown>;
}
export const SManga = {
  UNKNOWN: 0,
  ONGOING: 1,
  COMPLETED: 2,
  LICENSED: 3,
  PUBLISHING_FINISHED: 4,
  CANCELLED: 5,
  ON_HIATUS: 6,
  create: (): SManga => ({ url: "", title: "", status: 0, memo: {} }),
};

export interface SChapter {
  url: string;
  name: string;
  date_upload: number; // epoch ms, 0 = unknown
  chapter_number: number; // -1 = unknown; the host recognises it from the name then
  scanlator?: string;
  /** Mihon 1.6: persisted with the chapter, e.g. Madara keeps the manga path here to build chapter URLs. */
  memo: Record<string, unknown>;
}
export const SChapter = {
  create: (): SChapter => ({ url: "", name: "", date_upload: 0, chapter_number: -1, memo: {} }),
};

export class Page {
  constructor(
    readonly index: number,
    readonly url = "",
    readonly imageUrl?: string,
  ) {}
}

export class MangasPage {
  constructor(
    readonly mangas: SManga[],
    readonly hasNextPage: boolean,
  ) {}
}

export class SMangaUpdate {
  constructor(
    readonly manga: SManga,
    readonly chapters: SChapter[],
  ) {}
}

/** Kotlin's setUrlWithoutDomain: keep path, query and fragment so a source can change domain without breaking entries. */
export function urlWithoutDomain(url: string): string {
  try {
    const u = new URL(url);
    // java.net.URI keeps an empty fragment ("…/ch-1#"), which sources test with substringAfterLast('#')
    return u.pathname + u.search + (u.hash || (url.endsWith("#") ? "#" : ""));
  } catch {
    return url;
  }
}
