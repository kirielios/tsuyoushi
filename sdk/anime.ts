// Aniyomi's anime source API (extensions lib 16: AnimeHttpSource with hosters), on top of the manga HttpSource so the
// bundle/host contract stays the same. An anime is an SManga and an episode an SChapter to the host: popular, latest,
// search and fetchMangaUpdate route to the anime-named request/parse pairs below, and the host asks for videos with
// getVideos(episode). `kind = "anime"` tells the host which contract a bundle speaks.
import { GET, HttpSource } from "./httpsource.ts";
import { SManga, type MangasPage, type Page, type SChapter } from "./models.ts";
import type { Request, Response } from "./network.ts";
import type { FilterList } from "./filters.ts";

type Async<T> = T | Promise<T>;

/** eu.kanade.tachiyomi.animesource.model.SAnime: the same fields as SManga. */
export type SAnime = SManga;
export const SAnime = { ...SManga, create: SManga.create };
export type AnimesPage = MangasPage;

/** SEpisode: episode_number takes the place of chapter_number. */
export interface SEpisode {
  url: string;
  name: string;
  date_upload: number;
  episode_number: number;
  scanlator?: string;
  memo: Record<string, unknown>;
}
export const SEpisode = {
  create: (): SEpisode => ({ url: "", name: "", date_upload: 0, episode_number: -1, memo: {} }),
};

export class Track {
  constructor(
    readonly url: string,
    readonly lang: string,
  ) {}
}

/** One playable stream. `headers` are what the video host needs (Referer, Origin): the host sends them for every request of it. */
export class Video {
  readonly videoUrl: string;
  readonly videoTitle: string;
  readonly headers?: Headers;
  readonly subtitleTracks: Track[];
  readonly audioTracks: Track[];
  constructor(o: { videoUrl: string; videoTitle: string; headers?: Headers; subtitleTracks?: Track[]; audioTracks?: Track[] }) {
    this.videoUrl = o.videoUrl;
    this.videoTitle = o.videoTitle;
    this.headers = o.headers;
    this.subtitleTracks = o.subtitleTracks ?? [];
    this.audioTracks = o.audioTracks ?? [];
  }
}

/** A server an episode is offered on; its videos are resolved only when the host asks (lib 16). */
export class Hoster {
  constructor(
    readonly hosterUrl: string,
    readonly hosterName: string,
  ) {}
}

/** What the host gets back from getVideos: plain data, headers as a record. */
export interface VideoDef {
  title: string;
  url: string;
  headers: Record<string, string>;
  subtitles: { lang: string; url: string }[];
}

