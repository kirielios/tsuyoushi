// Port of yuzono/anime-extensions src/id/neonime/NeoNime.kt
import {
  AnimeHttpSource,
  DateTimeFormatter,
  GET,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  MultiSelectListPreference,
  parallelCatchingFlatMap,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  type Document,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { BloggerExtractor } from "../../../libs/bloggerextractor/index.ts";
import { GdrivePlayerExtractor } from "../../../libs/gdriveplayerextractor/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { YourUploadExtractor } from "../../../libs/youruploadextractor/index.ts";
import { LinkBoxExtractor } from "./extractors/linkbox.ts";

const NEXT_PAGE_SELECTOR = "#contenedor > div > div.box > div.box_item > div.peliculas > div.item_1.items > div.respo_pag > div.pag_b > a";
const DATE_FORMAT = DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.US);
const HOSTERS = ["blogger", "linkbox", "okru", "yourupload", "gdriveplayer"];

export default class NeoNime extends AnimeHttpSource {
  // Private Fun
  private parseStatus(statusString: string): number {
    const s = statusString.toLowerCase();
    if (s.includes("ongoing")) return SAnime.ONGOING;
    if (s.includes("completed")) return SAnime.COMPLETED;
    return SAnime.UNKNOWN;
  }

  private getAnimeFromAnimeElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(element.selectFirst("a")!.attr("href"));
    anime.thumbnail_url = element.selectFirst("a > div.image > img")!.attr("data-src");
    anime.title = element.select("div.fixyear > div > h2").text();
    return anime;
  }

  private async getAnimeFromEpisodeElement(element: Element): Promise<SAnime> {
    const animepage = (await this.client.execute(GET(element.selectFirst("td.bb > a")!.attr("href"), this.headers))).asJsoup();
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(animepage.selectFirst("#fixar > div.imagen > a")!.attr("href"));
    anime.thumbnail_url = animepage.selectFirst("#fixar > div.imagen > a > img")!.attr("data-src");
    anime.title = animepage.selectFirst("#fixar > div.imagen > a > img")!.attr("alt");
    return anime;
  }

  private async getAnimeFromSearchElement(element: Element): Promise<SAnime> {
    const url = element.selectFirst("a")?.attr("href") ?? element.attr("href");
    const anime = this.animeDetailsFromDocument((await this.client.execute(GET(url, this.headers))).asJsoup());
    anime.url = urlWithoutDomain(url);
    return anime;
  }

  // Popular
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/tvshows/page/${page}`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    const document = response.asJsoup();
    const animes = document.select("div.items > div.item").map((e) => this.getAnimeFromAnimeElement(e));
    return new MangasPage(animes, document.selectFirst(NEXT_PAGE_SELECTOR) != null);
  }

  // Latest
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/episode/page/${page}`, this.headers);
  }
  protected async latestUpdatesAnimeParse(response: Response) {
    const document = response.asJsoup();
    const animes = await Promise.all(document.select("table > tbody > tr").map((e) => this.getAnimeFromEpisodeElement(e)));
    return new MangasPage(animes, document.selectFirst(NEXT_PAGE_SELECTOR) != null);
  }

  // Search
  protected searchAnimeRequest(_page: number, _query: string, _filters: FilterList) {
    // filter is not avilable in neonime site
    return GET(`${this.baseUrl}/list-anime/`, this.headers);
  }
  protected searchAnimeParse(_response: Response): MangasPage {
    throw new Error("Unsupported");
  }

  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const document = (await this.executeSuccess(this.searchAnimeRequest(page, query, filters))).asJsoup();
    // filterNoBatch: only /tvshows links
    const elements = document.select(`div.letter-section > ul > li > a:contains(${query})`).filter((it) => it.attr("href").includes("/tvshows"));
    return new MangasPage(await Promise.all(elements.map((e) => this.getAnimeFromSearchElement(e))), false);
  }

  // Anime Details
  protected animeDetailsParse(response: Response): SAnime {
    return this.animeDetailsFromDocument(response.asJsoup());
  }

  private animeDetailsFromDocument(document: Document): SAnime {
    const anime = SAnime.create();
    anime.title = document.select("#info > div:nth-child(2) > span").text();
    anime.thumbnail_url = document.selectFirst("div.imagen > img")!.attr("data-src");
    anime.status = this.parseStatus(document.select("#info > div:nth-child(13) > span").text());
    anime.genre = document
      .select("#info > div:nth-child(3) > span > a")
      .map((it) => it.text())
      .join(", ");
    // this site didnt provide artist and author
    anime.artist = "Unknown";
    anime.author = "Unknown";
    anime.description = document.select("#info > div.contenidotv").text();
    return anime;
  }

  // Episode List
  protected episodeListParse(response: Response): SEpisode[] {
    return response
      .asJsoup()
      .select("ul.episodios > li")
      .map((element) => {
        const episode = SEpisode.create();
        const link = element.select("div.episodiotitle > a");
        const epsNum = link.text().replace(/\D/g, "");
        episode.url = urlWithoutDomain(link.attr("href"));
        episode.episode_number = epsNum ? Number.parseFloat(epsNum) : 1;
        episode.name = link.text();
        episode.date_upload = DATE_FORMAT.tryParseDate(element.select("div.episodiotitle > span.date").text());
        return episode;
      });
  }

  // Video
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  protected override videoListParse(response: Response): Promise<Video[]> {
    const document = response.asJsoup();
    const hosterSelection = this.preferences.getStringSet("hoster_selection", HOSTERS);

    return parallelCatchingFlatMap(document.select("div.player2 > div.embed2 > div"), async (it): Promise<Video[]> => {
      const iframe = it.selectFirst("iframe");
      if (!iframe) return [];
      let link = iframe.attr("data-src");
      if (!link.startsWith("http")) link = `https:${link}`;

      if (hosterSelection.includes("linkbox") && link.includes("linkbox.to")) return new LinkBoxExtractor(this.client).videosFromUrl(link, it.text());
      if (hosterSelection.includes("okru") && link.includes("ok.ru")) return new OkruExtractor(this.client).videosFromUrl(link);
      // upstream gates blogger on the "yourupload" pref and yourupload on "linkbox"; kept as is.
      if (hosterSelection.includes("yourupload") && link.includes("blogger.com")) return new BloggerExtractor(this.client).videosFromUrl(link, this.headers, it.text());
      if (hosterSelection.includes("linkbox") && link.includes("yourupload.com")) return new YourUploadExtractor(this.client).videoFromUrl(link, this.headers, it.text(), "Original - ");
      if (hosterSelection.includes("gdriveplayer") && link.includes("neonime.fun")) {
        const headers = new Headers({
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          Referer: response.url,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0",
        });
        const inner = (await this.executeSuccess(GET(link, headers))).asJsoup();
        let iframeUrl = inner.selectFirst("iframe")!.attr("src");
        if (!iframeUrl.startsWith("http")) iframeUrl = `https:${iframeUrl}`;
        if (!iframeUrl.includes("gdriveplayer.to")) return [];
        const newHeaders = this.headersBuilder();
        newHeaders.append("Referer", this.baseUrl);
        return new GdrivePlayerExtractor(this.client).videosFromUrl(iframeUrl, it.text(), newHeaders);
      }
      return [];
    });
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString("preferred_quality", null);
    if (quality == null) return videos;
    return [...videos.filter((v) => v.videoTitle.includes(quality)), ...videos.filter((v) => !v.videoTitle.includes(quality))];
  }

  // screen
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const hostSelection = new MultiSelectListPreference(screen.context);
    hostSelection.key = "hoster_selection";
    hostSelection.title = "Enable/Disable Hosts";
    hostSelection.entries = ["Blogger", "Linkbox", "Ok.ru", "YourUpload", "GdrivePlayer"];
    hostSelection.entryValues = HOSTERS;
    hostSelection.setDefaultValue(HOSTERS);

    const videoQualityPref = new ListPreference(screen.context);
    videoQualityPref.key = "preferred_quality";
    videoQualityPref.title = "Preferred quality";
    videoQualityPref.entries = ["1080p", "720p", "480p", "360p"];
    videoQualityPref.entryValues = ["1080", "720", "480", "360"];
    videoQualityPref.setDefaultValue("1080");
    videoQualityPref.summary = "%s";

    screen.addPreference(hostSelection);
    screen.addPreference(videoQualityPref);
  }
}
