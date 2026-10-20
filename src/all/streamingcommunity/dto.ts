// Port of yuzono/anime-extensions src/all/streamingcommunity/Dto.kt
import { SAnime } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";

export interface BrowseResponse {
  props: {
    titles?: TitleObject[];
    totalCount?: number | null;
    scws_url?: string | null; // https://vixcloud.co
    cdn_url?: string | null; // https://cdn.streamingunity.vip
  };
  version?: string | null;
}

export interface TitleObject {
  id: number;
  slug: string;
  name: string;
  images: ImageObject[];
}

export function titleToSAnime(t: TitleObject, imageCdn: string): SAnime {
  const anime = SAnime.create();
  anime.title = t.name;
  anime.url = `${t.id}-${t.slug}`;
  const image = ["poster", "cover", "cover_mobile", "background"].map((type) => t.images.find((it) => it.type === type)).find((it) => it != null);
  if (image) anime.thumbnail_url = imageCdn + image.filename;
  return anime;
}

export interface ImageObject {
  filename: string;
  type: string; // poster, cover, background, logo, cover_mobile
  lang: string | null; // "en", "it"
}

export interface SingleShowResponse {
  props: {
    title?: ShowObject | null;
    loadedSeason?: LoadedSeasonObject | null;
    sliders?: RelatedObject[] | null;
  };
  version?: string | null; // x-inertia-version
}

export interface ShowObject {
  id: number;
  name: string;
  original_name?: string | null;
  type: string;
  plot?: string | null;
  quality?: string | null; // HD
  status?: string | null;
  runtime?: number | null;
  score?: string | null; // 7.7
  tmdb_id?: number | null;
  imdb_id?: string | null; // tt20969586
  release_date?: string | null; // "2018-01-07",
  last_air_date?: string | null; // "2025-01-01"
  age?: number | null; // 16
  seasons_count?: number; // 0 or 1,2,3...
  seasons?: SeasonObject[]; // could be empty
  trailers?: { name?: string | null; is_hd: number; youtube_id: string }[];
  genres?: { name: string }[] | null;
  main_actors?: { name: string }[];
  main_directors?: { name: string }[];
  preview?: PreviewObject | null;
  images?: ImageObject[];
  keywords?: { name: string }[];
  created_at?: string | null; // "2023-08-21T19:51:07.000000Z",
  updated_at?: string | null; // "2025-05-12T12:33:33.000000Z"
}

export interface SeasonObject {
  id: number;
  number: number;
  name: string | null; // Most likely `null` all the time
  plot: string | null; // Some has season plot
  release_date: string | null; // "2025-01-01"
  episodes_count: number;
}

export interface PreviewObject {
  video_id: number; // 262817
  is_viewable: number; // 1
  filename: string; // "preview-thunderbolts-1727430977.mp4"
  embed_url: string; // "https://vixcloud.co/embed/262817?token=...&expires=1752778149&canPlayFHD=1&canBypassAds=1&nogui=1&zf=25"
}

export interface RelatedObject {
  name: string; // "genre", "related"
  label: string; // "Related", "Movies - Action", "Movies - Adventure"
  titles: TitleObject[];
}

export interface LoadedSeasonObject {
  id: number;
  number: number;
  name: string | null;
  plot: string | null;
  release_date: string | null;
  episodes: EpisodeObject[];
}

export interface EpisodeObject {
  id: number;
  number: number;
  name: string;
  plot: string | null;
  duration: number | null; // 55
  created_at: string | null; // "2023-08-21T19:51:07.000000Z",
  updated_at: string | null; // "2025-05-12T12:33:33.000000Z"
  images: ImageObject[];
}

export function parseStatus(statusString: string | null | undefined): number {
  switch (statusString) {
    case "Ended":
    case "Released":
      return SAnime.COMPLETED;
    case "Returning Series":
      return SAnime.ONGOING;
    case "Canceled":
      return SAnime.CANCELLED;
    default:
      return SAnime.UNKNOWN;
  }
}

function fancyScore(score: string | null | undefined): string {
  const f = score != null && score.trim() !== "" ? Number(score) : Number.NaN;
  if (Number.isNaN(f)) return "";
  const it = Math.round(f / 2);
  return "★".repeat(it) + (it < 5 ? "☆".repeat(5 - it) : "") + ` ${score}\n`;
}

export function toSAnimeUpdate(s: ShowObject, intl: Intl): SAnime {
  const anime = SAnime.create();
  const parsedStatus = parseStatus(s.status);

  let desc = fancyScore(s.score);
  if (s.plot != null) desc += `${s.plot}\n\n`;
  desc += `${intl.get("original_name")}: ${s.original_name ?? null}`;
  desc += `\n${intl.get("quality")}: ${s.quality ?? null}`;
  if (s.runtime != null) desc += ` - ${intl.get("run_time")}: ${s.runtime}m`;
  if (s.release_date != null) desc += `\n${intl.get("release_date")}: ${s.release_date}`;
  if (parsedStatus === SAnime.UNKNOWN) desc += `\n${intl.get("status")}: ${s.status ?? null}`;
  if (s.age != null) desc += `\n${intl.get("rating")}: ${s.age}+`;
  const cast = (s.main_actors ?? []).map((it) => it.name).join(", ");
  if (cast.trim()) desc += `\n\n${intl.get("cast")}: ${cast}\n`;
  if (s.imdb_id != null) desc += `\n[IMDB](https://www.imdb.com/title/${s.imdb_id})`;
  if (s.tmdb_id != null) desc += `\n[TMDB](https://www.themoviedb.org/${s.type}/${s.tmdb_id})`;
  for (const it of s.trailers ?? []) desc += `\n[${it.name?.trim() ? it.name : "Trailer"}](https://www.youtube.com/watch?v=${it.youtube_id})`;

  anime.description = desc;
  anime.status = parsedStatus;
  anime.genre = s.genres?.map((it) => it.name).join(", ");
  anime.author = (s.main_directors ?? []).map((it) => it.name).join(", ");
  return anime;
}

/** `active` is not always a keyword - live pages emit the number 1 for the selected mirror. */
export interface StreamServer {
  url: string;
  active?: boolean | number | string | null;
}
export const isActive = (s: StreamServer) => String(s.active) === "true" || String(s.active) === "1";
