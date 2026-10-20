// Port of yuzono/anime-extensions src/all/jellyfin/Jellyfin.kt (and JellyfinFactory.kt)
//
// The user's own Jellyfin server, configured in the extension settings. The host has no preference change listeners
// or toasts: upstream logs in when the address/username/password change; here the login runs on first use after
// they changed (and in fetchFilterData), and the library list in settings fills in once it has run.
//
// ponytail: Aniyomi's season lists (FetchType.Seasons, getSeasonList) are not in the host's model. A series lists all
// its episodes, a collection (BoxSet) its movies and episodes, as episodes.
// ponytail: the factory's source count is 3 fixed entries in meta.json ("Number of sources" is not offered).
import {
  AnimeHttpSource,
  EditTextPreference,
  Filter,
  firstInstance,
  Hoster,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  POST,
  SwitchPreferenceCompat,
  Track,
  Video,
  type ClientBuilder,
  type FilterList,
  type Host,
  type Meta,
  type PreferenceScreen,
  type SAnime,
  type SEpisode,
} from "../../../sdk/index.ts";
import {
  formatBytes,
  itemTypeFromString,
  toSAnime,
  toSEpisode,
  type FiltersDto,
  type ItemDto,
  type ItemListDto,
  type ItemType,
  type LoginDto,
  type LoginRequestDto,
  type MediaLibraryDto,
  type PlaybackInfoDto,
  type SessionDto,
} from "./dto.ts";
import { Constants, getAuthHeader, getDeviceProfile, type DeviceInfo } from "./utils.ts";

const SERIES_FETCH_LIMIT = 20;
const LIBRARY_BLACKLIST = ["music", "musicvideos", "trailers", "books", "photos", "livetv"];

// Order must match the sources in meta.json; tools/build.ts suffixes repeated langs.
const INSTANCE_IDS = ["kei:all.jellyfin:all", "kei:all.jellyfin:all:2", "kei:all.jellyfin:all:3"];

const DEVICEID_KEY = "device_id";
const APIKEY_KEY = "api_key";
const USERID_KEY = "user_id";
const LIBRARY_LIST_KEY = "media_library_list";
/** Not upstream: the address/username/password the stored api key was obtained with. */
const LOGGED_IN_AS_KEY = "logged_in_as";

const PREF_CUSTOM_LABEL_KEY = "pref_label";
const PREF_CUSTOM_LABEL_DEFAULT = "";
const HOSTURL_KEY = "host_url";
const HOSTURL_DEFAULT = "";
const USERNAME_KEY = "username";
const USERNAME_DEFAULT = "";
const PASSWORD_KEY = "password";
const PASSWORD_DEFAULT = "";
const MEDIA_LIBRARY_KEY = "library_pref";
const MEDIA_LIBRARY_DEFAULT = "";
const PREF_EPISODE_NAME_TEMPLATE_KEY = "pref_episode_name_template";
const PREF_EPISODE_NAME_TEMPLATE_DEFAULT = "{type} {number} - {title}";
const PREF_EP_DETAILS_KEY = "pref_episode_details_key";
const PREF_EP_DETAILS = ["Overview", "Runtime", "Size"];
const PREF_EP_DETAILS_DEFAULT: string[] = [];
const PREF_QUALITY_KEY = "pref_quality";
const PREF_QUALITY_DEFAULT = String(2147483647); // Int.MAX_VALUE
const PREF_VIDEO_CODEC_KEY = "pref_video_codec";
const PREF_VIDEO_CODEC_DEFAULT = "h264";
const PREF_AUDIO_KEY = "preferred_audioLang";
const PREF_AUDIO_DEFAULT = "jpn";
const PREF_SUB_KEY = "preferred_subLang";
const PREF_SUB_DEFAULT = "eng";
const PREF_BURN_SUB_KEY = "pref_burn_subs";
const PREF_BURN_SUB_DEFAULT = false;
const PREF_INFO_TYPE = "preferred_meta_type";
const PREF_INFO_DEFAULT = false;
const PREF_CONCATENATE_NAMES_KEY = "preferred_concatenate_names";
const PREF_CONCATENATE_NAMES_DEFAULT = false;
const PREF_SAVE_TYPES_KEY = "preferred_save_types";
const PREF_SAVE_TYPES_DEFAULT = false;
const PREF_SAVE_TYPES_VALUE = "preferred_save_types_value";
const PREF_USE_REMOTE_KEY = "pref_use_remote";
const PREF_USE_REMOTE_DEFAULT = true;

const INT_MAX = 2147483647;

// ============================== Filters ===============================

interface UrlFilter {
  addToUrl(url: URL): void;
}
const isUrlFilter = (f: unknown): f is UrlFilter => typeof (f as UrlFilter).addToUrl === "function";

class CheckboxFilter<T> extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: T,
    state = false,
  ) {
    super(name, state);
  }
}

