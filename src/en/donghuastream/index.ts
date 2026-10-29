// Port of yuzono/anime-extensions src/en/donghuastream/DonghuaStream.kt
import { GET, MultiSelectListPreference, SwitchPreferenceCompat, type FilterList, type PreferenceScreen, type Response, type SEpisode, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { DailymotionExtractor } from "../../../libs/dailymotionextractor/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { RumbleExtractor } from "../../../libs/rumbleextractor/index.ts";
import { StreamPlayExtractor } from "../../../libs/streamplayextractor/index.ts";

const PREF_HOSTER_KEY = "dm_hoster_selection";
const INTERNAL_HOSTER_NAMES = ["Dailymotion", "Streamplay", "Rumble", "Ok.ru"];
const PREF_HOSTER_ENTRY_VALUES = INTERNAL_HOSTER_NAMES.map((it) => it.toLowerCase());

const IGNORE_PREVIEW_KEY = "dm_ignore_preview";
const IGNORE_PREVIEW_DEFAULT = true;

const QUALITY_REGEX = /(\d+)p/;

export default class DonghuaStream extends AnimeStream {
  // ============================ Manual Changes ==========================
  // popularAnimeNextPageSelector / latestUpdatesNextPageSelector: the theme parses all three lists with the search one.
  protected override searchAnimeNextPageSelector() {
    return `div.mrgn a.r, ${super.searchAnimeNextPageSelector()}`;
  }

  protected override searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    return GET(`${this.baseUrl}/pagg/${page}/?s=${encodeURIComponent(query)}`, this.headers);
  }

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

  protected override prefQualityValues = ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];

  protected override episodeListParse(response: Response): SEpisode[] {
    const ignore = this.ignorePreview;
    return super.episodeListParse(response).filter((it) => !ignore || !it.name.toLowerCase().includes("preview"));
  }

  // ============================ Video Links =============================
  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    const prefix = `${name} - `;
    const enabled = this.enabledHosters;
    if (enabled.includes("dailymotion") && url.includes("dailymotion")) return new DailymotionExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (enabled.includes("streamplay") && url.includes("streamplay")) return new StreamPlayExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    if (enabled.includes("ok.ru") && url.includes("ok.ru")) return new OkruExtractor(this.client).videosFromUrl(url.startsWith("//") ? `https:${url}` : url, prefix);
    if (enabled.includes("rumble") && url.includes("rumble")) return new RumbleExtractor(this.client, this.headers).videosFromUrl(url, prefix);
    return [];
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = (this.preferences.getString(this.prefQualityKey, this.prefQualityDefault) ?? this.prefQualityDefault).toLowerCase();
    const q = (v: Video) => Number.parseInt(QUALITY_REGEX.exec(v.videoTitle)?.[1] ?? "0", 10);
    return [...videos].sort(
      (a, b) =>
        Number(b.videoTitle.toLowerCase().includes(quality)) - Number(a.videoTitle.toLowerCase().includes(quality)) ||
        q(b) - q(a) ||
        a.videoTitle.localeCompare(b.videoTitle),
    );
  }
}
