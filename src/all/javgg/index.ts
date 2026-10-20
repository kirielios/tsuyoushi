// Port of yuzono/anime-extensions src/all/javgg/Javgg.kt
import {
  AnimeHttpSource,
  GET,
  ListPreference,
  MangasPage,
  parallelCatchingFlatMap,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Element,
  type FilterList,
  type Hoster,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";
import { VoeExtractor } from "../../../libs/voeextractor/index.ts";
import { YourUploadExtractor } from "../../../libs/youruploadextractor/index.ts";

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_DEFAULT = "1080";
const QUALITY_LIST = ["1080", "720", "480", "360"];

const PREF_SERVER_KEY = "preferred_server";
const PREF_SERVER_DEFAULT = "StreamWish";

/**
 * Current servers available on the site:
 * TB: TurboPlay, VH: VidHide, MD: MixDrop, SW: StreamWish, VG: JavGuard, VO: Voe, upjav: upjav
 */
const SERVER_LIST = ["StreamWish", "Voe", "Okru", "YourUpload", "FileLions", "StreamHideVid", "TurboPlay"];

const IMAGE_LINK_REGEX = /https?:\/\/\S+\.(jpg|png)/;

export default class Javgg extends AnimeHttpSource {
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const animeDetails = SAnime.create();
    animeDetails.status = SAnime.COMPLETED;
    animeDetails.description = document.selectFirst("#cover")?.text();

    for (const element of document.select(".data .boxye2")) {
      const category = element.select("[id*=owye2]").text().trim();
      const tags = element
        .select(".sgeneros3 a")
        .map((it) => it.text())
        .join(", ");
      if (category.includes("Genres:")) animeDetails.genre = tags;
      else if (category.includes("Cast:")) animeDetails.artist = tags;
      else if (category.includes("Maker:")) animeDetails.author = tags;
    }
    return animeDetails;
  }

  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/trending/page/${page}`, this.headers);
  }

  protected popularAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const nextPage = document.select("#nextpagination").length > 0;
    const animeList = document.select("article[id*=post-]").map((element) => {
      const anime = SAnime.create();
      anime.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
      anime.title = element.selectFirst(".data h3")!.text();
      const poster = element.selectFirst(".poster");
      anime.thumbnail_url = poster ? (getImageUrl(poster) ?? undefined) : undefined;
      return anime;
    });
    return new MangasPage(animeList, nextPage);
  }

  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/new-post/page/${page}`, this.headers);
  }

  protected searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    if (query.trim()) return GET(`${this.baseUrl}/jav/page/${page}?s=${encodeURIComponent(query)}`, this.headers);
    return this.popularAnimeRequest(page);
  }

  protected searchAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const nextPage = document.select("#nextpagination").length > 0;
    const animeList = document.select(".result-item article").map((element) => {
      const anime = SAnime.create();
      anime.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
      anime.title = element.selectFirst(".details .title")!.text();
      const image = element.selectFirst(".image");
      anime.thumbnail_url = image ? (getImageUrl(image) ?? undefined) : undefined;
      return anime;
    });
    return new MangasPage(animeList, nextPage);
  }

  protected episodeListParse(response: Response): SEpisode[] {
    const document = response.asJsoup();
    if (!document.select(".dooplay_player_option").length) return [];
    const episode = SEpisode.create();
    episode.name = "Episode 1";
    episode.episode_number = 1;
    episode.url = urlWithoutDomain(response.url);
    return [episode];
  }

  protected override videoListParse(response: Response, _hoster: Hoster): Promise<Video[]> {
    const document = response.asJsoup();
    return parallelCatchingFlatMap([...document.select("[id*=source-player] iframe")], async (it) => {
      const numOpt = it.closest(".source-box")?.attr("id")?.replace("source-player-", "");
      const serverName = document.select(`[data-nume="${numOpt}"] .server`).attr("data-text");
      return this.serverVideoResolver(serverName, it.attr("src"));
    });
  }

  private async serverVideoResolver(server: string, url: string): Promise<Video[]> {
    const embedUrl = server.toLowerCase();
    const has = (...s: string[]) => s.some((it) => embedUrl.includes(it));
    if (has("ok.ru", "okru")) return new OkruExtractor(this.client).videosFromUrl(url);
    if (has("filelions", "lion")) return new StreamWishExtractor(this.client, this.headers).videosFromUrl(url, (it) => `FileLions:${it}`);
    if (has("wishembed", "streamwish", "strwish", "wish")) {
      const docHeaders = this.headers;
      docHeaders.append("Origin", "https://streamwish.to");
      docHeaders.append("Referer", "https://streamwish.to/");
      return new StreamWishExtractor(this.client, docHeaders).videosFromUrl(url, (it) => `StreamWish:${it}`);
    }
    if (has("vidhide", "streamhide", "guccihide", "streamvid")) return new VidHideExtractor(this.client, this.headers).videosFromUrl(url);
    if (has("voe")) return new VoeExtractor(this.client, this.headers).videosFromUrl(url);
    if (has("yourupload", "upload")) return new YourUploadExtractor(this.client).videoFromUrl(url, this.headers);
    if (has("turboplay")) {
      const turboResponse = await this.client.get(url, new Headers({ "User-Agent": this.host.userAgent }));
      const masterUrl = turboResponse.asJsoup().select("#video_player").attr("data-hash");
      const host = new URL(turboResponse.url).host;
      const customHeaders = this.headers;
      customHeaders.append("Accept", "*/*");
      customHeaders.append("Origin", `https://${host}`);
      customHeaders.append("Referer", `https://${host}/`);
      return [new Video({ videoUrl: masterUrl, videoTitle: "TurboPlay", headers: customHeaders })];
    }
    return [];
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    const server = this.preferences.getString(PREF_SERVER_KEY, PREF_SERVER_DEFAULT)!.toLowerCase();
    const key = (v: Video) => [Number(v.videoTitle.toLowerCase().includes(server)), Number(v.videoTitle.includes(quality)), Number(/(\d+)p/.exec(v.videoTitle)?.[1] ?? 0)];
    // compareBy(...).reversed(): every key descending
    return [...videos].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return 0;
    });
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const server = new ListPreference(screen.context);
    server.key = PREF_SERVER_KEY;
    server.title = "Preferred server";
    server.entries = SERVER_LIST;
    server.entryValues = SERVER_LIST;
    server.setDefaultValue(PREF_SERVER_DEFAULT);
    server.summary = "%s";
    screen.addPreference(server);

    const quality = new ListPreference(screen.context);
    quality.key = PREF_QUALITY_KEY;
    quality.title = "Preferred quality";
    quality.entries = QUALITY_LIST;
    quality.entryValues = QUALITY_LIST;
    quality.setDefaultValue(PREF_QUALITY_DEFAULT);
    quality.summary = "%s";
    screen.addPreference(quality);
  }
}

function getImageUrl(element: Element): string | null {
  const full = new RegExp(`^${IMAGE_LINK_REGEX.source}$`);
  for (const link of element.select("[href], [src]")) {
    const href = link.attr("href");
    const src = link.attr("src");
    if (full.test(href)) return href;
    if (full.test(src)) return src;
  }
  return IMAGE_LINK_REGEX.exec(element.text())?.[0] ?? IMAGE_LINK_REGEX.exec(element.outerHtml())?.[0] ?? null;
}
