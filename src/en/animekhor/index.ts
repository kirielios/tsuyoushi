// Port of yuzono/anime-extensions src/en/animekhor/AnimeKhor.kt
import { tryParseInstant, type Document, type Response, type SEpisode, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { DoodExtractor } from "../../../libs/doodextractor/index.ts";
import { Mp4uploadExtractor } from "../../../libs/mp4uploadextractor/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { RumbleExtractor } from "../../../libs/rumbleextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";
import { TurboVidExtractor } from "./extractors/turbovid.ts";
import { VidaraExtractor } from "./extractors/vidara.ts";

export default class AnimeKhor extends AnimeStream {
  // =========================== Anime Details ============================
  // animeDetailsParse sets description = getAnimeDescription(document): drops the theme's alt name and info lines.
  protected override animeDetailsFromDocument(document: Document) {
    const anime = super.animeDetailsFromDocument(document);
    anime.description = this.getAnimeDescription(document) ?? undefined;
    return anime;
  }

  // ============================== Episodes ==============================
  protected override episodeListParse(response: Response): SEpisode[] {
    const doc = response.asJsoup();
    const episodes = doc.select(this.episodeListSelector()).map((e) => this.episodeFromElement(e));
    const firstEp = episodes[0];
    if (!firstEp) return episodes;
    const latestUploadDate = tryParseInstant(doc.selectFirst("time[itemprop=dateModified]")?.attr("datetime"));
    if (latestUploadDate > 0 && (firstEp.date_upload === 0 || Math.abs(latestUploadDate - firstEp.date_upload) < 86_400_000 * 2)) {
      firstEp.date_upload = latestUploadDate;
    }
    return episodes;
  }

  // ============================ Video Links =============================
  // getHosterUrl's catch-all: parallelCatchingFlatMap already drops a mirror that fails to decode.
  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    if (!url.trim()) return [];
    const prefix = `${name} - `;
    const lname = name.toLowerCase();
    if (url.includes("dailymotion.com") || lname.includes("vidplayer")) {
      const cleanUrl = url.includes("dailymotion.com/embed/embed-")
        ? `https://www.dailymotion.com/embed/video/${url.split("dailymotion.com/embed/embed-")[1].split(".")[0]}`
        : url;
      return new DailymotionExtractor(this.client, this.headers).videosFromUrl(cleanUrl, prefix);
    }
    if (url.includes("vidara") || url.includes("vidvara") || lname.includes("daraplayer")) return new VidaraExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (url.includes("turbovid") || url.includes("turboviplay") || url.includes("emturbovid")) return new TurboVidExtractor(this.client, this.headers, `${this.baseUrl}/`).videosFromUrl(url, prefix);
    if (url.includes("ok.ru")) return new OkruExtractor(this.client).videosFromUrl(url, prefix);
    if (url.includes("rumble.com")) return new RumbleExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (url.includes("ahvsh.com") || url.includes("vidhide") || lname.includes("streamhide")) return new VidHideExtractor(this.client, this.headers).videosFromUrl(url, (it) => `${prefix}${it}`);
    if (url.includes("wish")) {
      const docHeaders = new Headers(this.headers);
      docHeaders.set("Referer", `${this.baseUrl}/`);
      return new StreamWishExtractor(this.client, docHeaders).videosFromUrl(url, (it) => `${prefix} - ${it}`);
    }
    if (url.includes("mp4upload")) return new Mp4uploadExtractor(this.client).videosFromUrl(url, this.headers, prefix);
    if (url.includes("dood") || url.includes("do0od") || url.includes("ds2play")) return new DoodExtractor(this.client).videosFromUrl(url, prefix);
    return [];
  }
}
