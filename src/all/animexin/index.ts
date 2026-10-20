// Port of yuzono/anime-extensions src/all/animexin/AnimeXin.kt
import { ListPreference, type Document, type PreferenceScreen, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { DoodExtractor } from "../../../libs/doodextractor/index.ts";
import { GdrivePlayerExtractor } from "../../../libs/gdriveplayerextractor/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { VidstreamingExtractor } from "./extractors/vidstreaming.ts";

const PREF_LANG_KEY = "preferred_language";
const PREF_LANG_TITLE = "Preferred Video Language";
const PREF_LANG_DEFAULT = "All Sub";
const PREF_LANG_VALUES = ["All Sub", "Arabic", "English", "German", "Indonesia", "Italian", "Polish", "Portuguese", "Spanish", "Thai", "Turkish"];

export default class AnimeXin extends AnimeStream {
  private get langPref() {
    return this.preferences.getString(PREF_LANG_KEY, PREF_LANG_DEFAULT) ?? PREF_LANG_DEFAULT;
  }

  // =========================== Anime Details ============================
  protected override getAnimeDescription(document: Document): string | null {
    const description = super.getAnimeDescription(document);
    if (description == null) return null;
    const lower = description.toLowerCase();
    const englishIdx = lower.indexOf("english");
    const indonesiaIdx = lower.indexOf("indonesia");
    if (englishIdx === -1 || indonesiaIdx === -1 || englishIdx >= indonesiaIdx) return description;
    const result = this.langPref === "Indonesia" ? description.slice(indonesiaIdx + "Indonesia".length) : description.slice(englishIdx + "English".length, indonesiaIdx);
    return result.trim().replace(/^:/, "").trim();
  }

  // ============================ Video Links =============================
  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    const prefix = `${name} - `;
    if (url.includes("ok.ru")) return new OkruExtractor(this.client).videosFromUrl(url, prefix);
    if (url.includes("dailymotion")) return new DailymotionExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (url.includes("https://dood")) return new DoodExtractor(this.client).videosFromUrl(url, name);
    if (url.includes("gdriveplayer")) {
      const gdriveHeaders = this.headersBuilder();
      gdriveHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
      gdriveHeaders.append("Referer", `${this.baseUrl}/`);
      return new GdrivePlayerExtractor(this.client).videosFromUrl(url, name, gdriveHeaders);
    }
    // ponytail: YouTubeExtractor (InnerTube player API posing as the iOS app) is not ported; googlevideo streams want that app's User-Agent, which a browser cannot send.
    if (url.includes("vidstreaming")) return new VidstreamingExtractor(this.client).videosFromUrl(url, prefix);
    return [];
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    super.setupPreferenceScreen(screen); // Quality preferences
    const p = new ListPreference(screen.context);
    p.key = PREF_LANG_KEY;
    p.title = PREF_LANG_TITLE;
    p.entries = PREF_LANG_VALUES;
    p.entryValues = PREF_LANG_VALUES;
    p.setDefaultValue(PREF_LANG_DEFAULT);
    p.summary = "%s";
    screen.addPreference(p);
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(this.prefQualityKey, this.prefQualityDefault) ?? this.prefQualityDefault;
    const language = this.langPref.toLowerCase();
    const score = (v: Video) => (v.videoTitle.includes(quality) ? 2 : 0) + (v.videoTitle.toLowerCase().includes(language) ? 1 : 0);
    return [...videos].reverse().sort((a, b) => score(b) - score(a));
  }
}
