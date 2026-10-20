// Port of yuzono/anime-extensions src/all/xnxx/Xnxx.kt
import {
  AnimeHttpSource,
  Filter,
  firstInstanceOrNull,
  GET,
  ListPreference,
  MangasPage,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";

class Tags extends Filter.Text {}

export default class Xnxx extends AnimeHttpSource {
  override get supportsLatest() {
    return false;
  }

  // Site markup changed since upstream (2026-10-20): ids are video-thumb-*, the title is a.title, the pager has no ul.
  private popularAnimeSelector = "div.thumb-block";
  private popularAnimeNextPageSelector = "div.pagination a.next";

  protected popularAnimeRequest(page: number) {
    const currentDate = new Date().toISOString().slice(0, 7); // yyyy-MM
    return GET(`${this.baseUrl}/best/${currentDate}/${page - 1}`);
  }

  private popularAnimeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(`${this.baseUrl}${element.select("div.thumb > a").attr("href")}`);
    anime.title = element.select("div.thumb-under a.title").text();
    anime.thumbnail_url = element.select("div.thumb img").attr("data-src");
    return anime;
  }

  protected popularAnimeParse(response: Response) {
    const document = response.asJsoup();
    return new MangasPage(document.select(this.popularAnimeSelector).map((e) => this.popularAnimeFromElement(e)), document.selectFirst(this.popularAnimeNextPageSelector) != null);
  }

  protected episodeListParse(response: Response): SEpisode[] {
    const episode = SEpisode.create();
    episode.name = "Video";
    episode.url = urlWithoutDomain(response.url);
    episode.date_upload = Date.now();
    return [episode];
  }

  protected override videoListParse(response: Response): Video[] {
    const sourcesJson = response.asJsoup().select("script").map((s) => s.data()).find((s) => s.includes("html5player.setVideoUrl")) ?? "";
    const grab = (start: string) => sourcesJson.split(start)[1]?.split("')")[0];
    return (
      [
        ["Low", grab("VideoUrlLow('")],
        ["HLS", grab("setVideoHLS('")],
        ["High", grab("VideoUrlHigh('")],
      ] as const
    )
      .filter(([, url]) => url)
      .map(([videoTitle, videoUrl]) => new Video({ videoUrl: videoUrl!, videoTitle }));
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString("preferred_quality", "HLS");
    return [...videos].sort((a, b) => Number(b.videoTitle === quality) - Number(a.videoTitle === quality));
  }

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const tagFilter = firstInstanceOrNull(filters, Tags);
    const calcPage = page - 1;
    if (query.trim()) return GET(`${this.baseUrl}/search/hits/${encodeURIComponent(query)}/${calcPage}`, this.headers);
    if (tagFilter?.state.trim()) return GET(`${this.baseUrl}/search/hits/${encodeURIComponent(tagFilter.state)}/${calcPage}`);
    return this.popularAnimeRequest(page);
  }
  protected searchAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.title = document.select("#video-content-metadata > div.clear-infobar strong").text();
    anime.author = document.select("#video-content-metadata > div.clear-infobar span a").text();
    anime.description = document.select("#video-content-metadata > p").text().replace(/\n/g, "");
    anime.genre = document.select("#video-content-metadata > div.metadata-row.video-tags > a").eachText().join(", ");
    anime.status = SAnime.COMPLETED;
    return anime;
  }

  protected latestUpdatesAnimeRequest(): never {
    throw new Error("not used");
  }
  protected latestUpdatesAnimeParse(): never {
    throw new Error("not used");
  }

  override getFilterList(): FilterList {
    return [new Filter.Header("Search by text does not affect the filter"), new Tags("Tag")];
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = "preferred_quality";
    pref.title = "Preferred quality";
    pref.entries = ["High", "Low", "HLS"];
    pref.entryValues = ["High", "Low", "HLS"];
    pref.setDefaultValue("HLS");
    pref.summary = "%s";
    screen.addPreference(pref);
  }
}
