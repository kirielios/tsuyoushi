// Port of keiyoushi/extensions-source lib-multisrc/monochrome/MonochromeAPI.kt

export interface Results {
  offset: number;
  limit: number;
  results: Manga[];
  total: number;
}
export const hasNext = (r: Results): boolean => r.total > r.results.length + r.offset * r.limit;

export interface Manga {
  title: string;
  description: string;
  author: string;
  artist: string;
  status: string;
  id: string;
  version: number;
}
export const cover = (m: Manga): string => `/media/${m.id}/cover.jpg?version=${m.version}`;

export interface Chapter {
  name: string;
  volume: number | null;
  number: number;
  scanGroup: string;
  id: string;
  version: number;
  length: number;
  uploadTime: string;
}

export function title(c: Chapter): string {
  let s = "";
  if (c.volume != null) s += `Vol ${c.volume} `;
  s += `Chapter ${formatChapterNumber(c.number)}`;
  if (c.name.length > 0) s += ` - ${c.name}`;
  return s;
}

/** Instant.tryParse: 0 when it does not parse. */
export function timestamp(c: Chapter): number {
  const t = Date.parse(c.uploadTime);
  return Number.isNaN(t) ? 0 : t;
}

export const parts = (c: Chapter): string => `/${c.id}|${c.version}|${c.length}`;

// at most two decimals without trailing zeros, e.g. 12.0 -> "12", 12.5 -> "12.5"
const formatChapterNumber = (n: number): string => String(Number(n.toFixed(2)));
