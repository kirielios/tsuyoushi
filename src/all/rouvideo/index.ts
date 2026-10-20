// Port of yuzono/anime-extensions src/all/rouvideo/RouVideo.kt (+ RouVideoFactory.kt: one source per meta.json lang)
import {
  AnimeHttpSource,
  Filter,
  firstInstanceOrNull,
  GET,
  Locale,
  MangasPage,
  SAnime,
  type AnimesPage,
  type FilterList,
  type Response,
  type SEpisode,
  type Video,
} from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import * as Dto from "./dto.ts";
import { ALL_VIDEOS, CategoryFilter, categories, FEATURED, HotSearchFilter, SORT_LATEST_KEY, SORT_LIKE_KEY, SortFilter, TagFilter, WATCHING, type Tag } from "./filters.ts";
import { messages } from "./messages.ts";
import { loaderData } from "./seroval.ts";

const VIDEO_SLUG = "v";
const CATEGORY_SLUG = "t";
const TAG_LIST_PREF = "TAG_LIST";
const PREFIX_ID = `${VIDEO_SLUG}:`;
const PREFIX_TAG = `${CATEGORY_SLUG}:`;
const resolutionRegex = /Resolution: (\d+)p/;

/** The page's loader data, or a site-changed error instead of a blank list. */
function pageData<T>(response: Response): T {
  const data = loaderData<T>(response.text());
  if (data == null) throw new Error("RouVideo: no page data (site changed?)");
  return data;
}

// Upstream's baseUrl is https://rou.video/home (the featured page); here baseUrl is the origin and featuredURL adds /home.
export default class RouVideo extends AnimeHttpSource {
  private get videoUrl() {
    return this.baseUrl;
  }
  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  private _intl?: Intl;
  private get intl(): Intl {
    const language = this.lang === "all" ? Locale.getDefault().tag.split("-")[0] : this.lang;
    return (this._intl ??= new Intl({ language, baseLanguage: "en", availableLanguages: ["en", "zh", "vi"], messages }));
  }

  // Host is set by the browser/fetch itself; upstream adds it by hand.
  private get apiHeaders() {
    const h = new Headers(this.headers);
    h.set("Accept", "application/json, text/plain, */*");
    h.set("Origin", this.videoUrl);
    h.set("Referer", `${this.videoUrl}/`);
    return h;
  }
  private get docHeaders() {
    const h = new Headers(this.headers);
    h.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
    return h;
  }

  private _playlistUtils?: PlaylistUtils;
  private get playlistUtils() {
    return (this._playlistUtils ??= new PlaylistUtils(this.client));
  }

  // ============================== Popular ===============================
  protected async popularAnimeRequest(page: number) {
    await this.fetchTagsListOnce();
    // upstream checks page == 0, which never comes (pages start at 1), so its hot searches never loaded
    if (page === 1) await this.updateHotSearch();
    return GET(`${this.videoUrl}/${VIDEO_SLUG}?order=${SORT_LIKE_KEY}&page=${page}`, this.docHeaders);
  }

  protected popularAnimeParse(response: Response): AnimesPage {
    return Dto.videoListToAnimePage(pageData<Dto.VideoList>(response));
  }

  // ponytail: fetchRelatedAnimeList (related + "everyone is watching") is left out: the host has no related-titles row.

  // =============================== Latest ===============================
  protected async latestUpdatesAnimeRequest(page: number) {
    await this.fetchTagsListOnce();
    if (page === 1) await this.updateHotSearch();
    return GET(`${this.videoUrl}/${VIDEO_SLUG}?order=${SORT_LATEST_KEY}&page=${page}`, this.docHeaders);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =============================== Search ===============================
  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<AnimesPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      if (url.host !== new URL(this.baseUrl).host) throw new Error("Unsupported url");
      const [type, item] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (!type || !item) throw new Error("Unsupported url");
      return this.getSearchAnime(page, `${type}:${item}`, filters);
    }

    // Handle direct ID search (no need for tag/hot search fetching)
    if (query.startsWith(PREFIX_ID)) {
      const id = query.slice(PREFIX_ID.length);
      return this.handleSearchAnime(this.animeUrl(id), this.docHeaders, (r) => new MangasPage([this.parseAnimeDetails(r)], false));
    }

