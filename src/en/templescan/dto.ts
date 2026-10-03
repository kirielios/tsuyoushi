// Port of keiyoushi/extensions-source src/en/templescan/Dto.kt
import { DateTimeFormatter, Locale, SManga } from "../../../sdk/index.ts";

// The site's React Server Components payload renames a fixed subset of field names to
// deterministic short keys. The client bundle (module that exports the rename map) derives
// each key from FNV-1a 32-bit of "<salt>:<name>:<i>" — incrementing i until the key is
// unique, processing the fields in the bundle's order: series_slug, Season, Chapter, price,
// title, chapter_name, chapter_slug, images — and encodes the hash as
// chr(97 + hash % 26) + (hash ushr 5).toString(36). If the site rotates its salt
// (currently "d1a803a73523"), recompute this mapping from the bundle.
export interface BrowseSeries {
  jdp5hu: string; // title
  m15392f: string; // slug
  alternative_names?: string | null;
  thumbnail?: string | null;
  badge?: string | null;
  status?: string | null;
  update_chapter?: string | null;
  created_at?: string | null;
  total_views?: number;
}

export const seriesTitle = (s: BrowseSeries) => s.jdp5hu;
export const seriesSlug = (s: BrowseSeries) => s.m15392f;
export const seriesViews = (s: BrowseSeries) => s.total_views ?? 0;
export const seriesUpdated = (s: BrowseSeries) => tryParse(s.update_chapter);
export const seriesCreated = (s: BrowseSeries) => tryParse(s.created_at);

export function browseSeriesToSManga(s: BrowseSeries): SManga {
  const manga = SManga.create();
  manga.url = `/comic/${seriesSlug(s)}`;
  manga.title = seriesTitle(s);
  manga.thumbnail_url = s.thumbnail ?? undefined;
  return manga;
}

/** schema.org `ComicSeries` JSON-LD block embedded in the detail page. */
export interface ComicSeriesLd {
  "@type"?: string | null;
  name?: string | null;
  description?: string | null;
  image?: string | null;
  author?: { name?: string | null } | null;
  alternateName?: string | null;
  genre?: string[] | null;
}

export const isSeries = (s: ComicSeriesLd) => s["@type"] === "ComicSeries";

export interface SeriesDataWrapper {
  seriesData: SeriesData;
}

export interface SeriesData {
  m21n2s7?: Season[] | null; // seasons
}

export interface Season {
  opez75?: Chapter[] | null; // items
}

export interface Chapter {
  c27b2ow: string; // name
  chapter_title?: string | null;
  m1shekt: string; // slug
  ivo8tc?: number; // price
  created_at?: string | null;
}

export const seriesChapters = (d: SeriesData): Chapter[] => (d.m21n2s7 ?? []).flatMap((it) => it.opez75 ?? []);
export const chapterCreated = (c: Chapter) => tryParse(c.created_at);

export interface PagesList {
  xdmo0k: string[]; // images
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ENGLISH);

function tryParse(date: string | null | undefined): number {
  if (date == null) return 0;
  return dateFormat.tryParseDateTime(date);
}
