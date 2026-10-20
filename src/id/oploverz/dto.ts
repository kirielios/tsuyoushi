// Port of yuzono/anime-extensions src/id/oploverz/Dto.kt
import { SAnime, SEpisode } from "../../../sdk/index.ts";

export type MetaDto = { currentPage: number; lastPage: number };
const hasNextPage = (meta: MetaDto) => meta.currentPage < meta.lastPage;

export type SeriesDto = {
  slug: string;
  title: string;
  poster?: string | null;
  description?: string | null;
  status?: string | null;
  genres?: { name: string }[] | null;
  studio?: { name: string } | null;
};

export function seriesToSAnime(data: SeriesDto): SAnime {
  const anime = SAnime.create();
  anime.url = `/series/${data.slug}`;
  anime.title = data.title;
  anime.thumbnail_url = data.poster ?? undefined;
  anime.description = data.description ?? undefined;
  anime.genre = data.genres?.map((it) => it.name).join(", ");
  anime.author = data.studio?.name;
  const status = data.status?.toLowerCase();
  anime.status = status === "ongoing" ? SAnime.ONGOING : status === "completed" ? SAnime.COMPLETED : SAnime.UNKNOWN;
  return anime;
}

export type SeriesListResponseDto = { data: SeriesDto[]; meta: MetaDto };
export const seriesListToAnimesPage = (r: SeriesListResponseDto): [SAnime[], boolean] => [r.data.map(seriesToSAnime), hasNextPage(r.meta)];

export type SeriesResponseDto = { data: SeriesDto };

export type LatestEpisodesResponseDto = { data: { series: SeriesDto }[]; meta: MetaDto };
export function latestToAnimesPage(r: LatestEpisodesResponseDto): [SAnime[], boolean] {
  const animes = r.data.map((it) => seriesToSAnime(it.series));
  return [animes.filter((a, i) => animes.findIndex((b) => b.url === a.url) === i), hasNextPage(r.meta)];
}

export type EpisodeDto = { episodeNumber: string; releasedAt?: string | null };
export type EpisodeListResponseDto = { data: EpisodeDto[] };

export function episodeToSEpisode(data: EpisodeDto, slug: string): SEpisode {
  const episode = SEpisode.create();
  episode.url = `/series/${slug}/episode/${data.episodeNumber}`;
  episode.name = `Episode ${data.episodeNumber}`;
  episode.episode_number = Number.parseFloat(data.episodeNumber) || 1;
  episode.date_upload = data.releasedAt ? Date.parse(data.releasedAt) || 0 : 0;
  return episode;
}

export type StreamDto = { source: string; url: string };
export type EpisodeDetailResponseDto = { data: { streamUrl?: StreamDto[] | null } };

export type FiledonPageDto = { props: { url: string } };