    // Handle direct Tag search from query (no need for tag/hot search fetching)
    if (query.startsWith(PREFIX_TAG)) {
      const tagValue = query.slice(PREFIX_TAG.length);
      return this.handleSearchAnime(`${this.videoUrl}/${CATEGORY_SLUG}/${encodeURIComponent(tagValue)}?page=${page}`, this.docHeaders, (r) => this.popularAnimeParse(r));
    }

    // For other search/browse types, ensure tags and hot searches are fetched
    await this.fetchTagsListOnce();
    if (page === 1) await this.updateHotSearch();

    const categoryFilter = firstInstanceOrNull(filters, CategoryFilter);
    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const tagFilter = firstInstanceOrNull(filters, TagFilter);
    const hotSearchFilter = firstInstanceOrNull(filters, HotSearchFilter);

    const categoryUriPart = categoryFilter?.toUriPart();

    if (!query.trim() || categoryUriPart === FEATURED) {
      // Browsing scenarios (no text query)
      switch (categoryUriPart) {
        case WATCHING:
          return this.handleSearchAnime(this.watchingURL, this.apiHeaders, (r) => Dto.listToAnimePage(r.parseAs<Dto.Video[]>()));
        case FEATURED:
        case undefined:
        case "": // "Featured", "No category", or "All Categories" -> show featured content
          return this.handleSearchAnime(this.featuredURL, this.docHeaders, (r) => Dto.hotVideoListToAnimePage(pageData<Dto.HotVideoList>(r), sortFilter?.toUriPart()));
        default:
          // Specific category (e.g., "asian") or "All Videos" (ALL_VIDEOS)
          return this.handleSearchAnime(this.buildBrowseUrl(page, categoryUriPart, sortFilter, tagFilter, hotSearchFilter), this.docHeaders, (r) => this.popularAnimeParse(r));
      }
    }
    // Text search; the sort filter is not applied
    const q = new URLSearchParams({ q: query });
    // Add category to search query if it's a specific one (not null or empty string)
    if (categoryUriPart) q.set(CATEGORY_SLUG, categoryUriPart);
    q.set("page", String(page));
    return this.handleSearchAnime(`${this.videoUrl}/search?${q}`, this.docHeaders, (r) => this.popularAnimeParse(r));
  }

  private buildBrowseUrl(page: number, categoryUri: string | undefined, sortFilter: SortFilter | null, tagFilter: TagFilter | null, hotSearchFilter: HotSearchFilter | null): string {
    let path: string;
    const q = new URLSearchParams();
    if (categoryUri != null && categoryUri !== ALL_VIDEOS) {
      // Specific category (e.g., "asian") is provided
      path = `${CATEGORY_SLUG}/${encodeURIComponent(categoryUri)}`;
    } else if (tagFilter && !tagFilter.isEmpty()) {
      if (hotSearchFilter && !hotSearchFilter.isEmpty()) {
        // Hot search filter is active => search within the tag
        path = "search";
        q.set("q", hotSearchFilter.toUriPart());
        q.set(CATEGORY_SLUG, tagFilter.toUriPart());
      } else {
        // Only tag filter is active => browse by tag
        path = `${CATEGORY_SLUG}/${encodeURIComponent(tagFilter.toUriPart())}`;
      }
    } else {
      // Default to browsing all videos
      path = VIDEO_SLUG;
    }
    if (sortFilter) q.set("order", sortFilter.toUriPart());
    q.set("page", String(page));
    return `${this.videoUrl}/${path}?${q}`;
  }

  private async handleSearchAnime(url: string, headers: Headers, parse: (r: Response) => AnimesPage): Promise<AnimesPage> {
    return parse(await this.executeSuccess(GET(url, headers)));
  }

  private get featuredURL() {
    return `${this.baseUrl}/home`;
  }
  private get watchingURL() {
    return `${this.apiUrl}/${VIDEO_SLUG}/watching`;
  }

  protected searchAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected searchAnimeParse(): never {
    throw new Error("Not used");
  }

  // ============================== Filters ===============================
  override getFilterList(): FilterList {
    const intl = this.intl;
    const cats = new Set(categories(intl).map((t) => t[1]));
    const known = new Map<string, Tag>();
    for (const t of [...(this.tagsArray ?? []), ...this.savedTags.filter((t) => !cats.has(t[1]))]) known.set(t[1], t);
    return [
      new SortFilter(intl),
      new Filter.Header(intl.get("sort_filter_note")),
      new CategoryFilter(intl),
      new Filter.Separator(),
      new TagFilter(intl, !this.tagsArray && !this.savedTags.length ? [[intl.get("reset_filter_to_load"), ""]] : [[intl.get("set_video_all_to_filter_tag"), ""], ...known.values()]),
      new HotSearchFilter(intl, !this.hotSearch?.size ? [[intl.get("reset_filter_to_load"), ""]] : [[intl.get("set_video_all_to_filter_tag"), ""], ...[...this.hotSearch].map((it): Tag => [it, it])]),
    ];
  }

  /** Automatically fetched tags from the source to be used in the filters. */
  private tagsArray?: Tag[];

  private async fetchTagsListOnce() {
    if (this.tagsArray) return;
    try {
      const tags = Dto.toTagList(pageData<Dto.TagList>(await this.client.execute(GET(`${this.videoUrl}/cat`, this.docHeaders))));
      if (tags.length) this.tagsArray = tags;
    } catch (e) {
      console.error(e);
    }
  }

  private get savedTags(): Tag[] {
    return this.preferences.getStringSet(TAG_LIST_PREF, []).map((it): Tag => [it, it]);
  }
  private set savedTags(value: Tag[]) {
    this.preferences
      .edit()
      .putStringSet(
        TAG_LIST_PREF,
        [...new Set(value.map((it) => it[0]))],
      )
      .apply();
  }

  private hotSearch?: Set<string>;

  private async updateHotSearch() {
    try {
      const hot = pageData<Dto.VideoList>(await this.client.execute(GET(`${this.videoUrl}/search`, this.docHeaders))).hotSearches ?? [];
      this.hotSearch = new Set([...(this.hotSearch ?? []), ...hot]);
    } catch (e) {
      console.error(e);
    }
  }

  // =========================== Anime Details ============================
  private animeUrl(id: string) {
    return `${this.videoUrl}/${VIDEO_SLUG}/${id}`;
  }
  override getMangaUrl(anime: SAnime) {
    return this.animeUrl(anime.url);
  }

  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const resolution = anime.description ? resolutionRegex.exec(anime.description)?.[1] : undefined;
    return this.parseAnimeDetails(await this.client.execute(this.animeDetailsRequest(anime)), resolution);
  }

  override animeDetailsRequest(anime: SAnime) {
    return GET(this.getMangaUrl(anime), this.docHeaders);
  }

  protected animeDetailsParse(response: Response): SAnime {
    return this.parseAnimeDetails(response);
  }

  private parseAnimeDetails(response: Response, resolution?: string): SAnime {
    const data = loaderData<Dto.VideoDetails>(response.text());
    if (!data) return SAnime.create();
    const video = data.video;
    this.savedTags = [...this.savedTags, ...Dto.getTagList(video)];
    const anime = Dto.toSAnime(video);
    // Search & RelatedVideos don't have likeCount while AnimeDetails doesn't have resolution
    const resolutionSet = resolutionRegex.test(anime.description ?? "");
    if (!resolutionSet && resolution?.trim()) anime.description = `${Dto.resolutionDesc(resolution)}\n${anime.description}`;
    return anime;
  }

  // ============================== Episodes ==============================
  protected override episodeListRequest(anime: SAnime) {
    return GET(`${this.videoUrl}/${VIDEO_SLUG}/${anime.url}`, this.docHeaders);
  }

  protected episodeListParse(response: Response): SEpisode[] {
    const data = loaderData<Dto.VideoDetails>(response.text());
    return data ? [Dto.toEpisode(data.video)] : [];
  }

  override getEpisodeUrl(episode: SEpisode) {
    return `${this.videoUrl}/${VIDEO_SLUG}/${episode.url}`;
  }

  // ============================ Video Links =============================
  // Upstream asks /api/v/<id> for videoUrl; that now answers {} and the page carries it as `ev` (see dto.ts).
  protected override videoListParse(response: Response): Promise<Video[]> {
    const ev = pageData<Dto.VideoDetails>(response).ev;
    if (!ev) throw new Error("RouVideo: no stream on the page");
    const decoded = [...atob(ev.d)].map((c) => String.fromCharCode(c.charCodeAt(0) - ev.k)).join("");
    const data = JSON.parse(decoded) as { videoUrl: string; thumbVTTUrl: string };
    return this.playlistUtils.extractFromHls(new URL(data.videoUrl, this.videoUrl).toString(), { referer: `${this.videoUrl}/` });
  }

  // Sorts by quality
  override sortVideos(videos: Video[]): Video[] {
    return [...videos].sort((a, b) => b.videoTitle.localeCompare(a.videoTitle));
  }
}
