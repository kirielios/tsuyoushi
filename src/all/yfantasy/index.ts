// Port of yuzono/anime-extensions src/all/yfantasy/YFantasy.kt
import {
  AnimeHttpSource,
  Filter,
  firstInstanceOrNull,
  Hoster,
  MangasPage,
  Video,
  type AnimesPage,
  type FilterList,
  type SAnime,
  type SEpisode,
} from "../../../sdk/index.ts";
import { animeEntry, feedEntry, toSEpisode, type AnimeDto, type FeedDto, type VideoEntry } from "./dto.ts";
import { EpisodeExtractor } from "./episodeextractor.ts";

const FEED_URL = "https://yfantasy.me/api/videos/feed";
const CATALOG_URL = "https://raw.githubusercontent.com/baka-bon/truyen/refs/heads/master/yfantasy.json";

const FIRST_VIDEO_ID = 10000;
const MAX_ID_GAP = 3;
const MAX_ID_PROBES = 30;

const PLAYLIST_FILE = "playlist.m3u8";
const FALLBACK_FILE = "play_720p.mp4";

const PREF_LATEST_ID_KEY = "pref_latest_video_id";

class RandomFilter extends Filter.CheckBox {
  constructor() {
    super("Random", false);
  }
}

const numericId = (e: VideoEntry) => Number.parseInt(e.videoId, 10) || FIRST_VIDEO_ID;
const toAnimesPage = (list: VideoEntry[]): AnimesPage => new MangasPage(list.map((it) => it.toSAnime()), false);
/** Locked segments carry their segment id instead of a stream url. */
const isLocked = (episode: SEpisode) => !episode.url.startsWith("http");
const episodeVideoUrl = (episode: SEpisode) => `${episode.url}/${PLAYLIST_FILE}`;

