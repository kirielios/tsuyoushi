// Port of yuzono/anime-extensions src/id/kuronime/Kuronime.kt
import {
  aesCbcDecrypt,
  AnimeHttpSource,
  Base64,
  evpBytesToKey,
  fromUtf8,
  GET,
  hexBytes,
  Hoster,
  ListPreference,
  MangasPage,
  parallelCatchingFlatMap,
  parseAs,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  utf8,
  Video,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { DoodExtractor } from "../../../libs/doodextractor/index.ts";
import { Mp4uploadExtractor } from "../../../libs/mp4uploadextractor/index.ts";
import { PixelDrainExtractor } from "../../../libs/pixeldrainextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";

type SourcesResponse = { mirror?: string | null };
type EncryptedMirror = { ct: string; s: string };
type Mirror = { embed?: Record<string, Record<string, string | null>> };

const API_URL = "https://animeku.org/api/v9";
const MIRROR_KEY = "3&!Z0M,VIZ;dZW==";
const ID_REGEX = /var _0x\w+ = "([A-Za-z0-9+/=]{40,})"/;
const PREF_QUALITY = "preferred_quality";

export default class Kuronime extends AnimeHttpSource {
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/anime/page/${page}/?order=popular`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    return this.listParse(response);
  }
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/anime/page/${page}/?status=ongoing&order=update`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.listParse(response);
  }
  protected searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    return GET(`${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}`, this.headers);
  }
  protected searchAnimeParse(response: Response) {
    return this.listParse(response);
  }

  private listParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const animes = document.select("div.listupd > article").map((e) => this.animeFromElement(e));
    return new MangasPage(animes, document.selectFirst("a.next.page-numbers") != null);
  }

  private animeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(element.selectFirst("div > a")!.attr("href"));
    const img = element.selectFirst("div > a > div.limit > img")!;
    const thumbnail = img.attr("src");
    anime.thumbnail_url = thumbnail.startsWith("https:") ? thumbnail : img.hasAttr("data-src") ? img.attr("data-src") : "";
    anime.title = element.select("div > a > div.tt > h2").text();
    return anime;
  }

  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    const info = document.select("div.infodetail");
    anime.title = document.selectFirst("h1.entry-title")?.text() ?? info.select("ul > li:nth-child(1)").text().replace("Judul: ", "");
    anime.genre = info.select("ul > li:nth-child(2) a").map((a) => a.text()).join(", ");
    const status = info.select("ul > li:nth-child(3)").text().replace("Status: ", "").toLowerCase();
    anime.status = status === "ongoing" ? SAnime.ONGOING : status === "completed" ? SAnime.COMPLETED : SAnime.UNKNOWN;
    anime.artist = info.select("ul > li:nth-child(4)").text().replace("Studio: ", "");
    anime.author = "UNKNOWN";
    anime.description = "Synopsis: \n" + document.select("div.main-info div.r span.const p").text();
    return anime;
  }

  protected episodeListParse(response: Response): SEpisode[] {
    return response
      .asJsoup()
      .select("div.bixbox.bxcl > ul > li")
      .map((element) => {
        const episode = SEpisode.create();
        const name = element.select("span.lchx").text();
        const num = name.replace(/\D/g, "");
        episode.url = urlWithoutDomain(element.selectFirst("a")!.attr("href"));
        episode.episode_number = num ? Number.parseFloat(num) || 1 : 1;
        episode.name = name;
        return episode;
      });
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const document = (await this.executeSuccess(GET(hoster.hosterUrl, this.headers))).asJsoup();
    const id = document
      .select("script")
      .map((s) => ID_REGEX.exec(s.data())?.[1])
      .find((v) => v != null);
    if (!id) return [];
    const headers = new Headers(this.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    const sources = (await this.client.post(`${API_URL}/sources`, headers, JSON.stringify({ id }))).parseAs<SourcesResponse>();
    if (!sources.mirror) return [];
    const encrypted = parseAs<EncryptedMirror>(fromUtf8(Base64.decode(sources.mirror)));
    const embeds = parseAs<Mirror>(await decryptWithSalt(encrypted.ct, encrypted.s, MIRROR_KEY)).embed ?? {};

    const items = Object.entries(embeds).flatMap(([quality, hosts]) =>
      Object.entries(hosts).flatMap(([host, url]) => (url ? [{ host, url, quality: quality.replace(/^v/, "") }] : [])),
    );
    return parallelCatchingFlatMap(items, async ({ host, url, quality }): Promise<Video[]> => {
      switch (host) {
        case "doodstream": {
          const video = await new DoodExtractor(this.client).videoFromUrl(url, quality);
          return video ? [video] : [];
        }
        case "mp4upload":
          return new Mp4uploadExtractor(this.client).videosFromUrl(url, this.headers, "", ` - ${quality}`);
        case "pixeldrain":
          return new PixelDrainExtractor().videosFromUrl(url.split("?")[0], `${quality} - `);
        case "filelions":
          return new VidHideExtractor(this.client, this.headers).videosFromUrl(url, (resolution) => `FileLions - ${resolution}`);
        default:
          return [];
      }
    });
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY, null);
    if (quality == null) return videos;
    return [...videos.filter((v) => v.videoTitle.includes(quality)), ...videos.filter((v) => !v.videoTitle.includes(quality))];
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY;
    pref.title = "Preferred quality";
    pref.entries = ["1080p", "720p", "480p", "360p", "HD", "SD"];
    pref.entryValues = ["1080", "720", "480", "360", "HD", "SD"];
    pref.setDefaultValue("1080");
    pref.summary = "%s";
    screen.addPreference(pref);
  }
}

// CryptoAES.decryptWithSalt: the salt comes hex-encoded beside the ciphertext instead of inside it.
async function decryptWithSalt(cipherText: string, salt: string, password: string): Promise<string> {
  try {
    const { key, iv } = evpBytesToKey(utf8(password), hexBytes(salt), 32, 16);
    return fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(cipherText)));
  } catch {
    return "";
  }
}
