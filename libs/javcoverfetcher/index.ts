// Port of aniyomi lib/javcoverfetcher. Upstream reaches the app's client through Injekt; here the caller passes its
// HttpClient as the first argument.
import type { HttpClient } from "../../sdk/network.ts";
import { SwitchPreferenceCompat, type PreferenceScreen, type SharedPreferences } from "../../sdk/preferences.ts";

const PREF_KEY = "JavCoverFetcherPref";
// keiyoushi's commonEmptyHeaders: no User-Agent of the source's own
const commonEmptyHeaders = () => new Headers();

export const JavCoverFetcher = {
  /**
   *  Get HD Jav Cover from Amazon
   *
   * @param jpTitle title of jav in japanese
   */
  async getCoverByTitle(client: HttpClient, jpTitle: string): Promise<string | null> {
    try {
      const amazonUrl = await getDDGSearchResult(client, jpTitle);
      if (!amazonUrl) return null;
      return await getHDCoverFromAmazonUrl(client, amazonUrl);
    } catch {
      return null;
    }
  },

  /**
   *  Get HD Jav Cover from Amazon
   *
   * @param javId standard JAV code e.g PRIN-006
   */
  async getCoverById(client: HttpClient, javId: string): Promise<string | null> {
    try {
      const jpTitle = await getJPTitleFromID(client, javId);
      if (!jpTitle) return null;
      const amazonUrl = await getDDGSearchResult(client, jpTitle);
      if (!amazonUrl) return null;
      return await getHDCoverFromAmazonUrl(client, amazonUrl);
    } catch {
      return null;
    }
  },

  addPreferenceToScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_KEY;
    p.title = "Fetch HD covers from Amazon";
    p.summary = "Attempts to fetch vertical HD covers from Amazon.\nMay result in incorrect cover.";
    p.setDefaultValue(false);
    screen.addPreference(p);
  },

  /** SharedPreferences.fetchHDCovers */
  fetchHDCovers: (prefs: SharedPreferences) => prefs.getBoolean(PREF_KEY, false),
};

async function getJPTitleFromID(client: HttpClient, javId: string): Promise<string | null> {
  const url = `https://www.javlibrary.com/ja/vl_searchbyid.php?keyword=${javId}`;
  const response = await client.get(url, commonEmptyHeaders(), { ensureSuccess: false });
  let document = response.asJsoup();

  // possibly multiple results or none
  if (new URL(response.url).pathname.split("/").includes("vl_searchbyid.php")) {
    const targetUrl = document.selectFirst('.videos a[href*="?v="]')?.attr("abs:href");
    if (!targetUrl) return null;
    document = (await client.get(targetUrl, commonEmptyHeaders(), { ensureSuccess: false })).asJsoup();
  }

  const dirtyTitle = document.selectFirst(".post-title")?.text();
  const id = document.select("#video_info tr > td:contains(品番) + td").text();
  if (dirtyTitle == null) return null;
  const at = id ? dirtyTitle.indexOf(id) : -1;
  return (at < 0 ? dirtyTitle : dirtyTitle.slice(at + id.length)).trim();
}

async function getDDGSearchResult(client: HttpClient, jpTitle: string): Promise<string | null> {
  const url = "https://lite.duckduckgo.com/lite/";
  const form = new URLSearchParams({ q: `site:amazon.co.jp inurl:/dp/${jpTitle}` });
  const headers = new Headers({
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    Host: "lite.duckduckgo.com",
    Referer: "https://lite.duckduckgo.com/",
    Origin: "https://lite.duckduckgo.com",
    "Accept-Language": "en-US,en;q=0.5",
    DNT: "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    TE: "trailers",
  });
  const document = (await client.post(url, headers, form, { ensureSuccess: false })).asJsoup();
  return document.selectFirst("a.result-link")?.attr("href") ?? null;
}

async function getHDCoverFromAmazonUrl(client: HttpClient, amazonUrl: string): Promise<string | null> {
  const basicCoverUrl = "https://m.media-amazon.com/images/P/%s.01.MAIN._SCRM_.jpg";
  const asin = /\/dp\/(\w+)/.exec(amazonUrl)?.[1];
  if (!asin) return null;
  let cover = basicCoverUrl.replace("%s", asin);
  if (!(await checkCover(client, cover))) cover = cover.replace(".01.", ".");
  return cover;
}

const checkCover = async (client: HttpClient, cover: string) => (await getContentLength(client, cover)) > 100;

async function getContentLength(client: HttpClient, url: string): Promise<number> {
  const res = await client.head(url, new Headers(), { ensureSuccess: false });
  return Number(res.header("content-length")) || 0;
}
