// Port of yuzono/anime-extensions src/all/streamingcommunity/StreamingCommunity.kt (and StreamingCommunityFactory.kt)
//
// The factory's four sources are en/it x movie/tv in meta.json; the tv ones are the second source of their lang
// (id ":2"), which is how showType is told apart. SubtitleServer.kt (a loopback NanoHTTPD proxy) is not ported.
import {
  AnimeHttpSource,
  DateTimeFormatter,
  EditTextPreference,
  Filter,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  SEpisode,
  toHttpUrl,
  tryParseInstant,
  Video,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type SAnime,
} from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import { isActive, titleToSAnime, toSAnimeUpdate, type BrowseResponse, type SingleShowResponse, type StreamServer } from "./dto.ts";
import { AgeFilter, FeaturedFilter, GenresFilter, QualityFilter, ScoreFilter, ServiceFilter, SortFilter, YearFilter } from "./filters.ts";
import { messages } from "./messages.ts";

const DOMAIN_DEFAULT = "https://streamingunity.vip";
// upstream: "custom_domain_v${BuildConfig.VERSION_NAME}" (libVersion.extVersionCode)
const PREF_CUSTOM_DOMAIN_KEY = "custom_domain_v16.23";
const PAGE_SIZE = 60;
const MAX_ARCHIVE_PAGES = 20;

const TOP10_TRENDING_REGEX = /\/browse\/(top10|trending)/;
const PLAYLIST_URL_REGEX = /url: ?'(.*?)'/;
const EXPIRES_REGEX = /'expires': ?'(\d+)'/;
const TOKEN_REGEX = /'token': ?'([\w-]+)'/;

// window.streams = [{"name":"Server1","active":false,"url":"...playlist/594985?b=1\\u0026ub=1"},
//                   {"name":"Server2","active":1,"url":"...playlist/594985?b=1\\u0026ab=1"}]
const STREAMS_REGEX = /window\.streams\s*=\s*(\[.*?\}\s*\])/s;
const CAN_PLAY_FHD_REGEX = /window\.canPlayFHD\s*=\s*(\w+)/;
const QUALITY_REGEX = /(\d+)p/;

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];
const PREF_QUALITY_VALUES = ["1080", "720", "480", "360"];
const PREF_QUALITY_DEFAULT = PREF_QUALITY_VALUES[0];

const DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd");
const parseDateTime = (dateStr: string) => tryParseInstant(dateStr);
const parseDate = (dateStr: string) => DATE_FORMATTER.tryParseDate(dateStr);

/** android.webkit.URLUtil.isValidUrl */
const isValidUrl = (url: string) => /^https?:\/\/./i.test(url);
const sanitizeDomain = (s: string) => {
  const t = s.trim();
  return (t.endsWith("/") ? t.slice(0, -1) : t) || DOMAIN_DEFAULT;
};

export default class StreamingCommunity extends AnimeHttpSource {
  private readonly showType = this.id.endsWith(":2") ? "tv" : "movie";

  private get homepage(): string {
    return sanitizeDomain(this.preferences.getString(PREF_CUSTOM_DOMAIN_KEY, DOMAIN_DEFAULT) ?? "");
  }

