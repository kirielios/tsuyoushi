// Port of yuzono/anime-extensions src/all/movy/Movy.kt
import {
  AnimeHttpSource,
  EditTextPreference,
  firstInstanceOrNull,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  SAnime,
  SEpisode,
  type AnimesPage,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { realTitle, type MediaItemDto, type MovieDetailDto, type PageDto, type TvDetailDto, type TvSeasonDetailDto } from "./dto.ts";
import * as Filters from "./filters.ts";
import { MovyExtractor } from "./movyextractor.ts";

// Deep-link prefix (MovyUrlActivity upstream; here only a pasted "id:" query or a site URL).
const PREFIX_ID = "id:";
const DEEP_LINK_PATH_REGEX = /^(movie|tv)\/\d+$/;
const animeUrlRegex = /\/(movie|tv)\/(\d+)/;
const qualityRegex = /(\d{3,4})[pP]?/;
const ANIMATION_GENRE_ID = 16;
// Rating sort uses a higher floor: TMDB has many obscure titles with a handful of perfect-score votes.
const MIN_VOTES_FOR_RATING_SORT = "200";
const MIN_VOTES_FOR_RECENT_SORT = "50";

const PREF_LATEST_KEY = "pref_latest";
const PREF_LATEST_DEFAULT = "movie";
const PREF_QUALITY_KEY = "pref_quality";
const PREF_QUALITY_DEFAULT = "1080";
const PREF_SUB_LIMIT_KEY = "pref_sub_limit";
const PREF_SUB_LIMIT_DEFAULT = "25";
const PREF_SERVERS_KEY = "pref_servers";
const PREF_SERVERS_DEFAULT = ["Miami", "Boise", "Vegas", "Reno", "Oakland"];

const tmdbImage = (path: string | null | undefined, size = "w500") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined);
const today = () => new Date().toISOString().slice(0, 10);
const parseDate = (dateStr: string | null | undefined) => (dateStr ? Date.parse(dateStr) || 0 : 0);
const joinNames = (list: { name: string }[] | undefined) => (list ?? []).map((it) => it.name).join(", ");
const nonBlank = (s: string | null | undefined) => (s?.trim() ? s : null);
const qualityOf = (title: string) => Number(qualityRegex.exec(title)?.[1] ?? NaN) || (/4k/i.test(title) ? 2160 : 0);

