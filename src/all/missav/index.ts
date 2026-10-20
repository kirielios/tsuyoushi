// Port of yuzono/anime-extensions src/all/missav/MissAV.kt
import {
  AnimeHttpSource,
  GET,
  ListPreference,
  MangasPage,
  POST,
  SAnime,
  SEpisode,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type Element,
  type FilterList,
  type Hoster,
  type PreferenceScreen,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { JavCoverFetcher } from "../../../libs/javcoverfetcher/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import { JsUnpacker } from "../../../libs/unpacker/index.ts";
import { MissAvApi } from "./api.ts";
import { toAnimePage, type RecommendationsResponse } from "./dto.ts";
import { GenreList, getFilters, SortFilter } from "./filters.ts";

// The domain preference (missav.live / .ai / .ws) is meta.json's mirrors: the SDK's Preferred Mirror setting.
const PREF_QUALITY = "preferred_quality";
const PREF_QUALITY_TITLE = "Preferred quality";
const PREF_QUALITY_ENTRIES = ["720p", "480p", "360p"];
const PREF_QUALITY_VALUES = ["720", "480", "360"];
const PREF_QUALITY_DEFAULT = PREF_QUALITY_VALUES[0];

const PREF_UUID_KEY = "missav_uuid";

export default class MissAV extends AnimeHttpSource {
  private get docHeaders(): Headers {
    const headers = this.headers;
    headers.set("Origin", this.baseUrl);
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  private get playlistExtractor() {
    return new PlaylistUtils(this.client, this.docHeaders);
  }

  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/en/today-hot?page=${page}`, this.docHeaders);
  }

  protected popularAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    return new MangasPage(document.select("div.thumbnail").map(thumbnailToAnime), document.selectFirst("a[rel=next]") != null);
  }

  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/en/new?page=${page}`, this.docHeaders);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const genre = filters.find((f): f is GenreList => f instanceof GenreList)?.selected;
    let path: string;
    if (query) path = `en/search/${encodeURIComponent(query.trim())}`;
    else if (genre != null) path = genre;
    else path = "en/new";
    const url = new URL(`${this.baseUrl}/${path}`);
    const sort = filters.find((f): f is SortFilter => f instanceof SortFilter)?.selected;
    if (sort != null) url.searchParams.append("sort", sort);
    url.searchParams.append("page", String(page));
    return GET(url, this.docHeaders);
  }

  protected async searchAnimeParse(response: Response): Promise<MangasPage> {
    const document = response.asJsoup();

    if (document.selectFirst("div[x-data*=handleRecommendResponse]") != null) {
      const url = new URL(response.url);
      const pathSegments = url.pathname.split("/").filter(Boolean);
      const queryStr = pathSegments[pathSegments.indexOf("search") + 1];
      if (queryStr == null) throw new Error(`Failed to parse search query from URL: ${url}`);
      const query = decodeURIComponent(queryStr.replaceAll("+", " "));
      const page = Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1;
      const it = await this.client.execute(await this.fallbackApiSearch(query, page));
      if (!it.isSuccessful) throw new Error("No more results found");
      const data = it.parseAs<RecommendationsResponse>();
      this.recommMap.set(query, data.recommId);
      return toAnimePage(data);
    }

    return new MangasPage(document.select("div.thumbnail").map(thumbnailToAnime), document.selectFirst("a[rel=next]") != null);
  }

  private readonly recommMap = new Map<string, string>();

  private async fallbackApiSearch(query: string, page: number) {
    const recommId = this.recommMap.get(query);
    if (page === 1 || recommId == null) return POST(await MissAvApi.searchURL(this.getUuid()), this.docHeaders, MissAvApi.searchData(query), "application/json; charset=utf-8");
    return POST(await MissAvApi.recommURL(recommId), this.docHeaders, MissAvApi.recommData, "application/json; charset=utf-8");
  }

  // ponytail: related titles (relatedAnimeList*, MissAvApi.relatedData) are not ported; the reader does not ask for them.

  override getFilterList(): FilterList {
    return getFilters();
  }

  protected async animeDetailsParse(response: Response): Promise<SAnime> {
    const document = response.asJsoup();
    const jpTitle = document.select("div.text-secondary span:contains(title) + span").text();
    const siteCover = document.selectFirst("video.player")?.attr("abs:data-poster");

    const anime = SAnime.create();
    anime.title = document.selectFirst("h1.text-base")!.text();
    anime.genre = getInfo(document, "/genres/");
    anime.author = [getInfo(document, "/directors/"), getInfo(document, "/makers/")].filter((it) => it != null).join(", ");
    anime.artist = getInfo(document, "/actresses/");
    anime.status = SAnime.COMPLETED;
    let description = "";
    const mb1 = document.selectFirst("div.mb-1")?.text();
    if (mb1 != null) description += `${mb1}\n`;
    const label = getInfo(document, "/labels/");
    if (label != null) description += `\nLabel: ${label}`;
    const series = getInfo(document, "/series/");
    if (series != null) description += `\nSeries: ${series}`;
    for (const it of document.select("div.text-secondary:not(:has(a)):has(span)").eachText()) description += `\n${it}`;
    anime.description = description;
    anime.thumbnail_url = JavCoverFetcher.fetchHDCovers(this.preferences) ? ((await JavCoverFetcher.getCoverByTitle(this.client, jpTitle)) ?? siteCover) : siteCover;
    return anime;
  }

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const episode = SEpisode.create();
    episode.url = anime.url;
    episode.name = "Episode";
    return [episode];
  }

  protected override async videoListParse(response: Response, _hoster: Hoster): Promise<Video[]> {
    const document = response.asJsoup();
    const packed = document.selectFirst("script:containsData(function(p,a,c,k,e,d))")?.data();
    const playlists = packed ? JsUnpacker.unpackAndCombine(packed) : null;
    if (!playlists) return [];

    const masterPlaylist = substringBefore(substringAfter(playlists, 'source="'), '";');

    // ponytail: upstream passes the videos through lib m3u8server (a loopback server that rewrites the playlists);
    // the NeetShelf host's service worker already proxies HLS playlists and segments with the video's headers.
    return this.playlistExtractor.extractFromHls(masterPlaylist, { referer: `${this.baseUrl}/` });
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY, PREF_QUALITY_DEFAULT)!;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)));
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY;
    pref.title = PREF_QUALITY_TITLE;
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_VALUES;
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    pref.summary = "%s";
    screen.addPreference(pref);

    JavCoverFetcher.addPreferenceToScreen(screen);
  }

  protected episodeListParse(): never {
    throw new Error("Unsupported");
  }

  private getUuid(): string {
    const saved = this.preferences.getString(PREF_UUID_KEY, null);
    if (saved) return saved;
    const uuid = MissAvApi.generateUUID();
    this.preferences.edit().putString(PREF_UUID_KEY, uuid).apply();
    return uuid;
  }
}

function thumbnailToAnime(element: Element): SAnime {
  const anime = SAnime.create();
  const it = element.select("a.text-secondary");
  anime.url = urlWithoutDomain(it.attr("href"));
  anime.title = it.text();
  anime.thumbnail_url = element.selectFirst("img")?.attr("abs:data-src");
  return anime;
}

function getInfo(element: Element, urlPart: string): string | undefined {
  return element.select(`div.text-secondary > a[href*="${urlPart}"]`).eachText().join(", ") || undefined;
}
