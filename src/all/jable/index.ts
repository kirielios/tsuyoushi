// Port of yuzono/anime-extensions src/all/jable/Jable.kt (JableFactory: one source per lang in meta.json)
import { AnimeHttpSource, FilterList, GET, MangasPage, SAnime, SEpisode, urlWithoutDomain, Video, type Hoster, type Response } from "../../../sdk/index.ts";
import { BlockFunction, BlockFunctionFilter, SortFilter, TagFilter } from "./filters.ts";
import { JableIntl } from "./intl.ts";

const PREF_KEY_TAGS = "pref_key_tags";

export default class Jable extends AnimeHttpSource {
  private tagsUpdated = false;

  override headersBuilder(): Headers {
    // the HLS CDN is hotlink-protected; aniyomi's player sends the source's Referer, the host only sends the video's headers
    const headers = super.headersBuilder();
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  override animeDetailsRequest(anime: SAnime) {
    return GET(`${this.baseUrl}${anime.url}?lang=${this.toRequestLang()}`, this.headers);
  }

  protected animeDetailsParse(response: Response): SAnime {
    const doc = response.asJsoup();
    const anime = SAnime.create();
    const info = doc.select(".info-header");
    anime.title = info.select(".header-left h4").text();
    anime.author = info
      .select(".header-left .model")
      .map((it) => it.select("span[title]").attr("title"))
      .join(", ");
    anime.genre = doc
      .select(".tags a")
      .map((it) => it.text())
      .join(", ");
    anime.status = SAnime.COMPLETED;
    anime.description = info.select(".header-right").text();
    return anime;
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Unsupported");
  }

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const episode = SEpisode.create();
    episode.name = "Episode";
    episode.url = anime.url;
    return [episode];
  }

  protected override videoListParse(response: Response, _hoster: Hoster): Video[] {
    const doc = response.asJsoup();
    const data = doc.selectFirst("script:containsData(var hlsUrl)")!.data();
    const videoUrl = data.slice(data.indexOf("var hlsUrl = '") + "var hlsUrl = '".length).split("'")[0];
    return [new Video({ videoUrl, videoTitle: "Default", headers: this.headers })];
  }

  protected latestUpdatesAnimeParse(response: Response): MangasPage {
    const doc = response.asJsoup();
    if (!this.tagsUpdated) {
      this.tagsUpdated = this.saveTags(
        Object.fromEntries(
          doc.select("a.tag").map((it) => {
            let href = it.attr("href");
            if (href.includes(this.baseUrl)) href = href.slice(href.indexOf(this.baseUrl) + this.baseUrl.length);
            return [it.ownText(), href.replace(/^\//, "").replace(/\/$/, "")];
          }),
        ),
      );
    }
    return new MangasPage(
      doc.select(".container .video-img-box").map((it) => {
        const anime = SAnime.create();
        anime.url = urlWithoutDomain(it.select(".img-box a").attr("href"));
        anime.thumbnail_url = it.select(".img-box img").attr("data-src");
        anime.title = it.select(".detail .title").text();
        return anime;
      }),
      true,
    );
  }

  protected latestUpdatesAnimeRequest(page: number) {
    return this.searchRequest("latest-updates", page, this.latestFilter);
  }

  protected popularAnimeParse(response: Response) {
    return this.latestUpdatesAnimeParse(response);
  }

  protected popularAnimeRequest(page: number) {
    return this.searchRequest("hot", page, this.popularFilter);
  }

  protected searchAnimeParse(response: Response) {
    return this.latestUpdatesAnimeParse(response);
  }

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    if (query) return this.searchRequest(`search/${query}`, page, [...filters, this.defaultSearchFunctionFilter], query);
    const path = filters.find((f): f is TagFilter => f instanceof TagFilter)?.selected?.[1] || "hot";
    return this.searchRequest(path, page, [...filters, this.commonVideoListFuncFilter]);
  }

  private searchRequest(path: string, page: number, filters: FilterList = [], query = "") {
    const url = new URL(`${this.baseUrl}/${path}/`);
    url.searchParams.append("lang", this.toRequestLang());
    if (this.tagsUpdated) {
      // load whole page for update filter tags info
      url.searchParams.append("mode", "async");
    }
    for (const it of filters) {
      if (it instanceof BlockFunctionFilter) {
        url.searchParams.append("function", it.selected.functionName);
        url.searchParams.append("block_id", it.selected.blockId);
      } else if (it instanceof SortFilter) {
        if (it.selected[1]) url.searchParams.append("sort_by", it.selected[1]);
      }
    }
    if (query) url.searchParams.append("q", query);
    url.searchParams.append("from", String(page).padStart(2, "0"));
    url.searchParams.append("_", String(Date.now()));
    return GET(url, this.headers);
  }

  override getFilterList(): FilterList {
    return FilterList(
      new SortFilter(this.intl.filterPopularSortTitle, [
        ["", ""],
        [this.intl.hotMonth, "video_viewed_month"],
        [this.intl.hotWeek, "video_viewed_week"],
        [this.intl.hotDay, "video_viewed_today"],
        [this.intl.hotAll, "video_viewed"],
      ]),
      new TagFilter(this.intl.filterTagTitle, [["", ""], ...Object.entries(this.getTags() ?? {})]),
      new SortFilter(this.intl.filterTagsSortTitle, [
        ["", ""],
        [this.intl.sortLatestUpdate, "post_date"],
        [this.intl.sortMostView, "video_viewed"],
        [this.intl.sortMostFavorite, "most_favourited"],
        [this.intl.sortRecentBest, "post_date_and_popularity"],
      ]),
    );
  }

  private getTags(): Record<string, string> | null {
    const savedStr = this.preferences.getString(`${this.lang}_${PREF_KEY_TAGS}`, null);
    if (!savedStr) return null;
    return JSON.parse(savedStr) as Record<string, string>;
  }

  private saveTags(tags: Record<string, string>): boolean {
    if (Object.keys(tags).length) {
      this.preferences.edit().putString(`${this.lang}_${PREF_KEY_TAGS}`, JSON.stringify(tags)).apply();
      return true;
    }
    return false;
  }

  private toRequestLang(): string {
    return this.lang === "ja" ? "jp" : this.lang;
  }

  private get intl() {
    return JableIntl(this.lang);
  }

  private get commonVideoListFuncFilter() {
    return new BlockFunctionFilter(this.intl.popular, [new BlockFunction(this.intl.popular, "list_videos_common_videos_list")]);
  }

  private get defaultSearchFunctionFilter() {
    return new BlockFunctionFilter("", [new BlockFunction("", "list_videos_videos_list_search_result")]);
  }

  private get popularFilter() {
    return FilterList(this.commonVideoListFuncFilter, new SortFilter(this.intl.hotWeek, [[this.intl.hotWeek, "video_viewed_week"]]));
  }

  private get latestFilter() {
    return FilterList(
      new BlockFunctionFilter(this.intl.latestUpdate, [new BlockFunction(this.intl.latestUpdate, "list_videos_latest_videos_list")]),
      new SortFilter(this.intl.sortLatestUpdate, [[this.intl.sortLatestUpdate, "post_date"]]),
    );
  }
}