// ponytail: upstream's Preferred Domain list has one entry (www.movy.sx), so baseUrl is meta.json's; add a mirror list
// to meta.json if the site gains domains. Seasons (FetchType.Seasons) and related titles are Aniyomi UI features the
// host has no screen for: a TV show lists every season's episodes, as upstream's no-season path does.
export default class Movy extends AnimeHttpSource {
  // Movy/Videasy proxy
  private readonly apiUrl = "https://db.wecollege.net/3";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2, 1000, (url) => url.host.includes("wecollege.net"));
  }

  private _extractor?: MovyExtractor;
  private get extractor() {
    return (this._extractor ??= new MovyExtractor(this.client, this.headers));
  }

  private get latestPref() {
    return this.preferences.getString(PREF_LATEST_KEY, PREF_LATEST_DEFAULT);
  }
  private get enabledServerNames(): string[] {
    // Drop server names removed from the catalog; restore defaults if nothing valid remains (clearOldPrefs upstream).
    const valid = this.preferences.getStringSet(PREF_SERVERS_KEY, PREF_SERVERS_DEFAULT).filter((s) => MovyExtractor.SERVER_DISPLAY_NAMES.includes(s));
    return valid.length ? valid : PREF_SERVERS_DEFAULT;
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.apiUrl}/trending/all/week?language=en-US&page=${page}`);
  }
  protected popularAnimeParse(response: Response) {
    return this.parseMediaPage(response);
  }

  // =============================== Latest ===============================
  override async getLatestUpdates(page: number): Promise<AnimesPage> {
    const types = this.latestPref === "movie" ? ["movie", "tv"] : ["tv", "movie"];
    const settled = await Promise.allSettled(types.map(async (t) => this.parseMediaPage(await this.executeSuccess(this.latestUpdatesRequestFor(page, t)))));
    const animePages = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    return new MangasPage(
      animePages.flatMap((p) => p.mangas),
      animePages.some((p) => p.hasNextPage),
    );
  }
  protected latestUpdatesAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.parseMediaPage(response);
  }
  private latestUpdatesRequestFor(page: number, mediaType: string) {
    const sortBy = mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
    const dateField = mediaType === "movie" ? "primary_release_date.lte" : "first_air_date.lte";
    const q = new URLSearchParams({ language: "en-US", sort_by: sortBy, page: String(page), "vote_count.gte": "50", [dateField]: today() });
    return GET(`${this.apiUrl}/discover/${mediaType}?${q}`);
  }

  // =============================== Search ===============================
  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<AnimesPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      if (url.host !== new URL(this.baseUrl).host) throw new Error("Unsupported url");
      const [type, rawId] = url.pathname.split("/").filter(Boolean);
      if (!rawId || (type !== "movie" && type !== "tv")) throw new Error("Unsupported url");
      return this.getSearchAnime(page, `${PREFIX_ID}${type}/${rawId}`, filters);
    }

    if (query.startsWith(PREFIX_ID)) {
      const rawPath = query.slice(PREFIX_ID.length);
      if (!DEEP_LINK_PATH_REGEX.test(rawPath)) return new MangasPage([], false);
      const url = `/${rawPath}`;
      const temp = SAnime.create();
      temp.url = url;
      try {
        const anime = await this.getAnimeDetails(temp);
        anime.url = url;
        return new MangasPage([anime], false);
      } catch {
        return new MangasPage([], false);
      }
    }

    const typeIndex = firstInstanceOrNull(filters, Filters.TypeFilter)?.state ?? Filters.TYPE_ALL;
    const isAnimes = typeIndex === Filters.TYPE_ANIMES;
    const isAll = typeIndex === Filters.TYPE_ALL;

    let rawPages: PageDto<MediaItemDto>[];
    if (query.trim() && isAll) {
      rawPages = [await this.fetchMediaPage(this.textSearchRequest(page, query, "multi"))].filter((p) => p != null);
    } else {
      const mediaTypes =
        typeIndex === Filters.TYPE_MOVIES ? ["movie"] : typeIndex === Filters.TYPE_TV || isAnimes ? ["tv"] : this.latestPref === "movie" ? ["movie", "tv"] : ["tv", "movie"];
      rawPages = (
        await Promise.all(
          mediaTypes.map((mediaType) => this.fetchMediaPage(query.trim() ? this.textSearchRequest(page, query, mediaType) : this.discoverRequest(page, mediaType, filters, isAnimes))),
        )
      ).filter((p) => p != null);
    }

    let items = rawPages.flatMap((p) => p.results);
    if (query.trim() && isAll) items = items.filter((it) => it.media_type === "movie" || it.media_type === "tv");
    if (isAnimes) items = items.filter(isLikelyAnime);
    return new MangasPage(
      items.map(mediaItemToSAnime),
      rawPages.some((p) => p.page < p.total_pages),
    );
  }

  private async fetchMediaPage(request: ReturnType<typeof GET>): Promise<PageDto<MediaItemDto> | null> {
    try {
      return (await this.executeSuccess(request)).parseAs<PageDto<MediaItemDto>>();
    } catch {
      return null;
    }
  }

  protected searchAnimeRequest(): never {
    throw new Error("Not used; getSearchAnime is overridden");
  }
  protected searchAnimeParse(response: Response) {
    return this.parseMediaPage(response);
  }

  private textSearchRequest(page: number, query: string, mediaType: string) {
    return GET(`${this.apiUrl}/search/${mediaType}?${new URLSearchParams({ language: "en-US", page: String(page), query })}`);
  }

  private discoverRequest(page: number, mediaType: string, filters: FilterList, animesOnly: boolean) {
    const sortIndex = firstInstanceOrNull(filters, Filters.SortFilter)?.state ?? Filters.SORT_POPULAR;
    const sortBy =
      sortIndex === Filters.SORT_RATING ? "vote_average.desc" : sortIndex === Filters.SORT_RECENT ? (mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc") : "popularity.desc";

    const genreMap = mediaType === "movie" ? Filters.MOVIE_GENRE_MAP : Filters.TV_GENRE_MAP;
    const userGenres = (firstInstanceOrNull(filters, Filters.GenreFilter)?.state ?? []).filter((it) => it.state).flatMap((it) => genreMap[it.name] ?? []);
    const genreIds = animesOnly ? [...new Set(["16", ...userGenres])] : userGenres;
    const genreParam = genreIds.join(",");

    const providers = (firstInstanceOrNull(filters, Filters.WatchProviderFilter)?.state ?? [])
      .filter((it) => it.state)
      .map((it) => it.id)
      .join("|");

    const q = new URLSearchParams({ sort_by: sortBy, language: "en-US", page: String(page) });
    if (genreParam.trim()) q.set("with_genres", genreParam);
    if (animesOnly) q.set("with_original_language", "ja");
    if (providers.trim()) {
      q.set("with_watch_providers", providers);
      q.set("watch_region", "US");
    }
    if (sortIndex === Filters.SORT_RATING) q.set("vote_count.gte", MIN_VOTES_FOR_RATING_SORT);
    if (sortIndex === Filters.SORT_RECENT) {
      q.set("vote_count.gte", MIN_VOTES_FOR_RECENT_SORT);
      q.set(mediaType === "movie" ? "primary_release_date.lte" : "first_air_date.lte", today());
    }
    return GET(`${this.apiUrl}/discover/${mediaType}?${q}`);
  }

  // ============================== Filters ==============================
  override getFilterList(): FilterList {
    return Filters.getFilterList();
  }

  // ============================== Details ==============================
  override getMangaUrl(anime: SAnime): string {
    const path = anime.url.includes("/season/") ? anime.url.split("/season/")[0] : anime.url;
    return `${this.baseUrl}${path}`;
  }

  private animeUrlToId(anime: SAnime): [string, string] {
    const m = animeUrlRegex.exec(anime.url);
    if (!m) throw new Error(`Invalid anime URL: ${anime.url}`);
    return [m[1], m[2]];
  }

  override animeDetailsRequest(anime: SAnime) {
    const [type, id] = this.animeUrlToId(anime);
    return GET(`${this.apiUrl}/${type}/${id}?append_to_response=external_ids`);
  }

  protected animeDetailsParse(response: Response): SAnime {
    try {
      return response.url.includes("/movie/") ? movieDetailsParse(response) : tvDetailsParse(response);
    } catch (e) {
      throw new Error("Failed to parse details.", { cause: e });
    }
  }

  // ============================== Episodes ==============================
  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const parts = anime.url.replace(/^\/+/, "").split("/");
    if (parts[0] === "tv") {
      const tvId = parts[1];
      const tv = (await this.client.get(`${this.apiUrl}/tv/${tvId}?append_to_response=external_ids`)).parseAs<TvDetailDto>();
      const extraDataEncoded = JSON.stringify({ first: tv.name, second: tv.first_air_date?.slice(0, 4) ?? "", third: tv.external_ids?.imdb_id ?? "" });
      const seasonNumbers = parts.includes("season") ? [Number(parts[parts.length - 1])] : (tv.seasons ?? []).filter((s) => s.season_number > 0).map((s) => s.season_number);
      const perSeason = await Promise.all(
        seasonNumbers.map(async (seasonNum) => {
          try {
            const seasonDetail = (await this.client.get(`${this.apiUrl}/tv/${tvId}/season/${seasonNum}`)).parseAs<TvSeasonDetailDto>();
            return [...(seasonDetail.episodes ?? [])].reverse().map((episode) => {
              const ep = SEpisode.create();
              ep.name = `S${seasonNum} E${episode.episode_number} - ${episode.name}`;
              ep.episode_number = episode.episode_number;
              ep.scanlator = `Season ${seasonNum}`;
              ep.date_upload = parseDate(episode.air_date);
              ep.url = `tv/${tvId}/${seasonNum}/${episode.episode_number}#${extraDataEncoded}`;
              return ep;
            });
          } catch (e) {
            if (seasonNumbers.length === 1) throw e;
            return [];
          }
        }),
      );
      const season = (e: SEpisode) => Number(e.scanlator?.split(" ")[1]) || 0;
      return perSeason.flat().sort((a, b) => season(b) - season(a) || b.episode_number - a.episode_number);
    }
    const movie = (await this.client.get(String(this.animeDetailsRequest(anime).url))).parseAs<MovieDetailDto>();
    const extraDataEncoded = JSON.stringify({ first: movie.title, second: movie.release_date?.slice(0, 4) ?? "", third: movie.external_ids?.imdb_id ?? "" });
    const ep = SEpisode.create();
    ep.name = "Movie";
    ep.episode_number = 1;
    ep.date_upload = parseDate(movie.release_date);
    ep.url = `movie/${movie.id}#${extraDataEncoded}`;
    return [ep];
  }

  protected episodeListParse(): never {
    throw new Error("Not used");
  }

  // ============================= Hosters ===============================
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const [path, extraDataEncoded] = splitOnce(episode.url, "#");
    const isMovie = path.startsWith("movie");
    const enabledServers = this.enabledServerNames;
    return MovyExtractor.VIDEASY_SERVERS.filter((server) => (!server.movieOnly || isMovie) && enabledServers.includes(server.displayName)).map(
      // internalData upstream; this Hoster carries it in hosterUrl
      (server) => new Hoster(`${server.displayName}|||${path}|||${extraDataEncoded}`, `${server.displayName} (${server.audioLabel ?? "Original"})`),
    );
  }

  // ============================ Video Links ============================
  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const parts = hoster.hosterUrl.split("|||");
    if (parts.length < 3) return [];
    const [serverName, path] = parts;
    const extraDataEncoded = parts.slice(2).join("|||");
    const server = MovyExtractor.VIDEASY_SERVERS.find((it) => it.displayName === serverName);
    if (!server) return [];
    const { first: title, second: year, third: imdbId } = JSON.parse(extraDataEncoded) as { first: string; second: string; third: string };
    const subLimit = Number.parseInt(this.preferences.getString(PREF_SUB_LIMIT_KEY, PREF_SUB_LIMIT_DEFAULT) ?? "", 10);
    return this.extractor.videosForServer({
      server,
      path,
      title,
      year,
      imdbId,
      baseUrl: new URL(this.baseUrl).origin,
      subLimit: Number.isNaN(subLimit) ? Number(PREF_SUB_LIMIT_DEFAULT) : subLimit,
    });
  }

  override sortVideos(videos: Video[]): Video[] {
    const prefInt = Number(this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)) || 1080;
    return [...videos].sort((a, b) => {
      const qa = qualityOf(a.videoTitle);
      const qb = qualityOf(b.videoTitle);
      return Number(qb === prefInt) - Number(qa === prefInt) || qb - qa;
    });
  }

  override getEpisodeUrl(episode: SEpisode): string {
    return `${this.baseUrl}/${episode.url.split("#")[0]}`;
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const quality = new ListPreference(screen.context);
    quality.key = PREF_QUALITY_KEY;
    quality.title = "Preferred Quality";
    quality.entries = ["2160p", "1080p", "720p", "480p", "360p"];
    quality.entryValues = ["2160", "1080", "720", "480", "360"];
    quality.setDefaultValue(PREF_QUALITY_DEFAULT);
    quality.summary = "%s";
    screen.addPreference(quality);

    const latest = new ListPreference(screen.context);
    latest.key = PREF_LATEST_KEY;
    latest.title = "Preferred 'Latest' Page";
    latest.entries = ["Movies", "TV Shows"];
    latest.entryValues = ["movie", "tv"];
    latest.setDefaultValue(PREF_LATEST_DEFAULT);
    latest.summary = "%s";
    screen.addPreference(latest);

    const subLimit = new EditTextPreference(screen.context);
    subLimit.key = PREF_SUB_LIMIT_KEY;
    subLimit.title = "Subtitle Search Limit";
    subLimit.summary = "Limit subtitle count (a number, 0 for none).";
    subLimit.setDefaultValue(PREF_SUB_LIMIT_DEFAULT);
    screen.addPreference(subLimit);

    // Display "Name (Language)" but persist bare display names so the catalog code can match them as keys.
    const servers = new MultiSelectListPreference(screen.context);
    servers.key = PREF_SERVERS_KEY;
    servers.title = "Enabled Servers";
    servers.entries = MovyExtractor.VIDEASY_SERVERS.map((s) => `${s.displayName} (${s.audioLabel ?? "Unknown"})`);
    servers.entryValues = MovyExtractor.SERVER_DISPLAY_NAMES;
    servers.setDefaultValue(PREF_SERVERS_DEFAULT);
    servers.summary = "Select servers to enable. Languages shown per server.";
    screen.addPreference(servers);
  }

  // ============================= Utilities ==============================
  private parseMediaPage(response: Response): AnimesPage {
    const pageDto = response.parseAs<PageDto<MediaItemDto>>();
    return new MangasPage(pageDto.results.map(mediaItemToSAnime), pageDto.page < pageDto.total_pages);
  }
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + sep.length)];
}