class CheckboxListFilter<T> extends Filter.Group<CheckboxFilter<T>> implements UrlFilter {
  constructor(
    name: string,
    values: CheckboxFilter<T>[],
    readonly queryParam: string,
    readonly querySeparator = ",",
    readonly transform: (t: T) => string = (it) => String(it),
  ) {
    super(name, values);
  }
  addToUrl(url: URL) {
    const selected = this.state.filter((it) => it.state);
    if (selected.length) url.searchParams.append(this.queryParam, selected.map((it) => this.transform(it.id)).join(this.querySeparator));
  }
}

class TypeFilter extends CheckboxListFilter<ItemType> {
  constructor(selected: ItemType[]) {
    super(
      "Select type(s)",
      [
        new CheckboxFilter<ItemType>("Movies", "Movie", selected.includes("Movie")),
        new CheckboxFilter<ItemType>("Series", "Series", selected.includes("Series")),
        new CheckboxFilter<ItemType>("Episodes", "Episode", selected.includes("Episode")),
        new CheckboxFilter<ItemType>("Seasons", "Season", selected.includes("Season")),
        new CheckboxFilter<ItemType>("Collections", "BoxSet", selected.includes("BoxSet")),
      ],
      "IncludeItemTypes",
    );
  }
}

const sortList: [string, string][] = [
  ["Name", "SortName"],
  ["Random", "Random"],
  ["Community Rating", "CommunityRating,SortName"],
  ["Date Show Added", "DateCreated,SortName"],
  ["Date Episode Added", "DateLastContentAdded,SortName"],
  ["Date Played", "SeriesDatePlayed,SortName"],
  ["Parental Rating", "OfficialRating,SortName"],
  ["Release Date", "PremiereDate,SortName"],
];

class SortFilter extends Filter.Sort implements UrlFilter {
  constructor() {
    super(
      "Sort by",
      sortList.map((it) => it[0]),
      { index: 0, ascending: true },
    );
  }
  addToUrl(url: URL) {
    const state = this.state ?? { index: 0, ascending: true };
    url.searchParams.append("SortBy", sortList[state.index][1]);
    url.searchParams.append("SortOrder", state.ascending ? "Ascending" : "Descending");
  }
}

class FilterFilter extends CheckboxListFilter<string> {
  constructor() {
    super(
      "Filters",
      [new CheckboxFilter("Played", "IsPlayed"), new CheckboxFilter("Unplayed", "IsUnPlayed"), new CheckboxFilter("Resumable", "IsResumable"), new CheckboxFilter("Favorites", "IsFavorite")],
      "Filters",
    );
  }
}

class StatusFilter extends CheckboxListFilter<string> {
  constructor() {
    super("Status", [new CheckboxFilter("Continuing", "Continuing"), new CheckboxFilter("Ended", "Ended"), new CheckboxFilter("Not yet released", "Unreleased")], "SeriesStatus");
  }
}

class FeaturesFilter extends CheckboxListFilter<string> {
  constructor() {
    super(
      "Features",
      [
        new CheckboxFilter("Subtitles", "HasSubtitles"),
        new CheckboxFilter("Trailer", "HasTrailer"),
        new CheckboxFilter("Special Features", "HasSpecialFeature"),
        new CheckboxFilter("Theme song", "HasThemeSong"),
        new CheckboxFilter("Theme video", "HasThemeVideo"),
      ],
      "unused",
    );
  }
  override addToUrl(url: URL) {
    for (const it of this.state.filter((s) => s.state)) url.searchParams.append(it.id, "true");
  }
}

const stringList = (name: string, values: string[], queryParam: string) =>
  new CheckboxListFilter<string>(
    name,
    values.map((it) => new CheckboxFilter(it, it)),
    queryParam,
    "|",
  );
const GenreFilter = (genres: string[]) => stringList("Genres", genres, "Genres");
const RatingFilter = (ratings: string[]) => stringList("Parental Ratings", ratings, "OfficialRatings");
const TagFilter = (tags: string[]) => stringList("Tags", tags, "Tags");
const YearFilter = (years: number[]) =>
  new CheckboxListFilter<number>(
    "Years",
    years.map((it) => new CheckboxFilter(String(it), it)),
    "Years",
  );

interface TranscodingInfo {
  videoBitrate: number;
  audioBitrate: number;
  mediaId: string;
  itemId: string;
  audioStreamIndex: string | null;
  subtitleStreamIndex: string | null;
}

/** Video.bitrate / Video.preferred, which the host's Video does not carry, for sortVideos. */
const videoRank = new WeakMap<Video, { bitrate: number; preferred: boolean }>();

export default class Jellyfin extends AnimeHttpSource {
  private readonly suffix: string;

  constructor(host: Host, meta: Meta) {
    super(host, meta);
    this.suffix = String(Math.max(INSTANCE_IDS.indexOf(meta.id), 0) + 1);
    // `override val name by lazy { "Jellyfin ($displayName)" }`
    Object.assign(this, { name: `Jellyfin (${this.displayName})` });
  }

