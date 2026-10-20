// Port of yuzono/anime-extensions src/all/movy/Dto.kt

// ============================== TMDB DTOs ===============================
export interface PageDto<T> {
  page: number;
  results: T[];
  total_pages: number;
}

export interface MediaItemDto {
  id: number;
  poster_path?: string | null;
  media_type?: string | null;
  title?: string | null;
  name?: string | null;
  original_language?: string | null;
  origin_country?: string[];
  genre_ids?: number[];
}
export const realTitle = (m: MediaItemDto) => m.title ?? m.name ?? "No Title";

export interface ExternalIdsDto {
  imdb_id?: string | null;
}
interface NameDto {
  name: string;
}

// ============================= Movie Detail =============================
export interface MovieDetailDto {
  id: number;
  title: string;
  genres?: NameDto[];
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  status?: string | null;
  release_date?: string | null;
  vote_average?: number;
  production_companies?: NameDto[];
  origin_country?: string[] | null;
  original_title?: string | null;
  external_ids?: ExternalIdsDto | null;
  tagline?: string | null;
  homepage?: string | null;
  runtime?: number | null;
}

// ============================== TV Detail ==============================
export interface TvDetailDto {
  id: number;
  name: string;
  genres?: NameDto[];
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  status?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  seasons?: SeasonDto[];
  networks?: NameDto[];
  production_companies?: NameDto[];
  vote_average?: number;
  origin_country?: string[] | null;
  original_name?: string | null;
  external_ids?: ExternalIdsDto | null;
  tagline?: string | null;
  homepage?: string | null;
}

export interface SeasonDto {
  id: number;
  name: string;
  season_number: number;
  poster_path?: string | null;
  overview?: string | null;
}

// =========================== TV Season Detail ===========================
export interface TvSeasonDetailDto {
  episodes?: EpisodeDto[];
}

export interface EpisodeDto {
  name: string;
  episode_number: number;
  air_date?: string | null;
  overview?: string | null;
  still_path?: string | null;
}

export interface SeedDto {
  seed: string;
}

// ============================ Videasy Decryption ============================
export interface VideasyDecryptionDto {
  status: number;
  result: VideasyDecryptedResult;
}

export interface VideasyDecryptedResult {
  // Current shape: each source is one playable URL with its own quality label.
  sources?: VideasySourceDto[] | null;
  // Legacy: single HLS playlist (some old server paths).
  url?: string | null;
  // Legacy: multi-quality stream map (primebox, etc.).
  streams?: Record<string, string> | null;
  subtitles?: SubtitleDto[];
}

export interface VideasySourceDto {
  url: string;
  quality?: string | null;
}

// Subtitle field names vary by Videasy server: {file, label}, {url, lang|language}, {src, name} (@JsonNames upstream).
export interface SubtitleDto {
  url?: string;
  file?: string;
  src?: string;
  language?: string;
  label?: string;
  lang?: string;
  name?: string;
}

// ======================== Videasy Server ========================
export interface VideasyServer {
  displayName: string;
  apiBase: string;
  path: string;
  // Sent as the ?language= query param to Videasy (some backends filter on it).
  language?: string;
  movieOnly?: boolean;
  mayHave4K?: boolean;
  // Display-only audio-language hint shown in the video picker and the server preference list.
  audioLabel?: string;
  qualityFilter?: string;
}
