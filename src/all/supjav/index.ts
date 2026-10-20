// Port of yuzono/anime-extensions src/all/supjav/SupJav.kt (SupJavFactory: one source per lang in meta.json)
import {
  AnimeHttpSource,
  distinctBy,
  GET,
  ListPreference,
  MangasPage,
  parallelCatchingFlatMap,
  SAnime,
  SEpisode,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type Document,
  type Element,
  type Elements,
  type FilterList,
  type Hoster,
  type PreferenceScreen,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import { StreamTapeExtractor } from "../../../libs/streamtapeextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VoeExtractor } from "../../../libs/voeextractor/index.ts";

const PREFIX_SEARCH = "id:";
const PROTECTOR_URL = "https://lk1.supremejav.com";
const SUPPORTED_PLAYERS = new Set(["TV", "FST", "VOE", "ST"]);

const PREF_QUALITY_KEY = "pref_quality";
const PREF_QUALITY_TITLE = "Preferred video quality";
const PREF_QUALITY_DEFAULT = "720p";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];

const textsOrNull = (els: Elements) => els.eachText().join(", ") || undefined;

export default class SupJav extends AnimeHttpSource {
  override get supportsLatest() {
    return false;
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.set("Referer", `${this.baseUrl}/`);
    headers.set("Origin", this.baseUrl);
    return headers;
  }

  private get langPath() {
    return this.lang === "en" ? "" : `/${this.lang}`;
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}${this.langPath}/popular/page/${page}`, this.headers);
  }

  protected popularAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    return new MangasPage(document.select("div.posts > div.post > a").map(popularAnimeFromElement), document.selectFirst("div.pagination li.active:not(:nth-last-child(2))") != null);
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(): never {
    throw new Error("Unsupported");
  }
  protected latestUpdatesAnimeParse(): never {
    throw new Error("Unsupported");
  }

  // =============================== Search ===============================
  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      if (url.host !== new URL(this.baseUrl).host) throw new Error("Unsupported url");
      const path = url.pathname.split("/").filter(Boolean).join("/");
      if (!path) throw new Error("Unsupported url");
      return this.getSearchAnime(page, `${PREFIX_SEARCH}${path}`, filters);
    }
    if (query.startsWith(PREFIX_SEARCH)) {
      const id = query.slice(PREFIX_SEARCH.length);
      return this.searchAnimeByIdParse(await this.executeSuccess(GET(`${this.baseUrl}/${id}`, this.headers)));
    }
    return super.getSearchAnime(page, query, filters);
  }

  private searchAnimeByIdParse(response: Response): MangasPage {
    const details = this.animeDetailsDocParse(response.asJsoup());
    details.url = urlWithoutDomain(response.url);
    details.initialized = true;
    return new MangasPage([details], false);
  }

  protected searchAnimeRequest(_page: number, query: string, _filters: FilterList) {
    return GET(`${this.baseUrl}${this.langPath}/?s=${encodeURIComponent(query)}`, this.headers);
  }

  protected searchAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): SAnime {
    return this.animeDetailsDocParse(response.asJsoup());
  }

  private animeDetailsDocParse(document: Document): SAnime {
    const anime = SAnime.create();
    const content = document.selectFirst("div.content > div.post-meta")!;
    anime.title = content.selectFirst("h2")!.text();
    anime.thumbnail_url = content.selectFirst("img")?.absUrl("src");
    const cats = content.selectFirst("div.cats");
    if (cats) {
      anime.author = textsOrNull(cats.select("p:contains(Maker :) > a"));
      anime.artist = textsOrNull(cats.select("p:contains(Cast :) > a"));
    }
    anime.genre = textsOrNull(content.select("div.tags > a"));
    anime.status = SAnime.COMPLETED;
    return anime;
  }

  // ============================== Episodes ==============================
  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const episode = SEpisode.create();
    episode.name = "JAV";
    episode.episode_number = 1;
    episode.url = anime.url;
    return [episode];
  }

  protected episodeListParse(): never {
    throw new Error("Unsupported");
  }

  // ============================ Video Links =============================
  protected override videoListParse(response: Response, _hoster: Hoster): Promise<Video[]> {
    const doc = response.asJsoup();
    const players = doc
      .select("div.btnst > a")
      .filter((it) => SUPPORTED_PLAYERS.has(it.text()))
      .map((it): [string, string] => [it.text(), [...it.attr("data-link")].reverse().join("")]);
    return parallelCatchingFlatMap(players, (it) => this.videosFromPlayer(it));
  }

  private get protectorHeaders() {
    const headers = super.headersBuilder();
    headers.set("referer", `${PROTECTOR_URL}/`);
    return headers;
  }

  private async videosFromPlayer([hoster, id]: [string, string]): Promise<Video[]> {
    // ponytail: upstream reads the protector's Location without following it; the host always follows redirects, so
    // the player URL is where the request ended up (one extra page load).
    const response = await this.client.execute(GET(`${PROTECTOR_URL}/supjav.php?c=${id}`, this.protectorHeaders));
    const url = response.url;
    if (new URL(url).host === new URL(PROTECTOR_URL).host) return [];

    switch (hoster) {
      case "ST":
        return new StreamTapeExtractor(this.client).videosFromUrl(url);
      case "VOE":
        return new VoeExtractor(this.client, this.headers).videosFromUrl(url);
      case "FST":
        return new StreamWishExtractor(this.client, this.headers).videosFromUrl(url);
      case "TV": {
        const body = response.text();
        const playlistUrl = body.includes("var urlPlay = '") ? substringBefore(substringAfter(body, "var urlPlay = '"), "';") : "";
        if (!playlistUrl) return [];
        const videos = await new PlaylistUtils(this.client, this.headers).extractFromHls(playlistUrl, { referer: url, videoNameGen: (it) => `TV - ${it}` });
        return distinctBy(videos, (it) => it.videoUrl);
      }
      default:
        return [];
    }
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY_KEY;
    pref.title = PREF_QUALITY_TITLE;
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_ENTRIES;
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    pref.summary = "%s";
    screen.addPreference(pref);
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)));
  }
}

function popularAnimeFromElement(element: Element): SAnime {
  const anime = SAnime.create();
  anime.url = urlWithoutDomain(element.attr("href"));
  const img = element.selectFirst("img")!;
  anime.title = img.attr("alt");
  anime.thumbnail_url = img.absUrl("data-original") || img.absUrl("src");
  return anime;
}
