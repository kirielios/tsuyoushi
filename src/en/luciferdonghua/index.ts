// Port of yuzono/anime-extensions src/en/luciferdonghua/LuciferDonghua.kt
import { MultiSelectListPreference, SwitchPreferenceCompat, type PreferenceScreen, type Response, type SEpisode, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { RumbleExtractor } from "../../../libs/rumbleextractor/index.ts";

const PREF_HOSTER_KEY = "luciferdonghua_hoster_selection";
const INTERNAL_HOSTER_NAMES = ["Dailymotion", "Rumble", "Ok.ru"];
const PREF_HOSTER_ENTRY_VALUES = INTERNAL_HOSTER_NAMES.map((it) => it.toLowerCase());

const IGNORE_PREVIEW_KEY = "luciferdonghua_ignore_preview";
const IGNORE_PREVIEW_DEFAULT = true;

const QUALITY_REGEX = /(\d+)p/;

export default class LuciferDonghua extends AnimeStream {
  // ============================== Preferences ==============================
  protected override prefQualityValues = ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];

  private get ignorePreview() {
    return this.preferences.getBoolean(IGNORE_PREVIEW_KEY, IGNORE_PREVIEW_DEFAULT);
  }
  private get enabledHosters() {
    return this.preferences.getStringSet(PREF_HOSTER_KEY, PREF_HOSTER_ENTRY_VALUES);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    super.setupPreferenceScreen(screen);
    const hosts = new MultiSelectListPreference(screen.context);
    hosts.key = PREF_HOSTER_KEY;
    hosts.title = "Enable/Disable Hosts";
    hosts.entries = INTERNAL_HOSTER_NAMES;
    hosts.entryValues = PREF_HOSTER_ENTRY_VALUES;
    hosts.setDefaultValue(PREF_HOSTER_ENTRY_VALUES);
    screen.addPreference(hosts);
    const preview = new SwitchPreferenceCompat(screen.context);
    preview.key = IGNORE_PREVIEW_KEY;
    preview.title = "Skip Preview episodes";
    preview.setDefaultValue(IGNORE_PREVIEW_DEFAULT);
    screen.addPreference(preview);
  }

  // ============================== Episodes ==============================
  protected override episodeListSelector() {
    return "div.eplister > ul > li a";
  }

  protected override getEpisodeNumber(epNum: string) {
    return Number.parseFloat(epNum.replace("[4K]", "").trim().split(" ")[0]) || 0;
  }

  protected override episodeListParse(response: Response): SEpisode[] {
    let episodeList = super.episodeListParse(response);
    if (this.ignorePreview && episodeList.length > 2) {
      episodeList = [...episodeList].sort((a, b) => b.episode_number - a.episode_number);
      if (episodeList[0].date_upload < episodeList[1].date_upload) episodeList = episodeList.slice(1);
    }
    return episodeList;
  }

  protected override getEpisodeIframeSelector() {
    return "#embed_holder iframe[src~=.]";
  }

  // ============================ Video Links =============================
  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    const prefix = `${name} - `;
    const enabled = this.enabledHosters;
    if (enabled.includes("ok.ru") && url.includes("ok.ru")) return new OkruExtractor(this.client).videosFromUrl(url, prefix);
    if (enabled.includes("dailymotion") && url.includes("dailymotion")) return new DailymotionExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (enabled.includes("rumble") && url.includes("rumble")) return new RumbleExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    return [];
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(this.prefQualityKey, this.prefQualityDefault) ?? this.prefQualityDefault;
    const q = (v: Video) => Number.parseInt(QUALITY_REGEX.exec(v.videoTitle)?.[1] ?? "0", 10);
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)) || q(b) - q(a));
  }
}