  private get displayName() {
    return (this.preferences.getString(PREF_CUSTOM_LABEL_KEY, PREF_CUSTOM_LABEL_DEFAULT) ?? "").trim() || this.suffix;
  }

  override get baseUrl(): string {
    return this.hostUrl;
  }

  get supportsLatest() {
    return true;
  }

  // --- preferences
  private str(key: string, def: string) {
    return this.preferences.getString(key, def) ?? def;
  }
  private get libraryList(): MediaLibraryDto[] {
    return JSON.parse(this.str(LIBRARY_LIST_KEY, "[]")) as MediaLibraryDto[];
  }
  private get userId() {
    return this.str(USERID_KEY, "");
  }
  private get apiKey() {
    return this.str(APIKEY_KEY, "");
  }
  private get hostUrl() {
    return this.str(HOSTURL_KEY, HOSTURL_DEFAULT).trim().replace(/\/+$/, "");
  }
  private get username() {
    return this.str(USERNAME_KEY, USERNAME_DEFAULT);
  }
  private get password() {
    return this.str(PASSWORD_KEY, PASSWORD_DEFAULT);
  }
  private get selectedLibrary() {
    return this.str(MEDIA_LIBRARY_KEY, MEDIA_LIBRARY_DEFAULT);
  }
  private get episodeTemplate() {
    return this.str(PREF_EPISODE_NAME_TEMPLATE_KEY, PREF_EPISODE_NAME_TEMPLATE_DEFAULT);
  }
  private get epDetails() {
    return this.preferences.getStringSet(PREF_EP_DETAILS_KEY, PREF_EP_DETAILS_DEFAULT);
  }
  private get quality() {
    return this.str(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT);
  }
  private get videoCodec() {
    return this.str(PREF_VIDEO_CODEC_KEY, PREF_VIDEO_CODEC_DEFAULT);
  }
  private get audioLang() {
    return this.str(PREF_AUDIO_KEY, PREF_AUDIO_DEFAULT);
  }
  private get subLang() {
    return this.str(PREF_SUB_KEY, PREF_SUB_DEFAULT);
  }
  private get burnSub() {
    return this.preferences.getBoolean(PREF_BURN_SUB_KEY, PREF_BURN_SUB_DEFAULT);
  }
  private get seriesData() {
    return this.preferences.getBoolean(PREF_INFO_TYPE, PREF_INFO_DEFAULT);
  }
  private get concatNames() {
    return this.preferences.getBoolean(PREF_CONCATENATE_NAMES_KEY, PREF_CONCATENATE_NAMES_DEFAULT);
  }
  private get saveTypes() {
    return this.preferences.getBoolean(PREF_SAVE_TYPES_KEY, PREF_SAVE_TYPES_DEFAULT);
  }
  private get useRemote() {
    return this.preferences.getBoolean(PREF_USE_REMOTE_KEY, PREF_USE_REMOTE_DEFAULT);
  }
  private qualityInt() {
    const q = this.quality.trim();
    return /^[+-]?\d+$/.test(q) ? Number(q) : null;
  }

  private _deviceInfo?: DeviceInfo;
  private get deviceInfo(): DeviceInfo {
    if (this._deviceInfo) return this._deviceInfo;
    let deviceId = this.preferences.getString(DEVICEID_KEY, null);
    if (!deviceId?.trim()) {
      deviceId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      this.preferences.edit().putString(DEVICEID_KEY, deviceId).apply();
    }
    // ponytail: upstream names the Android device (Settings.Global.DEVICE_NAME / Build.MODEL); a browser has no name
    return (this._deviceInfo = { clientName: "Aniyomi", version: "16.32", id: deviceId, name: "Tsuyoushi" });
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((req) => {
      const headers = new Headers(req.headers);
      headers.append("Accept", "application/json, application/octet-stream;q=0.9, */*;q=0.8");
      const request = { ...req, headers };

      if (new URL(req.url).pathname.endsWith("AuthenticateByName")) return request;

      const apiKey = this.apiKey;
      if (!apiKey.trim()) throw new Error("Please login in extension settings");

      headers.append("Authorization", getAuthHeader(this.deviceInfo, apiKey));
      return request;
    });
  }

  private async getJson<T>(url: string | URL): Promise<T> {
    return (await this.client.get(String(url), this.headers)).parseAs<T>();
  }

  // ============================== Popular ===============================

  override async fetchPopularManga(page: number): Promise<MangasPage> {
    await this.checkPreferences();
    const startIndex = (page - 1) * SERIES_FETCH_LIMIT;
    return this.getAnimePage(this.getItemsUrl(startIndex), page);
  }