function isLikelyAnime(item: MediaItemDto): boolean {
  const isJapanese = item.original_language === "ja" || (item.origin_country ?? []).includes("JP");
  return isJapanese && (item.genre_ids ?? []).includes(ANIMATION_GENRE_ID);
}

function mediaItemToSAnime(media: MediaItemDto): SAnime {
  const anime = SAnime.create();
  anime.title = realTitle(media);
  const type = media.media_type ?? (media.title != null ? "movie" : "tv");
  anime.url = `/${type}/${media.id}`;
  anime.thumbnail_url = tmdbImage(media.poster_path);
  return anime;
}

function parseStatus(status: string | null | undefined): number {
  if (status === "Released" || status === "Ended") return SAnime.COMPLETED;
  if (status === "Returning Series" || status === "In Production") return SAnime.ONGOING;
  return SAnime.UNKNOWN;
}

const score = (v: number | undefined) => (v && v > 0 ? `**Score:** ★ ${v.toFixed(1)}` : null);

function movieDetailsParse(response: Response): SAnime {
  const movie = response.parseAs<MovieDetailDto>();
  const anime = SAnime.create();
  anime.title = movie.title;
  anime.url = `/movie/${movie.id}`;
  anime.thumbnail_url = tmdbImage(movie.poster_path);
  anime.author = joinNames(movie.production_companies);
  anime.genre = joinNames(movie.genres);
  anime.status = parseStatus(movie.status);
  const runtime = movie.runtime && movie.runtime > 0 ? movie.runtime : null;
  const details = [
    "**Type:** Movie",
    score(movie.vote_average),
    nonBlank(movie.tagline) && `**Tagline:** *${movie.tagline}*`,
    nonBlank(movie.release_date) && `**Release Date:** ${movie.release_date}`,
    movie.origin_country?.length ? `**Country:** ${movie.origin_country.join(", ")}` : null,
    nonBlank(movie.original_title) && movie.original_title!.trim() !== movie.title.trim() ? `**Original Title:** ${movie.original_title}` : null,
    runtime && `**Runtime:** ${runtime >= 60 ? `${Math.floor(runtime / 60)}h ` : ""}${runtime % 60}m`,
    nonBlank(movie.homepage) && `**[Official Site](${movie.homepage})**`,
    movie.external_ids?.imdb_id ? `**[IMDB](https://www.imdb.com/title/${movie.external_ids.imdb_id})**` : null,
  ].filter(Boolean);
  anime.description = (movie.overview ? `${movie.overview}\n\n` : "") + details.join("\n");
  return anime;
}

