// Port of yuzono/anime-extensions src/all/lmanime/LMAnime.kt
import { GET, ListPreference, MultiSelectListPreference, parallelCatchingFlatMap, type Hoster, type PreferenceScreen, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { Mp4uploadExtractor } from "../../../libs/mp4uploadextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";

const PREF_LANG_KEY = "pref_language";
const PREF_LANG_TITLE = "Preferred language";
const PREF_LANG_DEFAULT = "English";
const PREF_LANG_ENTRIES = ["English", "Español", "Indonesian", "Portugués", "Türkçe", "العَرَبِيَّة", "ไทย"];

const PREF_ALLOWED_LANGS_KEY = "pref_allowed_languages";
const PREF_ALLOWED_LANGS_TITLE = "Allowed languages to fetch videos";
const PREF_ALLOWED_LANGS_ENTRIES = PREF_LANG_ENTRIES;
const PREF_ALLOWED_LANGS_DEFAULT = PREF_ALLOWED_LANGS_ENTRIES;

export default class LMAnime extends AnimeStream {
  // ============================ Video Links =============================
  protected override prefQualityValues = ["144p", "288p", "480p", "720p", "1080p"];

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const items = (await this.executeSuccess(GET(hoster.hosterUrl, this.headers))).asJsoup().select(this.videoListSelector());
    const allowed = this.preferences.getStringSet(PREF_ALLOWED_LANGS_KEY, PREF_ALLOWED_LANGS_DEFAULT);
    return parallelCatchingFlatMap(
      [...items].filter((element) => allowed.some((it) => element.text().includes(it))),
      async (it) => {
        const language = it.text().split(" ")[0];
        const url = await this.getHosterUrl(it);
        return this.getVideoListFromUrl(url, language);
      },
    );
  }

  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    const prefix = `(${name}) - `;
    if (url.includes("dailymotion")) return new DailymotionExtractor(this.client, this.headers).videosFromUrl(url, `Dailymotion (${name})`);
    if (url.includes("mp4upload")) return new Mp4uploadExtractor(this.client).videosFromUrl(url, this.headers, prefix);
    if (url.includes("filelions")) return new StreamWishExtractor(this.client, this.headers).videosFromUrl(url, (q) => `StreamWish (${name}) - ${q}`);
    return [];
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    super.setupPreferenceScreen(screen); // Quality preferences
    const lang = new ListPreference(screen.context);
    lang.key = PREF_LANG_KEY;
    lang.title = PREF_LANG_TITLE;
    lang.entries = PREF_LANG_ENTRIES;
    lang.entryValues = PREF_LANG_ENTRIES;
    lang.setDefaultValue(PREF_LANG_DEFAULT);
    lang.summary = "%s";
    screen.addPreference(lang);

    const allowed = new MultiSelectListPreference(screen.context);
    allowed.key = PREF_ALLOWED_LANGS_KEY;
    allowed.title = PREF_ALLOWED_LANGS_TITLE;
    allowed.entries = PREF_ALLOWED_LANGS_ENTRIES;
    allowed.entryValues = PREF_ALLOWED_LANGS_ENTRIES;
    allowed.setDefaultValue(PREF_ALLOWED_LANGS_DEFAULT);
    allowed.summary = "";
    screen.addPreference(allowed);
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(this.prefQualityKey, this.prefQualityDefault) ?? this.prefQualityDefault;
    const lang = (this.preferences.getString(PREF_LANG_KEY, PREF_LANG_DEFAULT) ?? PREF_LANG_DEFAULT).toLowerCase();
    const score = (v: Video) => (v.videoTitle.includes(quality) ? 2 : 0) + (v.videoTitle.toLowerCase().includes(lang) ? 1 : 0);
    return [...videos].reverse().sort((a, b) => score(b) - score(a));
  }
}