  private async getAnimePage(url: URL, page: number): Promise<MangasPage> {
    const items = await this.getJson<ItemListDto>(url);
    const animeList = items.Items.map((it) => toSAnime(it, this.baseUrl, this.userId, this.concatNames));
    const hasNextPage = SERIES_FETCH_LIMIT * page < items.TotalRecordCount;
    return new MangasPage(animeList, hasNextPage);
  }

  protected popularAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected popularAnimeParse(): never {
    throw new Error("Not used");
  }

  // =============================== Latest ===============================

  override async fetchLatestUpdates(page: number): Promise<MangasPage> {
    await this.checkPreferences();
    const startIndex = (page - 1) * SERIES_FETCH_LIMIT;
    const url = this.getItemsUrl(startIndex);
    url.searchParams.set("SortBy", "DateCreated,SortName");
    url.searchParams.set("SortOrder", "Descending");
    return this.getAnimePage(url, page);
  }

  protected latestUpdatesAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(): never {
    throw new Error("Not used");
  }

  // =============================== Search ===============================

  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    await this.checkPreferences();
    const filterList = filters.length ? filters : this.getFilterList();
    const typeFilter = firstInstance(filterList, TypeFilter);
    this.itemTypes = typeFilter.state.filter((s) => s.state).map((s) => s.id);
    if (this.saveTypes) this.preferences.edit().putString(PREF_SAVE_TYPES_VALUE, JSON.stringify(this.itemTypes)).apply();