function tvDetailsParse(response: Response): SAnime {
  const tv = response.parseAs<TvDetailDto>();
  const anime = SAnime.create();
  anime.title = tv.name;
  anime.url = `/tv/${tv.id}`;
  anime.thumbnail_url = tmdbImage(tv.poster_path);
  anime.author = joinNames(tv.production_companies);
  anime.artist = joinNames(tv.networks);
  anime.genre = joinNames(tv.genres);
  anime.status = parseStatus(tv.status);
  const details = [
    "**Type:** TV Show",
    score(tv.vote_average),
    nonBlank(tv.tagline) && `**Tagline:** *${tv.tagline}*`,
    nonBlank(tv.first_air_date) && `**First Air Date:** ${tv.first_air_date}`,
    nonBlank(tv.last_air_date) && `**Last Air Date:** ${tv.last_air_date}`,
    tv.origin_country?.length ? `**Country:** ${tv.origin_country.join(", ")}` : null,
    nonBlank(tv.original_name) && tv.original_name!.trim() !== tv.name.trim() ? `**Original Name:** ${tv.original_name}` : null,
    nonBlank(tv.homepage) && `**[Official Site](${tv.homepage})**`,
    tv.external_ids?.imdb_id ? `**[IMDB](https://www.imdb.com/title/${tv.external_ids.imdb_id})**` : null,
  ].filter(Boolean);
  anime.description = (tv.overview ? `${tv.overview}\n\n` : "") + details.join("\n");
  return anime;
}
