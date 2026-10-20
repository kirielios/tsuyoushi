// Port of yuzono/anime-extensions src/all/chineseanime/ChineseAnime.kt
import { ListPreference, type PreferenceScreen, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";
import { VatchusExtractor } from "./extractors/vatchus.ts";

const PREF_LANG_KEY = "preferred_language";
const PREF_LANG_TITLE = "Preferred Video Language";
const PREF_LANG_DEFAULT = "All Sub";
const PREF_LANG_VALUES = ["All Sub", "Arabic", "English", "Indonesia", "Persian", "Malay", "Polish", "Portuguese", "Spanish", "Thai", "Vietnamese"];

export default class ChineseAnime extends AnimeStream {
  // =============================== Search ===============================
  protected override searchAnimeNextPageSelector() {
    return "div.hpage > a.r";
  }

  // =========================== Anime Details ============================
  protected override animeDescriptionSelector = ".entry-content";

  // ============================ Video Links =============================
  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    const prefix = `${name} - `;
    if (url.includes("dailymotion")) return new DailymotionExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (url.includes("embedwish")) return new StreamWishExtractor(this.client, this.headers).videosFromUrl(url, (q) => `${prefix} - ${q}`);
    if (url.includes("vatchus")) return new VatchusExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (url.includes("donghua.xyz/v/")) return new VidHideExtractor(this.client, this.headers).videosFromUrl(url, (q) => `${prefix} ${q}`);
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
    const language = (this.preferences.getString(PREF_LANG_KEY, PREF_LANG_DEFAULT) ?? PREF_LANG_DEFAULT).toLowerCase();
    const score = (v: Video) => (v.videoTitle.includes(quality) ? 2 : 0) + (v.videoTitle.toLowerCase().includes(language) ? 1 : 0);
    return [...videos].reverse().sort((a, b) => score(b) - score(a));
  }
}