    const startIndex = (page - 1) * SERIES_FETCH_LIMIT;
    let url: URL;
    if (query.trim()) {
      url = this.getItemsUrl(startIndex);
      url.searchParams.set("Limit", String(SERIES_FETCH_LIMIT));
      url.searchParams.set("SearchTerm", query);
    } else {
      url = new URL(`${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Items`);
      url.searchParams.append("StartIndex", String(startIndex));
      url.searchParams.append("Limit", String(SERIES_FETCH_LIMIT));
      url.searchParams.append("Recursive", "true");
      url.searchParams.append("ImageTypeLimit", "1");
      url.searchParams.append("ParentId", this.selectedLibrary);
      url.searchParams.append("EnableImageTypes", "Primary");
      for (const f of filterList) if (isUrlFilter(f)) f.addToUrl(url);
    }
    return this.getAnimePage(url, page);
  }

  protected searchAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected searchAnimeParse(): never {
    throw new Error("Not used");
  }

  // ============================== Filters ===============================

  private _itemTypes?: ItemType[];
  private get itemTypes(): ItemType[] {
    return (this._itemTypes ??= this.saveTypes ? (JSON.parse(this.str(PREF_SAVE_TYPES_VALUE, "[]")) as string[]).map(itemTypeFromString) : ["Movie", "Series", "BoxSet"]);
  }
  private set itemTypes(v: ItemType[]) {
    this._itemTypes = v;
  }

  override get supportsFilterFetching() {
    return true;
  }

  /** getFilters(): upstream launches it from getFilterList; the host fetches (and caches) it instead. */
  override async fetchFilterData(): Promise<FiltersDto | null> {
    await this.ensureLogin();
    if (!this.selectedLibrary) return null;
    const url = new URL(`${this.baseUrl}/Items/Filters`);
    url.searchParams.append("UserId", this.userId);
    url.searchParams.append("ParentId", this.selectedLibrary);
    url.searchParams.append("IncludeItemTypes", this.itemTypes.join(","));
    return this.getJson<FiltersDto>(url);
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: FilterList = [
      new Filter.Header("Note: search ignores all filters except selected type(s)"),
      new TypeFilter(this.itemTypes),
      new Filter.Separator(),
      new SortFilter(),
      new FilterFilter(),
      new StatusFilter(),
      new FeaturesFilter(),
      new Filter.Separator(),
      new Filter.Header("Press 'reset' after searching to set filters for selected type(s)"),
    ];
    const f = data as FiltersDto | null;
    if (f) {
      if (f.Genres?.length) filters.push(GenreFilter(f.Genres));
      if (f.OfficialRatings?.length) filters.push(RatingFilter(f.OfficialRatings));
      if (f.Tags?.length) filters.push(TagFilter(f.Tags));
      if (f.Years?.length) filters.push(YearFilter(f.Years));
    }
    return filters;
  }

  // =========================== Anime Details ============================

  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const data = await this.getJson<ItemDto>(anime.url);
    let infoData = data;
    if (this.seriesData && data.SeriesId != null) {
      const httpUrl = new URL(anime.url);
      httpUrl.hash = "";
      httpUrl.pathname = httpUrl.pathname.replace(/[^/]*$/, encodeURIComponent(data.SeriesId));
      infoData = await this.getJson<ItemDto>(httpUrl);
    }
    return toSAnime(infoData, this.baseUrl, this.userId, this.concatNames);
  }

  protected animeDetailsParse(): never {
    throw new Error("Not used");
  }

  override getMangaUrl(anime: SAnime): string {
    return this.getWebUrl(anime.url);
  }

  // ============================== Episodes ==============================

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const url = new URL(anime.url);
    const fragment = decodeURIComponent(url.hash.slice(1));
    const itemId = decodeURIComponent(url.pathname.split("/").at(-1)!);
    let itemList: ItemDto[];
    if (fragment === "movie") {
      itemList = [await this.getJson<ItemDto>(url)];
    } else if (fragment.startsWith("boxSet")) {
      // ponytail: upstream lists a collection's children as seasons; here its movies and episodes become episodes
      const boxUrl = new URL(`${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Items`);
      boxUrl.searchParams.append("ParentId", itemId);
      boxUrl.searchParams.append("Recursive", "true");
      boxUrl.searchParams.append("SortBy", "SortName");
      boxUrl.searchParams.append("SortOrder", "Ascending");
      boxUrl.searchParams.append("IncludeItemTypes", "Movie,Episode");
      boxUrl.searchParams.append("Fields", "Overview,MediaSources,DateCreated,OriginalTitle,SortName");
      itemList = (await this.getJson<ItemListDto>(boxUrl)).Items;
    } else {
      let episodesUrl: URL;
      if (fragment.startsWith("season,")) {
        // Jellyfin ignores the series segment when seasonId is set, so fall back to the season id
        const s = fragment.slice("season,".length);
        const seriesId = s.trim() && s !== "null" ? s : null;
        episodesUrl = new URL(`${this.baseUrl}/Shows/${encodeURIComponent(seriesId ?? itemId)}/Episodes`);
        episodesUrl.searchParams.append("seasonId", itemId);
      } else {
        episodesUrl = new URL(`${this.baseUrl}/Shows/${encodeURIComponent(itemId)}/Episodes`);
      }
      episodesUrl.searchParams.append("userId", this.userId);
      episodesUrl.searchParams.append("Fields", "Overview,MediaSources,DateCreated,OriginalTitle,SortName");
      itemList = (await this.getJson<ItemListDto>(episodesUrl)).Items;
    }

    return itemList.map((it) => toSEpisode(it, this.baseUrl, this.userId, this.epDetails, this.episodeTemplate)).reverse();
  }

  protected episodeListParse(): never {
    throw new Error("Not used");
  }

  override getEpisodeUrl(episode: SEpisode): string {
    return this.getWebUrl(episode.url);
  }

  // ============================ Video Links =============================

  /** Hoster.internalData (the media source id) rides in the hoster URL's fragment. */
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const item = await this.getJson<ItemDto>(episode.url);
    const mediaSources = (item.MediaSources ?? []).filter((it) => it.Id?.trim());
    return mediaSources.map(
      (source, index) =>
        new Hoster(
          `${episode.url}#${encodeURIComponent(source.Id!)}`,
          // Without alternate versions, the media source is just named after the item
          mediaSources.length === 1 ? "Source" : source.Name?.trim() ? source.Name : `Version ${index + 1}`,
        ),
    );
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const hash = hoster.hosterUrl.lastIndexOf("#");
    const hosterUrl = hoster.hosterUrl.slice(0, hash);
    const internalData = decodeURIComponent(hoster.hosterUrl.slice(hash + 1));
    const item = await this.getJson<ItemDto>(hosterUrl);
    const mediaSource = item.MediaSources?.find((it) => it.Id === internalData);
    if (!mediaSource) return [];
    const itemId = item.Id;

    const videoList: Video[] = [];
    const subtitleList: Track[] = [];
    const externalSubtitleList: Track[] = [];

    let audioTrackIndex: number | null = null;
    let subtitleTrackIndex: number | null = null;
    let referenceBitrate = Constants.QUALITIES_LIST[0].videoBitrate;

    for (const media of mediaSource.MediaStreams) {
      switch (media.Type) {
        case "Video":
          referenceBitrate = media.BitRate ?? referenceBitrate;
          break;
        case "Subtitle":
          if (media.SupportsExternalStream && media.Codec != null) {
            const subtitleUrl = `${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSource.Id!)}/Subtitles/${media.Index}/0/${encodeURIComponent(`Stream.${media.Codec}`)}`;
            if (media.IsExternal) externalSubtitleList.push(new Track(subtitleUrl, media.DisplayTitle!));
            subtitleList.push(new Track(subtitleUrl, media.DisplayTitle!));
          }
          if (media.Language === this.subLang) subtitleTrackIndex = media.Index;
          break;
        case "Audio":
          if (media.Language === this.audioLang) audioTrackIndex = media.Index;
          break;
      }
    }

    const videoHeaders = this.headersBuilder();
    videoHeaders.append("Authorization", getAuthHeader(this.deviceInfo, this.apiKey));
    const quality = this.qualityInt();

    if (mediaSource.IsRemote && mediaSource.Path != null && this.useRemote) {
      const video = new Video({ videoTitle: `Remote\n${mediaSource.Path}`, videoUrl: mediaSource.Path, subtitleTracks: externalSubtitleList });
      videoRank.set(video, { bitrate: INT_MAX, preferred: mediaSource.Bitrate === quality });
      return [video];
    }

    const videoBitrate = mediaSource.Bitrate != null ? formatBytes(mediaSource.Bitrate).replace("B", "b") : "-";
    const sessionData = await this.getSessionData(INT_MAX, INT_MAX, mediaSource.Id!, itemId, audioTrackIndex?.toString() ?? null, subtitleTrackIndex?.toString() ?? null);

    const staticUrl = new URL(`${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/stream`);
    staticUrl.searchParams.append("static", "True");
    staticUrl.searchParams.append("MediaSourceId", mediaSource.Id!);
    staticUrl.searchParams.append("PlaySessionId", sessionData.PlaySessionId);

    const staticVideo = new Video({ videoTitle: `${videoBitrate}ps`, videoUrl: staticUrl.href, headers: videoHeaders, subtitleTracks: externalSubtitleList });
    videoRank.set(staticVideo, { bitrate: INT_MAX, preferred: mediaSource.Bitrate === quality });

    const sessionMediaSource = sessionData.MediaSources.find((it) => it.Id === mediaSource.Id);
    if (!sessionMediaSource) return [];

    if (sessionMediaSource.SupportsDirectStream) videoList.push(staticVideo);

    if (!sessionMediaSource.SupportsTranscoding) return videoList;

    // ponytail: upstream resolves a transcoded quality only when it is played (resolveVideo); the host has no such
    // hook, so every quality's PlaybackInfo is asked for here, in parallel, and the ones that fail are dropped
    const firstAbove = Constants.QUALITIES_LIST.findIndex((it) => it.videoBitrate > referenceBitrate);
    const qualities = firstAbove < 0 ? Constants.QUALITIES_LIST : Constants.QUALITIES_LIST.slice(0, firstAbove); // takeWhile
    const transcoded = await Promise.all(
      qualities.map(async (it) => {
        const info: TranscodingInfo = {
          videoBitrate: it.videoBitrate,
          audioBitrate: it.audioBitrate,
          mediaId: mediaSource.Id!,
          itemId,
          audioStreamIndex: audioTrackIndex?.toString() ?? null,
          subtitleStreamIndex: subtitleTrackIndex?.toString() ?? null,
        };
        const videoUrl = await this.resolveVideo(info).catch(() => null);
        if (videoUrl == null) return null;
        const video = new Video({ videoUrl, videoTitle: it.description, headers: videoHeaders, subtitleTracks: subtitleList });
        videoRank.set(video, { bitrate: it.videoBitrate, preferred: it.videoBitrate === quality });
        return video;
      }),
    );
    videoList.push(...transcoded.filter((v): v is Video => v != null));
    return videoList;
  }

  private async getSessionData(
    videoBitrate: number,
    audioBitrate: number,
    mediaId: string,
    itemId: string,
    audioStreamIndex: string | null,
    subtitleStreamIndex: string | null,
  ): Promise<SessionDto> {
    const playbackInfo: PlaybackInfoDto = {
      UserId: this.userId,
      IsPlayback: true,
      MediaSourceId: mediaId,
      MaxStreamingBitrate: videoBitrate,
      AudioStreamIndex: audioStreamIndex ?? undefined,
      SubtitleStreamIndex: subtitleStreamIndex ?? undefined,
      AlwaysBurnInSubtitleWhenTranscoding: this.burnSub,
      EnableTranscoding: true,
      DeviceProfile: getDeviceProfile(this.deviceInfo.name, this.videoCodec, videoBitrate, audioBitrate),
    };

    const sessionUrl = new URL(`${this.baseUrl}/Items/${encodeURIComponent(itemId)}/PlaybackInfo`);
    sessionUrl.searchParams.append("userId", this.userId);

    return (await this.client.execute(POST(sessionUrl.href, this.headers, JSON.stringify(playbackInfo), "application/json; charset=utf-8"), true)).parseAs<SessionDto>();
  }

  /** resolveVideo: the transcoding URL of one quality. */
  private async resolveVideo(transcodingInfo: TranscodingInfo): Promise<string | null> {
    const sessionData = await this.getSessionData(
      transcodingInfo.videoBitrate,
      transcodingInfo.audioBitrate,
      transcodingInfo.mediaId,
      transcodingInfo.itemId,
      transcodingInfo.audioStreamIndex,
      transcodingInfo.subtitleStreamIndex,
    );
    const mediaSource = sessionData.MediaSources.find((it) => it.Id === transcodingInfo.mediaId);
    if (!mediaSource?.TranscodingUrl) return null;
    // ponytail: upstream serves fMP4 ("mp4" container) segments as DASH from a loopback server so seeking works in its
    // player; there is no local server here, and hls.js plays and seeks fMP4 HLS itself
    return this.baseUrl + mediaSource.TranscodingUrl;
  }

  override sortVideos(videos: Video[]): Video[] {
    const rank = (v: Video) => videoRank.get(v) ?? { bitrate: 0, preferred: false };
    return [...videos].sort((a, b) => Number(rank(b).preferred) - Number(rank(a).preferred) || rank(b).bitrate - rank(a).bitrate);
  }

  // =============================== Login ================================

  private async authenticate(username: string, password: string): Promise<LoginDto> {
    const authHeaders = new Headers(this.headers);
    authHeaders.set("Authorization", getAuthHeader(this.deviceInfo));
    const body: LoginRequestDto = { Username: username, Pw: password };
    try {
      const resp = await this.client.execute(POST(`${this.baseUrl}/Users/AuthenticateByName`, authHeaders, JSON.stringify(body), "application/json; charset=utf-8"), true);
      return resp.parseAs<LoginDto>();
    } catch (e) {
      const code = (e as { code?: number }).code;
      throw new Error(`Login failed: ${code === 401 ? "Invalid credentials" : (e as Error).message}`);
    }
  }

  /**
   * logIn() from the settings screen's change listeners: runs when the address/username/password differ from the ones
   * the stored api key came from. A new login clears the selected library, as upstream's clearCredentials().
   */
  private loginPromise?: Promise<void>;
  private async ensureLogin(): Promise<void> {
    const loggedInAs = JSON.stringify([this.baseUrl, this.username, this.password]);
    if (this.apiKey && this.preferences.getString(LOGGED_IN_AS_KEY) === loggedInAs) return;
    if (!this.baseUrl || !this.username.trim()) {
      this.clearCredentials();
      return;
    }
    return (this.loginPromise ??= (async () => {
      try {
        this.clearCredentials();
        const loginDto = await this.authenticate(this.username, this.password);
        this.preferences.edit().putString(USERID_KEY, loginDto.SessionInfo.UserId).putString(APIKEY_KEY, loginDto.AccessToken).apply();

        const libraries = await this.getJson<ItemListDto>(`${this.baseUrl}/Users/${encodeURIComponent(loginDto.SessionInfo.UserId)}/Items`);
        const libraryList: MediaLibraryDto[] = libraries.Items.filter((it) => !LIBRARY_BLACKLIST.includes(it.CollectionType ?? "")).map((it) => ({ name: it.Name, id: it.Id }));
        this.preferences.edit().putString(LIBRARY_LIST_KEY, JSON.stringify(libraryList)).putString(LOGGED_IN_AS_KEY, loggedInAs).apply();
      } finally {
        this.loginPromise = undefined;
      }
    })());
  }

  private clearCredentials() {
    this.preferences
      .edit()
      .putString(LIBRARY_LIST_KEY, "[]")
      .putString(MEDIA_LIBRARY_KEY, MEDIA_LIBRARY_DEFAULT)
      .putString(USERID_KEY, "")
      .putString(APIKEY_KEY, "")
      .remove(LOGGED_IN_AS_KEY)
      .apply();
  }

  // ============================= Utilities ==============================

  // Anime and episode urls point to the API, so open the item's page in the web client instead
  private getWebUrl(apiUrl: string): string {
    const itemId = decodeURIComponent(new URL(apiUrl).pathname.split("/").at(-1)!);
    return `${this.baseUrl}/web/#/details?id=${itemId}`;
  }

  private getItemsUrl(startIndex: number): URL {
    const url = new URL(`${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Items`);
    url.searchParams.append("StartIndex", String(startIndex));
    url.searchParams.append("Limit", String(SERIES_FETCH_LIMIT));
    url.searchParams.append("Recursive", "true");
    url.searchParams.append("SortBy", "SortName");
    url.searchParams.append("SortOrder", "Ascending");
    url.searchParams.append("IncludeItemTypes", this.itemTypes.join(","));
    url.searchParams.append("ImageTypeLimit", "1");
    url.searchParams.append("ParentId", this.selectedLibrary);
    url.searchParams.append("EnableImageTypes", "Primary");
    return url;
  }

  private async checkPreferences() {
    if (!this.baseUrl) throw new Error("Enter the server address in extension settings");
    await this.ensureLogin();
    if (!this.selectedLibrary.trim()) throw new Error("Select library in extension settings");
  }

  // ============================ Preferences =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const text = (key: string, def: string, title: string, summary: string) => {
      const p = new EditTextPreference(screen.context);
      p.key = key;
      p.title = title;
      p.dialogTitle = title;
      p.summary = summary;
      p.setDefaultValue(def);
      screen.addPreference(p);
    };
    const toggle = (key: string, def: boolean, title: string, summary: string) => {
      const p = new SwitchPreferenceCompat(screen.context);
      p.key = key;
      p.title = title;
      p.summary = summary;
      p.setDefaultValue(def);
      screen.addPreference(p);
    };

    // ponytail: "Number of sources" (EXTRA_SOURCES_COUNT_KEY) is not offered: meta.json fixes three sources

    text(PREF_CUSTOM_LABEL_KEY, this.suffix, "Source display name", this.displayName.trim() ? this.displayName : "Here you can change the source displayed suffix");
    // ponytail: upstream validates the address while typing (a URL, no trailing slash); here trailing slashes are trimmed
    text(HOSTURL_KEY, HOSTURL_DEFAULT, "Address", `${this.baseUrl || "The server address"}\nThe address must not end with a forward slash.`);
    text(USERNAME_KEY, USERNAME_DEFAULT, "Username", this.username.trim() ? this.username : "The user account name");
    text(PASSWORD_KEY, PASSWORD_DEFAULT, "Password", this.password ? "•".repeat(this.password.length) : "The user account password");

    const libraryList = this.libraryList;
    const mediaLibraryPref = new ListPreference(screen.context);
    mediaLibraryPref.key = MEDIA_LIBRARY_KEY;
    mediaLibraryPref.title = "Select media library";
    mediaLibraryPref.summary = this.apiKey.trim() ? "Selected: %s" : "Currently not logged in (browse the source once after entering the address and account to load the libraries)";
    mediaLibraryPref.entries = libraryList.map((it) => it.name);
    mediaLibraryPref.entryValues = libraryList.map((it) => it.id);
    mediaLibraryPref.setDefaultValue(MEDIA_LIBRARY_DEFAULT);
    screen.addPreference(mediaLibraryPref);

    // ponytail: upstream rejects a template that does not format; here a bad one fails when episodes load
    text(
      PREF_EPISODE_NAME_TEMPLATE_KEY,
      PREF_EPISODE_NAME_TEMPLATE_DEFAULT,
      "Episode title format",
      "Customize how episode names appear. Placeholders: {title} {originalTitle} {sortTitle} {type} {typeShort} {seriesTitle} {seasonTitle} {number} {createdDate} {releaseDate} {size} {sizeBytes} {runtime} {runtimeS}; put \\ before { for a literal one.",
    );

    const details = new MultiSelectListPreference(screen.context);
    details.key = PREF_EP_DETAILS_KEY;
    details.title = "Additional details for episodes";
    details.summary = "Show additional details about an episode in the scanlator field";
    details.entries = PREF_EP_DETAILS;
    details.entryValues = PREF_EP_DETAILS;
    details.setDefaultValue(PREF_EP_DETAILS_DEFAULT);
    screen.addPreference(details);

    const quality = new ListPreference(screen.context);
    quality.key = PREF_QUALITY_KEY;
    quality.title = "Preferred quality";
    quality.summary = "Preferred quality. 'Source' means no transcoding.";
    quality.entries = ["Source", ...[...Constants.QUALITIES_LIST].reverse().map((it) => it.description)];
    quality.entryValues = [PREF_QUALITY_DEFAULT, ...[...Constants.QUALITIES_LIST].reverse().map((it) => String(it.videoBitrate))];
    quality.setDefaultValue(PREF_QUALITY_DEFAULT);
    screen.addPreference(quality);

    text(PREF_VIDEO_CODEC_KEY, PREF_VIDEO_CODEC_DEFAULT, "Transcoding video codec", "Video codec when transcoding. Does not affect 'Source' quality.");
    // ponytail: upstream checks these against Constants.LANG_CODES while typing; not validated here
    text(PREF_AUDIO_KEY, PREF_AUDIO_DEFAULT, "Preferred transcoding audio language", "Preferred audio when transcoding. Does not affect 'Source' quality. Enter language as 3 letter ISO 639-2/T code");
    text(PREF_SUB_KEY, PREF_SUB_DEFAULT, "Preferred transcoding subtitle language", "Preferred subtitle when transcoding. Does not affect 'Source' quality. Enter language as 3 letter ISO 639-2/T code");

    toggle(PREF_BURN_SUB_KEY, PREF_BURN_SUB_DEFAULT, "Burn in subtitles", "Burn in subtitles when transcoding. Does not affect 'Source' quality.");
    toggle(PREF_INFO_TYPE, PREF_INFO_DEFAULT, "Retrieve metadata from series", "Enable this to retrieve metadata from series instead of season when applicable.");
    toggle(PREF_CONCATENATE_NAMES_KEY, PREF_CONCATENATE_NAMES_DEFAULT, "Concatenate series and season names", "");
    toggle(PREF_SAVE_TYPES_KEY, PREF_SAVE_TYPES_DEFAULT, "Save selected types filter", "Applies to Popular, Latest, and Search");
    toggle(PREF_USE_REMOTE_KEY, PREF_USE_REMOTE_DEFAULT, "Use remote link", "Stream from remote link directly instead of proxying through jellyfin.");
  }
}
