// Port of yuzono/anime-extensions src/all/yfantasy/Dto.kt
import { SAnime, SEpisode } from "../../../sdk/index.ts";

export interface SegmentDto {
  id: string;
  segmentIndex: number;
  imageUrl?: string | null;
  speechLanguage?: string | null;
  signedUrl?: string | null;
}

/** An entry of the catalog (currentSegment + hiddenSegments) or of a session, which answers in the same shape. */
export interface AnimeDto {
  videoId: string;
  title: string;
  tags?: string[];
  currentSegment?: SegmentDto | null;
  hiddenSegments?: SegmentDto[];
}

export interface AuthDto {
  sessionToken: string;
}

export interface FeedDto {
  items: FeedItemDto[];
}

export interface FeedItemDto {
  id: string;
  title: string;
  tags?: string[];
  publicSegment?: SegmentDto | null;
}

/** VideoEntry: the catalog and feed shapes behind one interface, as upstream. */
export interface VideoEntry {
  videoId: string;
  /** Some entries have no title upstream, so the id, which is also the site slug, stands in. */
  displayTitle: string;
  /** Catalog tags, e.g. `Romance`, used to relate entries to each other. */
  tags: string[];
  /** Playable segments, ordered as the episode list is displayed. */
  segments: SegmentDto[];
  toSAnime(): SAnime;
}

export function animeEntry(d: AnimeDto): VideoEntry {
  const tags = d.tags ?? [];
  const displayTitle = d.title || d.videoId;
  return {
    videoId: d.videoId,
    displayTitle,
    tags,
    segments: [...(d.currentSegment ? [d.currentSegment] : []), ...(d.hiddenSegments ?? [])].sort((a, b) => b.segmentIndex - a.segmentIndex),
    toSAnime: () => createSAnime(d.videoId, displayTitle, tags, d.currentSegment),
  };
}

export function feedEntry(d: FeedItemDto): VideoEntry {
  const tags = d.tags ?? [];
  const displayTitle = d.title || d.id;
  return {
    videoId: d.id,
    displayTitle,
    tags,
    segments: d.publicSegment ? [d.publicSegment] : [],
    toSAnime: () => createSAnime(d.id, displayTitle, tags, d.publicSegment),
  };
}

/**
 * Directory of the stream files, e.g. `https://host/<uid>`.
 * Locked segments have no signedUrl, so their id stands in as the episode url.
 */
export function videoBaseUrl(s: SegmentDto): string | null {
  if (!s.signedUrl) return null;
  try {
    const url = new URL(s.signedUrl);
    return `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf("/"))}`;
  } catch {
    return null;
  }
}

export function toSEpisode(s: SegmentDto): SEpisode {
  const baseUrl = videoBaseUrl(s);
  const ep = SEpisode.create();
  ep.url = baseUrl ?? s.id;
  ep.name = `Episode ${s.segmentIndex + 1}${baseUrl == null ? " 🔒" : ""}`;
  ep.episode_number = s.segmentIndex + 1;
  return ep;
}

function createSAnime(videoId: string, title: string, tags: string[], segment: SegmentDto | null | undefined): SAnime {
  const anime = SAnime.create();
  anime.url = videoId;
  anime.title = title;
  anime.thumbnail_url = segment?.imageUrl ?? undefined;
  anime.genre = tags.join(", ");
  anime.description = segment?.speechLanguage ? `Speech language: ${toLanguageName(segment.speechLanguage)}` : undefined;
  anime.initialized = true;
  return anime;
}

/** Turns a language code such as `zh` into `Chinese`, keeping the code when it is unknown. */
export function toLanguageName(code: string): string {
  try {
    return new globalThis.Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}
