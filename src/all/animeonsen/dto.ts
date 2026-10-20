// Port of yuzono/anime-extensions src/all/animeonsen/dto/AnimeOnsenDto.kt
export type AnimeListItem = {
  content_id: string;
  content_title?: string | null;
  content_title_en?: string | null;
  content_title_jp?: string | null;
  content_image?: string | null;
  thumbnail?: string | null;
};
export type AnimeListResponse = { content: AnimeListItem[]; cursor: { next: unknown[] } };
/** MalSerializer: mal_data comes as a primitive (false) when MAL knows nothing; read that as an empty object. */
export type MalData = {
  genres?: { name: string }[] | null;
  status?: string | null;
  studios?: { name: string }[] | null;
  synopsis?: string | null;
  mean_score?: number | null;
  rating?: string | null;
};
export type AnimeDetails = { content_id: string; content_title?: string | null; content_title_en?: string | null; mal_id?: number | null; subtitle_support?: boolean | null; mal_data?: MalData | unknown };
export type EpisodeDto = { contentTitle_episode_en?: string | null; contentTitle_episode_jp?: string | null };
export type VideoData = { metadata: { subtitles: Record<string, string> }; uri: { stream: string; subtitles: Record<string, string> } };
export type MeilisearchResponse = { hits: AnimeListItem[] };
export type SearchResponse = { status: number; result: AnimeListItem[] };

export const malData = (d: AnimeDetails): MalData | null => (d.mal_data && typeof d.mal_data === "object" ? (d.mal_data as MalData) : d.mal_data == null ? null : {});
