// Port of yuzono/anime-extensions src/all/anizone/AnizoneDto.kt and LivewireDto.kt
import { DateTimeFormatter, Locale, SAnime, SEpisode } from "../../../sdk/index.ts";

const DOMAIN_REGEX = /^https?:\/\/[^/]+/;
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);

export const toRelativeUrl = (s: string) => s.replaceAll("\\/", "/").replace(DOMAIN_REGEX, "").replace(/^\/+/, "");

export const parseDate = (dateStr: string) => DATE_FORMAT.tryParseDate(dateStr);

/** TitleListSerializer: an object of lang id -> title; anything else (an empty array) is no titles. */
const titleMap = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});
const preferredTitle = (m: unknown, preferredTitleLang: string): string | undefined => {
  const t = titleMap(m);
  return t[preferredTitleLang] ?? t["1"] ?? t["5"];
};

export type AnimeXData = { url: string; cover: string; main_title: string; title_list?: unknown };
export type AnimeXDataWrapped = { anime: { url: string; main_title: string; title_list?: unknown }; snapshot?: string | null; teaser?: string | null };
export type EpisodeXData = { slug: string; url: string; title_list?: unknown; air_date?: string | null };
export type VidstackConfig = { src: string; subtitles?: { title: string; file: string }[] };

export function animeXDataToSAnime(d: AnimeXData, preferredTitleLang: string): SAnime | null {
  const cleanUrl = toRelativeUrl(d.url);
  if (!cleanUrl.trim()) return null;
  const resolvedTitle = preferredTitle(d.title_list, preferredTitleLang) ?? (d.main_title?.trim() ? d.main_title : null);
  if (resolvedTitle == null) return null;
  const anime = SAnime.create();
  anime.url = `/${cleanUrl}`;
  anime.title = resolvedTitle;
  anime.thumbnail_url = d.cover;
  return anime;
}

export function animeXDataWrappedToSAnime(d: AnimeXDataWrapped, preferredTitleLang: string): SAnime | null {
  const cleanUrl = toRelativeUrl(d.anime.url);
  if (!cleanUrl.trim()) return null;
  const resolvedTitle = preferredTitle(d.anime.title_list, preferredTitleLang) ?? (d.anime.main_title?.trim() ? d.anime.main_title : null);
  if (resolvedTitle == null) return null;
  const anime = SAnime.create();
  anime.url = `/${cleanUrl}`;
  anime.title = resolvedTitle;
  anime.thumbnail_url = d.snapshot ?? d.teaser ?? "";
  return anime;
}

export function episodeXDataToSEpisode(d: EpisodeXData, preferredTitleLang: string): SEpisode | null {
  const cleanUrl = toRelativeUrl(d.url);
  if (!cleanUrl.trim()) return null;
  const baseName = `Episode ${d.slug}`;
  const episodeTitle = preferredTitle(d.title_list, preferredTitleLang);
  const episode = SEpisode.create();
  episode.url = `/${cleanUrl}`;
  episode.name = episodeTitle?.trim() && episodeTitle !== "Unknown" ? `${baseName} - ${episodeTitle}` : baseName;
  const n = Number(d.slug);
  episode.episode_number = d.slug.trim() && Number.isFinite(n) ? n : -1;
  episode.date_upload = d.air_date ? parseDate(d.air_date) : 0;
  return episode;
}

// ============================== Livewire ==============================
export type DispatchDto = { name: string; params?: { items?: unknown[] | null; nextCursor?: string | null; hasMore?: boolean | null } | null };
export type LivewireDto = { components: { snapshot: string; effects: { html: string; dispatches?: DispatchDto[] } }[] };
export type LivewireCall = { path: string; method: string; params: unknown[] };
export const livewireCall = (method: string, params: unknown[]): LivewireCall => ({ path: "", method, params });