/** Runs every block, keeps what resolved: one dead hoster must not cost the episode (keiyoushi.utils.parallelCatchingFlatMap). */
export async function parallelCatchingFlatMap<T, R>(items: T[], fn: (item: T) => Promise<R[]>): Promise<R[]> {
  const settled = await Promise.allSettled(items.map(fn));
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

const toChapter = (e: SEpisode): SChapter => ({ url: e.url, name: e.name, date_upload: e.date_upload, chapter_number: e.episode_number, scanlator: e.scanlator, memo: e.memo });

export abstract class AnimeHttpSource extends HttpSource {
  readonly kind = "anime";

  /** AnimeHttpSource.headersBuilder(): a User-Agent only, as upstream. */
  override headersBuilder(): Headers {
    return new Headers({ "User-Agent": this.host.userAgent });
  }

  // --- catalogue: the manga contract's request/parse pairs, under their anime names
  protected popularMangaRequest(page: number) {
    return this.popularAnimeRequest(page);
  }
  protected popularMangaParse(response: Response) {
    return this.popularAnimeParse(response);
  }
  protected latestUpdatesRequest(page: number) {
    return this.latestUpdatesAnimeRequest(page);
  }
  protected latestUpdatesParse(response: Response) {
    return this.latestUpdatesAnimeParse(response);
  }
  protected searchMangaRequest(page: number, query: string, filters: FilterList) {
    return this.searchAnimeRequest(page, query, filters);
  }
  protected searchMangaParse(response: Response) {
    return this.searchAnimeParse(response);
  }
  protected mangaDetailsParse(response: Response) {
    return this.animeDetailsParse(response);
  }
  /** getSearchAnime: a source that resolves ids or pasted URLs overrides this, as upstream. */
  override fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.getSearchAnime(page, query, filters);
  }
  async getSearchAnime(page: number, query: string, filters: FilterList): Promise<AnimesPage> {
    return this.searchAnimeParse(await this.executeSuccess(await this.searchAnimeRequest(page, query, filters)));
  }
  override fetchMangaDetails(anime: SAnime): Promise<SAnime> {
    return this.getAnimeDetails(anime);
  }
  async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    return this.animeDetailsParse(await this.executeSuccess(await this.animeDetailsRequest(anime)));
  }
  animeDetailsRequest(anime: SAnime): Async<Request> {
    return GET(this.baseUrl + anime.url, this.headers);
  }

  protected abstract popularAnimeRequest(page: number): Async<Request>;
  protected abstract popularAnimeParse(response: Response): Async<AnimesPage>;
  protected abstract latestUpdatesAnimeRequest(page: number): Async<Request>;
  protected abstract latestUpdatesAnimeParse(response: Response): Async<AnimesPage>;
  protected abstract searchAnimeRequest(page: number, query: string, filters: FilterList): Async<Request>;
  protected abstract searchAnimeParse(response: Response): Async<AnimesPage>;
  protected abstract animeDetailsParse(response: Response): Async<SAnime>;

  // --- episodes
  override async fetchChapterList(anime: SAnime): Promise<SChapter[]> {
    return (await this.getEpisodeList(anime)).map(toChapter);
  }
  async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    return this.episodeListParse(await this.executeSuccess(await this.episodeListRequest(anime)));
  }
  protected episodeListRequest(anime: SAnime): Async<Request> {
    return this.animeDetailsRequest(anime);
  }
  protected abstract episodeListParse(response: Response): Async<SEpisode[]>;
  getEpisodeUrl(episode: SEpisode): string {
    return this.baseUrl + episode.url;
  }

  // --- hosters and videos (lib 16)
  /** Default: the episode page is the only hoster. */
  async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return this.hosterListParse(await this.executeSuccess(await this.hosterListRequest(episode)), episode);
  }
  protected hosterListRequest(episode: SEpisode): Async<Request> {
    return GET(this.getEpisodeUrl(episode), this.headers);
  }
  protected hosterListParse(_response: Response, episode: SEpisode): Async<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }
  async getVideoList(hoster: Hoster): Promise<Video[]> {
    return this.videoListParse(await this.executeSuccess(await this.videoListRequest(hoster)), hoster);
  }
  protected videoListRequest(hoster: Hoster): Async<Request> {
    return GET(hoster.hosterUrl, this.headers);
  }
  protected videoListParse(_response: Response, hoster: Hoster): Async<Video[]> {
    throw new Error(`${this.name}: no video parser for ${hoster.hosterName}`);
  }
  /** Hoster order, best first; sources sort by their quality preference. */
  sortHosters(hosters: Hoster[]): Hoster[] {
    return hosters;
  }
  sortVideos(videos: Video[]): Video[] {
    return videos;
  }

  /** What the host calls: every hoster's videos, dead hosters skipped, best first. */
  async getVideos(episode: SEpisode): Promise<VideoDef[]> {
    const hosters = this.sortHosters(await this.getHosterList(episode));
    const videos = this.sortVideos(await parallelCatchingFlatMap(hosters, (h) => this.getVideoList(h)));
    return videos.map((v) => ({
      title: v.videoTitle,
      url: v.videoUrl,
      headers: Object.fromEntries((v.headers ?? new Headers()).entries()),
      subtitles: v.subtitleTracks.map((t) => ({ lang: t.lang, url: t.url })),
    }));
  }

  // --- not used by anime
  protected chapterListParse(): SChapter[] {
    throw new Error("anime sources list episodes (getEpisodeList)");
  }
  protected pageListParse(): Page[] {
    throw new Error("anime sources have no pages");
  }
  protected imageUrlParse(): string {
    throw new Error("anime sources have no pages");
  }
}