// ponytail: upstream pairs every HLS rendition with one audio rendition (and its encoding / quality / audio-language
// preferences) because Aniyomi's FFmpeg cannot switch audio in fMP4 HLS. The reader's hls.js plays the master playlist
// and picks rendition and audio itself, so the videos are the master plus the 720p MP4 fallback, and those three
// preferences are left out. Related titles (fetchRelatedAnimeList) are left out too: the host has no row for them.
export default class YFantasy extends AnimeHttpSource {
  /** The video CDN serves thumbnails and streams only to requests referred from the site. */
  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Origin", this.baseUrl);
    h.set("Referer", `${this.baseUrl}/`);
    return h;
  }

  // ============================== Popular ===============================
  override async getPopularManga(): Promise<AnimesPage> {
    return toAnimesPage(await this.getCatalog());
  }

  // =============================== Latest ===============================
  override async getLatestUpdates(): Promise<AnimesPage> {
    const catalog = await this.getCatalog();
    const newestId = await this.updateLatestId(catalog);
    const catalogId = Math.max(FIRST_VIDEO_ID, ...catalog.map(numericId));
    const ids: string[] = [];
    for (let id = catalogId + 1; id <= newestId; id++) ids.push(String(id));
    const settled = await Promise.allSettled(ids.map((id) => this.getFeedEntry(id)));
    const newEntries = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
    return toAnimesPage([...newEntries, ...catalog].sort((a, b) => numericId(b) - numericId(a)));
  }

  /**
   * Probes for ids newer than the stored one, tolerating up to MAX_ID_GAP unpublished ids in a row, and stores the
   * newest one that answered with a matching entry.
   */
  private async updateLatestId(catalog: VideoEntry[]): Promise<number> {
    const latestId = this.preferences.getInt(PREF_LATEST_ID_KEY, FIRST_VIDEO_ID);
    const storedId = Math.max(latestId, ...catalog.map(numericId));
    let newestId = storedId;
    let candidateId = storedId + 1;
    while (candidateId <= newestId + MAX_ID_GAP && candidateId <= storedId + MAX_ID_PROBES) {
      if ((await this.getFeedEntry(String(candidateId))) != null) newestId = candidateId;
      candidateId++;
    }
    if (newestId !== latestId) this.preferences.edit().putInt(PREF_LATEST_ID_KEY, newestId).apply();
    return newestId;
  }

  // =============================== Search ===============================
  override async getSearchAnime(_page: number, query: string, filters: FilterList): Promise<AnimesPage> {
    if (!query.trim()) {
      const random = firstInstanceOrNull(filters, RandomFilter)?.state === true;
      return random ? toAnimesPage(await this.getRandomFeed()) : new MangasPage([], false);
    }
    const q = query.toLowerCase();
    return toAnimesPage((await this.getCatalog()).filter((it) => it.displayTitle.toLowerCase().includes(q)));
  }

  // =============================== Filters ==============================
  override getFilterList(): FilterList {
    return [new Filter.Header("Search the catalog by title, or leave it empty and tick Random"), new RandomFilter()];
  }

  // =========================== Anime Details ============================
  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    return (await this.getEntry(anime.url)).toSAnime();
  }

  override getMangaUrl(anime: SAnime): string {
    return `${this.baseUrl}/en?video=${anime.url}`;
  }

  // ============================== Episodes ==============================
  /**
   * The session is asked first: the catalog no longer carries signed stream urls (2026-10-20), so its segments would
   * all list locked. Upstream asks the catalog first, then the session, then the feed.
   */
  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const session = await this.episodeExtractor.getAnime(anime.url);
    const entry =
      (session && animeEntry(session)) ?? (await this.getCatalog()).find((it) => it.videoId === anime.url) ?? (await this.getFeedEntry(anime.url));
    if (!entry) throw new Error(`Video ${anime.url} not found`);
    return entry.segments.map(toSEpisode);
  }

  override getEpisodeUrl(episode: SEpisode): string {
    return isLocked(episode) ? `${this.baseUrl}/en?video=${episode.url.split("_")[0]}` : episodeVideoUrl(episode);
  }

  // ============================ Video Links =============================
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    if (isLocked(episode)) return [];
    return [new Hoster(episode.url, "CDN")];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    return [
      new Video({ videoUrl: `${hoster.hosterUrl}/${PLAYLIST_FILE}`, videoTitle: "Auto", headers: this.headers }),
      new Video({ videoUrl: `${hoster.hosterUrl}/${FALLBACK_FILE}`, videoTitle: "Fallback - 720p", headers: this.headers }),
    ];
  }

  // ============================= Utilities ==============================
  private _episodeExtractor?: EpisodeExtractor;
  private get episodeExtractor() {
    return (this._episodeExtractor ??= new EpisodeExtractor(this.client, this.headers, this.baseUrl));
  }

  private catalog?: { at: number; list: Promise<VideoEntry[]> };
  /** Kept a few minutes: listing, details and episodes all read it. */
  private getCatalog(): Promise<VideoEntry[]> {
    if (!this.catalog || Date.now() - this.catalog.at > 300_000) {
      const list = this.fetchCatalog();
      list.catch(() => (this.catalog = undefined));
      this.catalog = { at: Date.now(), list };
    }
    return this.catalog.list;
  }

  /**
   * The GitHub catalog stopped carrying thumbnails (2026-10), so they come from the site's feed: one listing call for
   * most, and the feed entry of each one it left out.
   */
  private async fetchCatalog(): Promise<VideoEntry[]> {
    const [catalog, feed] = await Promise.all([
      this.client.get(CATALOG_URL, this.headers).then((r) => r.parseAs<AnimeDto[]>()),
      this.client.get(`${FEED_URL}?limit=100`, this.headers).then((r) => r.parseAs<FeedDto>().items, () => []),
    ]);
    const images = new Map(feed.map((it) => [it.id, it.publicSegment?.imageUrl]));
    await Promise.all(
      catalog
        .filter((d) => d.currentSegment && !d.currentSegment.imageUrl && !images.get(d.videoId))
        .map(async (d) => {
          const item = await this.client.get(`${FEED_URL}?limit=1&videoId=${encodeURIComponent(d.videoId)}`, this.headers).then((r) => r.parseAs<FeedDto>().items[0], () => undefined);
          if (item?.id === d.videoId) images.set(d.videoId, item.publicSegment?.imageUrl);
        }),
    );
    for (const d of catalog) if (d.currentSegment && !d.currentSegment.imageUrl) d.currentSegment.imageUrl = images.get(d.videoId) ?? null;
    return catalog.map(animeEntry);
  }

  private async getRandomFeed(): Promise<VideoEntry[]> {
    return (await this.client.get(`${FEED_URL}?shuffleTop=1`, this.headers)).parseAs<FeedDto>().items.map(feedEntry);
  }

  /** The feed answers with its own first entry when the requested id does not exist. */
  private async getFeedEntry(videoId: string): Promise<VideoEntry | null> {
    const item = (await this.client.get(`${FEED_URL}?limit=1&videoId=${encodeURIComponent(videoId)}`, this.headers)).parseAs<FeedDto>().items[0];
    return item && item.id === videoId ? feedEntry(item) : null;
  }

  /** The catalog takes precedence, as it is the only source that carries the hidden segments. */
  private async getEntry(videoId: string): Promise<VideoEntry> {
    const entry = (await this.getCatalog()).find((it) => it.videoId === videoId) ?? (await this.getFeedEntry(videoId));
    if (!entry) throw new Error(`Video ${videoId} not found`);
    return entry;
  }

  // --- the HttpSource request/parse pairs: every call above is overridden
  protected popularAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected popularAnimeParse(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(): never {
    throw new Error("Not used");
  }
  protected searchAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected searchAnimeParse(): never {
    throw new Error("Not used");
  }
  protected animeDetailsParse(): never {
    throw new Error("Not used");
  }
  protected episodeListParse(): never {
    throw new Error("Not used");
  }
}