  /**
   * Upstream follows redirects itself and moves to the domain a redirect points at. The host follows redirects, so
   * the final URL of a response on the current domain tells the same thing.
   */
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);
      const homepage = this.homepage;
      if (new URL(request.url).origin === homepage) {
        const redirected = new URL(response.url);
        const redirectedDomain = `${redirected.protocol}//${redirected.host}`;
        if (redirectedDomain !== homepage) this.updateDomain(redirectedDomain);
      }
      return response;
    });
  }

  override get baseUrl(): string {
    return `${this.homepage}/${this.lang}`;
  }

  get supportsLatest() {
    return true;
  }

  private _intl?: Intl;
  private get intl(): Intl {
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "it"], messages }));
  }

  private get apiHeaders(): Headers {
    const h = new Headers(this.headers);
    h.append("Origin", this.homepage);
    h.append("Referer", `${this.homepage}/`);
    return h;
  }

  private get playlistUtils() {
    return new PlaylistUtils(this.client, this.headers);
  }

  // ============================== Popular ===============================

  protected popularAnimeRequest(page: number) {
    switch (page) {
      case 1:
        return GET(`${this.baseUrl}/browse/top10?type=${this.showType}`, this.apiHeaders);
      case 2:
        return GET(`${this.baseUrl}/browse/trending?type=${this.showType}`, this.apiHeaders);
      default:
        return GET(`${this.baseUrl}/archive?type=${this.showType}&sort=views&page=${page - 2}`, this.apiHeaders);
    }
  }

  private imageCdn = "";

  protected popularAnimeParse(response: Response) {
    const animeList = this.parseBrowse(response);
    return new MangasPage(animeList, browseHasNextPage(response, animeList.length));
  }

  // =============================== Latest ===============================

  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/browse/latest?type=${this.showType}&page=${page}`, this.apiHeaders);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =============================== Search ===============================

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const find = <T>(cls: abstract new (...args: never[]) => T) => filters.find((f) => f instanceof cls) as T | undefined;
    const genresFilter = find(GenresFilter);
    const featuredFilter = find(FeaturedFilter);

    const httpUrlBuilder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("archive").addQueryParameter("search", query);
    for (const f of [find(SortFilter), find(YearFilter), find(ScoreFilter), find(ServiceFilter), find(QualityFilter), find(AgeFilter)]) {
      if (f && !f.isDefault()) httpUrlBuilder.addQueryParameter(f.uri, f.toUriPart());
    }

    genresFilter?.addToUri(httpUrlBuilder);

    if (featuredFilter && !featuredFilter.isDefault()) httpUrlBuilder.addQueryParameter(featuredFilter.uri, featuredFilter.toUriPart());

    httpUrlBuilder.addQueryParameter("type", this.showType).addQueryParameter("page", String(page));

    return GET(httpUrlBuilder.build(), this.apiHeaders);
  }

  protected searchAnimeParse(response: Response) {
    const animeList = this.parseBrowse(response);
    return new MangasPage(animeList, browseHasNextPage(response, animeList.length));
  }

  // =========================== Anime Details ============================

  override animeDetailsRequest(anime: SAnime) {
    return GET(`${this.baseUrl}/titles/${anime.url}`, this.headers);
  }

  override getMangaUrl(anime: SAnime): string {
    return `${this.baseUrl}/titles/${anime.url}`;
  }

  protected animeDetailsParse(response: Response): SAnime {
    const title = getData<SingleShowResponse>(response).props.title;
    if (!title) throw new Error("Anime details parsing error: title is null.");
    return toSAnimeUpdate(title, this.intl);
  }

  protected override relatedMangaListRequest(anime: SAnime) {
    return this.animeDetailsRequest(anime);
  }

  protected override async relatedMangaListParse(response: Response): Promise<SAnime[]> {
    const sliders = getData<SingleShowResponse>(response).props.sliders;
    return sliders?.flatMap((slider) => slider.titles.map((it) => titleToSAnime(it, this.getImageCdn()))) ?? [];
  }

  // ============================== Episodes ==============================

  protected async episodeListParse(response: Response): Promise<SEpisode[]> {
    const data = getData<SingleShowResponse>(response).props;
    const episodeList: SEpisode[] = [];

    const title = data.title;
    if (title == null) return [];

    const loadedSeason = data.loadedSeason;
    if (loadedSeason == null) {
      const episode = SEpisode.create();
      episode.name = "Film";
      episode.url = String(title.id);
      const date = title.release_date ?? title.last_air_date;
      const dateTime = title.created_at ?? title.updated_at;
      episode.date_upload = date != null ? parseDate(date) : dateTime != null ? parseDateTime(dateTime) : 0;
      episodeList.push(episode);
    } else {
      const seasonIntl = this.intl.get("season");
      const episodeIntl = this.intl.get("episode");

      // Concurrently fetch episode data for all seasons
      const allSeasonEpisodes = await Promise.all(
        (title.seasons ?? []).map(async (season) => {
          const episodes =
            season.id === loadedSeason.id
              ? loadedSeason.episodes
              : (getData<SingleShowResponse>(await this.client.get(`${response.url}/season-${season.number}`, this.apiHeaders)).props.loadedSeason?.episodes ?? []);
          return [season, episodes] as const;
        }),
      );

      for (const [season, episodeData] of allSeasonEpisodes) {
        for (const episode of episodeData) {
          const ep = SEpisode.create();
          ep.name = `${seasonIntl} ${season.number} ${episodeIntl} ${episode.number} - ${episode.name}`;
          ep.url = `${title.id}?episode_id=${episode.id}&next_episode=1`;
          const dateTime = episode.created_at ?? episode.updated_at;
          ep.date_upload = season.release_date != null ? parseDate(season.release_date) : dateTime != null ? parseDateTime(dateTime) : 0;
          episodeList.push(ep);
        }
      }
    }

    const episodes = episodeList.map((episode, index) => ((episode.episode_number = index + 1), episode)).reverse();

    if (title.preview) {
      const preview = SEpisode.create();
      preview.name = "Preview";
      preview.episode_number = 0;
      preview.url = title.preview.embed_url;
      episodes.push(preview);
    }
    return episodes;
  }

  // ============================ Video Links =============================

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(episode.url, this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const url = hoster.hosterUrl;
    if (url.startsWith("https://")) return this.vixCloudExtractor(url);
    const iframeUrl = (await this.client.get(`${this.baseUrl}/iframe/${url}`, this.headers)).asJsoup().selectFirst("iframe[src]")?.attr("abs:src");
    if (!iframeUrl) throw new Error("Failed to extract iframe");
    return this.vixCloudExtractor(iframeUrl);
  }

  // https://vixcloud.co/embed/262817?token=321fd9c4f94fcd28b522d1f3ba2a8d77&expires=1752778149&canPlayFHD=1&canBypassAds=1
  private async vixCloudExtractor(iframeUrl: string): Promise<Video[]> {
    const iframeHeaders = new Headers(this.headers);
    iframeHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
    // ponytail: upstream also sets Host; fetch forbids it and sends the right one anyway
    iframeHeaders.append("Referer", `${this.baseUrl}/`);

    const iframe = (await this.client.get(iframeUrl, iframeHeaders)).asJsoup();
    const script = iframe.selectFirst("script:containsData(masterPlaylist)")?.data();
    if (script == null) throw new Error("Failed to extract masterPlaylist script");
    const playlistUrl = PLAYLIST_URL_REGEX.exec(script)?.[1];
    if (playlistUrl == null) throw new Error("Failed to extract playlist URL");
    const token = TOKEN_REGEX.exec(script)?.[1];
    if (token == null) throw new Error("Failed to extract token");
    const expires = EXPIRES_REGEX.exec(script)?.[1];
    if (expires == null) throw new Error("Failed to extract expires");

    // `h=1` asks vixcloud for the FHD rendition set. It now answers 403
    // whenever the embed says the session may not play FHD, which was every
    // title sampled - so only send it when the player itself would.
    const canPlayFhd = CAN_PLAY_FHD_REGEX.exec(script)?.[1] === "true";
    const masterPlUrl = this.buildMasterPlaylistUrl(playlistUrl, token, expires, canPlayFhd);

    // The player lists its mirror servers in `window.streams`; every mirror's master playlist carries the same
    // renditions, so only the first that answers is used (active one first), the plain master playlist otherwise.
    let servers: StreamServer[] = [];
    const streams = STREAMS_REGEX.exec(script)?.[1];
    if (streams) {
      try {
        servers = JSON.parse(streams) as StreamServer[];
      } catch {
        // Could not parse window.streams
      }
    }
    const serverPlaylists = [...servers].sort((a, b) => Number(isActive(b)) - Number(isActive(a))).map((it) => this.buildMasterPlaylistUrl(it.url, token, expires, canPlayFhd));
    if (!serverPlaylists.length) serverPlaylists.push(masterPlUrl);

    // ponytail: PlaylistUtils hands the master playlist to the player unread, so each mirror is probed here with one
    // GET for an #EXTM3U answer (upstream's "first successful extraction"); none answering falls back to the plain one.
    const probes = await Promise.all(
      serverPlaylists.map(async (u) => {
        try {
          const res = await this.client.get(u, this.playlistUtils.generateMasterHeaders(this.headers, `${new URL(u).origin}/`), { ensureSuccess: false });
          return res.isSuccessful && res.text().trimStart().startsWith("#EXTM3U") ? u : null;
        } catch {
          return null;
        }
      }),
    );
    const chosen = probes.find((it) => it != null) ?? masterPlUrl;
    const videos = await this.playlistUtils.extractFromHls(chosen);
    return this.proxySubtitles(videos);
  }

  /**
   * Upstream routes every subtitle track through SubtitleServer, a loopback HTTP server.
   * ponytail: no local servers in the browser; the master playlist's subtitle renditions go to the player as they are.
   * Audio tracks are still deduplicated.
   */
  private proxySubtitles(videos: Video[]): Video[] {
    return videos.map(
      (video) =>
        new Video({
          videoUrl: video.videoUrl,
          videoTitle: video.videoTitle,
          headers: video.headers ?? this.headers,
          subtitleTracks: video.subtitleTracks.filter((t, i, a) => a.findIndex((o) => o.url === t.url) === i),
          audioTracks: video.audioTracks.filter((t, i, a) => a.findIndex((o) => o.url === t.url) === i),
        }),
    );
  }

  private buildMasterPlaylistUrl(base: string, token: string, expires: string, canPlayFhd: boolean) {
    return base + (base.includes("?") ? "&" : "?") + (canPlayFhd ? "h=1&" : "") + `token=${token}&expires=${expires}&lang=${this.lang}`;
  }

  // ============================= Utilities ==============================

  private getImageCdn() {
    return this.imageCdn || `https://cdn.${new URL(this.baseUrl).host}/images/`;
  }

  private parseBrowse(response: Response): SAnime[] {
    const props = getData<BrowseResponse>(response).props;
    if (props.cdn_url?.trim()) this.imageCdn = `${props.cdn_url}/images/`;
    return (props.titles ?? []).map((it) => titleToSAnime(it, this.getImageCdn()));
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    const q = (v: Video) => Number(QUALITY_REGEX.exec(v.videoTitle)?.[1] ?? 0) || 0;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(`${quality}p`)) - Number(a.videoTitle.includes(`${quality}p`)) || q(b) - q(a));
  }

  // ============================== Settings ==============================

  private updateDomain(domain: string) {
    const newDomain = sanitizeDomain(domain);
    if (isValidUrl(newDomain)) this.preferences.edit().putString(PREF_CUSTOM_DOMAIN_KEY, newDomain).apply();
  }

  private addressUrlSummary(it: string) {
    return `Current domain: "${it.trim() ? it : DOMAIN_DEFAULT}"\nLeave blank to reset to default domain.`;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const quality = new ListPreference(screen.context);
    quality.key = PREF_QUALITY_KEY;
    quality.title = "Preferred quality";
    quality.entries = PREF_QUALITY_ENTRIES;
    quality.entryValues = PREF_QUALITY_VALUES;
    quality.setDefaultValue(PREF_QUALITY_DEFAULT);
    quality.summary = "%s";
    screen.addPreference(quality);

    // ponytail: no change listener here; a blank or invalid value falls back to the default domain when read
    const domain = new EditTextPreference(screen.context);
    domain.key = PREF_CUSTOM_DOMAIN_KEY;
    domain.title = "Custom domain";
    domain.dialogTitle = "Custom domain";
    domain.setDefaultValue(DOMAIN_DEFAULT);
    domain.summary = this.addressUrlSummary(this.homepage);
    screen.addPreference(domain);
  }

  // ============================== Filters ===============================

  override getFilterList(): FilterList {
    const intl = this.intl;
    return [
      new GenresFilter(intl),
      new SortFilter(intl),
      new ScoreFilter(intl),
      new YearFilter(intl),
      new ServiceFilter(intl),
      new QualityFilter(intl),
      new AgeFilter(intl),
      new Filter.Separator(),
      new FeaturedFilter(intl),
    ];
  }
}

function browseHasNextPage(response: Response, size: number): boolean {
  const url = new URL(response.url);
  // Popular hands out top10, then trending, then the archive. These two
  // are fixed-size slices - top10 always answers with exactly 10 - so a
  // short result never means the end; the *next* page is another
  // endpoint entirely. Checked before the size test for that reason.
  if (TOP10_TRENDING_REGEX.test(url.pathname)) return true;
  if (size < PAGE_SIZE) return false;
  // The site serves at most MAX_ARCHIVE_PAGES archive pages and answers 503 beyond that.
  if (url.pathname.endsWith("/archive")) return (Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1) < MAX_ARCHIVE_PAGES;
  return true;
}

function getData<T>(response: Response): T {
  if (response.header("content-type")?.includes("application/json")) return response.parseAs<T>();
  const page = response.asJsoup().selectFirst("div#app[data-page]")?.attr("data-page");
  if (page == null) throw new Error("Failed to extract data-page");
  return JSON.parse(page.replaceAll("&quot;", '"')) as T;
}
