// Port of yuzono/anime-extensions src/all/javguru/JavGuru.kt
import {
  AnimeHttpSource,
  Base64,
  DateTimeFormatter,
  fromUtf8,
  GET,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Elements,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { DoodExtractor } from "../../../libs/doodextractor/index.ts";
import { JavCoverFetcher } from "../../../libs/javcoverfetcher/index.ts";
import { MixDropExtractor } from "../../../libs/mixdropextractor/index.ts";
import { StreamTapeExtractor } from "../../../libs/streamtapeextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { EmTurboExtractor } from "./extractors/emturbo.ts";
import { MaxStreamExtractor } from "./extractors/maxstream.ts";
import { ActorFilter, ActressFilter, CategoryFilter, getFilters, MakerFilter, StudioFilter, TagGroup } from "./filters.ts";

const PREFIX_ID = "id:";

const IFRAME_B64_REGEX = /"iframe_url":"([^"]+)"/g;
const CID_REGEX = /cid:\s*['"]([^'"]+)['"]/;
const BASE_REGEX = /base:\s*['"]([^'"]+)['"]/;
const RTYPE_REGEX = /rtype:\s*['"]([^'"]+)['"]/;
const KEYS_REGEX = /keys:\s*\[([^\]]+)]/;
const PAGINATION_REGEX = /\/page\/(\d+)/;

const DATE_FORMATTER = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

const PREF_QUALITY = "preferred_quality";
const PREF_QUALITY_TITLE = "Preferred quality";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];
const PREF_QUALITY_VALUES = ["1080", "720", "480", "360"];
const PREF_QUALITY_DEFAULT = PREF_QUALITY_VALUES[0];

export default class JavGuru extends AnimeHttpSource {
  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    headers.set("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8");
    return headers;
  }

  private popularElements: Elements | null = null;

  // ========================= Popular =========================

  override async fetchPopularManga(page: number): Promise<MangasPage> {
    if (page === 1 || !this.popularElements) return this.popularAnimeParse(await this.executeSuccess(this.popularAnimeRequest(page)), page);
    return this.cachedPopularAnimeParse(page);
  }

  protected popularAnimeRequest(_page: number) {
    return GET(`${this.baseUrl}/most-watched-rank/`, this.headers);
  }

  protected popularAnimeParse(response: Response, page = 1): MangasPage {
    this.popularElements = response.asJsoup().select(".rank-item");
    return this.cachedPopularAnimeParse(page);
  }

  private cachedPopularAnimeParse(page: number): MangasPage {
    const elements = this.popularElements!;
    const end = Math.min(page * 20, elements.length);
    const entries = elements.slice((page - 1) * 20, end).map((element) => {
      const anime = SAnime.create();
      const a = element.select(".rank-title a");
      anime.url = this.getIDFromUrl(a) ?? urlWithoutDomain(a.attr("href"));
      anime.title = a.text();
      anime.thumbnail_url = element.select("img").attr("abs:src");
      return anime;
    });
    return new MangasPage(entries, end < elements.length);
  }

  // ========================= Latest =========================

  protected latestUpdatesAnimeRequest(page: number) {
    return GET(this.baseUrl + (page > 1 ? `/page/${page}/` : ""), this.headers);
  }

  protected latestUpdatesAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const entries = document.select("div.site-content div.inside-article:not(:contains(nothing))").map((element) => {
      const anime = SAnime.create();
      const a = element.select("a");
      anime.url = this.getIDFromUrl(a) ?? urlWithoutDomain(a.attr("href"));
      anime.thumbnail_url = element.select("img").attr("abs:src");
      anime.title = element.select("h2 > a").text();
      return anime;
    });
    const page = pageNumberFromUrlOrNull(response.url) ?? 1;
    const lastPage = pageNumberFromUrlOrNull(document.select("div.wp-pagenavi a").last()?.attr("href")) ?? 1;
    return new MangasPage(entries, page < lastPage);
  }

  // ========================= Search =========================

  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let queryUrl: URL | null = null;
    try {
      queryUrl = new URL(query);
    } catch {
      // not a URL
    }
    if (queryUrl?.host === new URL(this.baseUrl).host) {
      const cleanSegments = queryUrl.pathname.split("/").filter(Boolean);
      if (cleanSegments.length === 1) return this.byUrl(`/${cleanSegments[0]}/`);
    }

    if (query.startsWith(PREFIX_ID)) {
      const id = query.slice(PREFIX_ID.length);
      if (!/^-?\d+$/.test(id)) return new MangasPage([], false);
      return this.byUrl(`/${id}/`);
    }

    if (query) return this.searchAnimeParse(await this.executeSuccess(this.searchAnimeRequest(page, query, filters)));

    const pagePart = page > 1 ? `page/${page}/` : "";
    const selectedTags = (filters.find((f): f is TagGroup => f instanceof TagGroup)?.state ?? []).filter((it) => it.state);
    if (selectedTags.length) {
      const combinedSlug = selectedTags.map((it) => it.urlPart.replace(/^\/+|\/+$/g, "").split("/").pop()).join("+");
      return this.searchAnimeParse(await this.executeSuccess(GET(`${this.baseUrl}/tag/${combinedSlug}/${pagePart}`, this.headers)));
    }

    for (const filter of filters) {
      if (filter instanceof CategoryFilter) {
        if (filter.state !== 0) return this.searchAnimeParse(await this.executeSuccess(GET(`${this.baseUrl}${filter.toUrlPart()}${pagePart}`, this.headers)));
      } else if (filter instanceof ActressFilter || filter instanceof ActorFilter || filter instanceof StudioFilter || filter instanceof MakerFilter) {
        if (filter.state) {
          const response = await this.client.execute(GET(`${this.baseUrl}${filter.toUrlPart()}${pagePart}`, this.headers));
          // awaitIgnoreCode(404)
          if (!response.isSuccessful && response.code !== 404) throw new Error(`HTTP error ${response.code}`);
          return this.searchAnimeParse(response);
        }
      }
    }

    throw new Error("Select at least one Filter");
  }

  private async byUrl(url: string): Promise<MangasPage> {
    const temp = SAnime.create();
    temp.url = url;
    const anime = await this.getAnimeDetails(temp);
    anime.url = url;
    return new MangasPage([anime], false);
  }

  protected searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    const url = new URL(this.baseUrl + (page > 1 ? `/page/${page}/` : "/"));
    url.searchParams.append("s", query);
    return GET(url, this.headers);
  }

  protected searchAnimeParse(response: Response) {
    return this.latestUpdatesAnimeParse(response);
  }

  // ========================= Details =========================

  protected async animeDetailsParse(response: Response): Promise<SAnime> {
    const document = response.asJsoup();
    const javId = document.selectFirst(".infoleft li:contains(code)")?.ownText();
    const siteCover = document.select(".large-screenshot img").attr("abs:src");

    const anime = SAnime.create();
    anime.title = document.select(".titl").text();
    anime.genre = document
      .select(".infoleft a[rel*=tag]")
      .map((it) => it.text())
      .join(", ");
    anime.author = document.selectFirst(".infoleft li:contains(studio) a")?.text();
    anime.artist = document.selectFirst(".infoleft li:contains(label) a")?.text();
    anime.status = SAnime.COMPLETED;
    let description = "";
    for (const label of ["code", "director", "studio", "label", "actor", "actress", "release date"]) {
      const text = document.selectFirst(`.infoleft li:contains(${label})`)?.text();
      if (text != null) description += `${text}\n`;
    }
    anime.description = description;
    anime.thumbnail_url = JavCoverFetcher.fetchHDCovers(this.preferences) && javId ? ((await JavCoverFetcher.getCoverById(this.client, javId)) ?? siteCover) : siteCover;
    return anime;
  }

  // ========================= Episodes =========================

  protected episodeListParse(response: Response): SEpisode[] {
    const document = response.asJsoup();
    const dateText = document.selectFirst("span.thedate")?.text();
    const episode = SEpisode.create();
    episode.url = new URL(response.url).pathname;
    episode.name = "Episode";
    episode.date_upload = DATE_FORMATTER.tryParseDate(dateText?.includes("Posted:") ? dateText.slice(dateText.indexOf("Posted:") + 7).trim() : dateText?.trim());
    return [episode];
  }

  // ========================= Videos =========================

  protected override async hosterListParse(response: Response): Promise<Hoster[]> {
    const document = response.asJsoup();
    const iframeData = document.selectFirst("script:containsData(iframe_url)")?.html();
    if (!iframeData) return [];
    const iframeUrls = [...iframeData.matchAll(IFRAME_B64_REGEX)].map((it) => fromUtf8(Base64.decode(it[1])));
    const hosters = await Promise.all(iframeUrls.map((it) => this.resolveHosterUrl(it).catch(() => null)));
    return hosters.filter((it): it is Hoster => it != null);
  }

  private async resolveHosterUrl(iframeUrl: string): Promise<Hoster | null> {
    const token = URL.canParse(iframeUrl) ? new URL(iframeUrl).searchParams.get("xd") : null;
    let finalUrl: string;
    if (token != null) {
      finalUrl = `${iframeUrl.split("?")[0]}?xr=${[...token].reverse().join("")}`;
    } else {
      const iframeDocument = (await this.client.get(iframeUrl, this.headers)).asJsoup();
      const script = iframeDocument.selectFirst("script:containsData(cfg)")?.html();
      if (!script) return null;
      const cid = CID_REGEX.exec(script)?.[1];
      const rawBase = BASE_REGEX.exec(script)?.[1];
      if (!cid || !rawBase) return null;
      const base = URL.canParse(rawBase, iframeUrl) ? new URL(rawBase, iframeUrl).toString() : rawBase;
      const rtype = RTYPE_REGEX.exec(script)?.[1] ?? "x";
      const keys = KEYS_REGEX.exec(script)?.[1]
        ?.split(",")
        .map((it) => it.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1"));
      if (!keys) return null;
      const element = iframeDocument.selectFirst(`[id="${cid}"]`);
      if (!element) return null;
      const fullToken = keys.map((key) => element.attr(key)).join("");
      if (!fullToken.trim()) return null;
      finalUrl = `${base}?${rtype}r=${[...fullToken].reverse().join("")}`;
    }

    const newHeaders = this.headersBuilder();
    newHeaders.set("Referer", iframeUrl);
    // ponytail: upstream reads the Location of an unfollowed redirect; the host always follows redirects, so the hoster
    // URL is where the request ended up (one extra page load). No redirect means no hoster.
    const response = await this.client.execute(GET(finalUrl, newHeaders));
    const redirectUrl = response.url;
    if (redirectUrl === finalUrl || !URL.canParse(redirectUrl)) return null;
    return new Hoster(redirectUrl, new URL(redirectUrl).host || "Unknown");
  }

  private get streamWishExtractor() {
    const swHeaders = this.headersBuilder();
    swHeaders.set("Referer", `${this.baseUrl}/`);
    return new StreamWishExtractor(this.client, swHeaders);
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const hosterUrl = hoster.hosterUrl;
    const has = (...s: string[]) => s.some((it) => hosterUrl.includes(it));
    if (has("javplaya", "javclan")) {
      return (await this.streamWishExtractor.videosFromUrl(hosterUrl)).map((video) => {
        const newHeaders = new Headers(video.headers ?? this.headers);
        newHeaders.set("Referer", `${this.baseUrl}/`);
        newHeaders.set("Origin", this.baseUrl);
        return new Video({ ...video, headers: newHeaders });
      });
    }
    if (has("streamtape")) {
      const video = await new StreamTapeExtractor(this.client).videoFromUrl(hosterUrl);
      return video ? [video] : [];
    }
    if (has("dood", "ds2play")) return new DoodExtractor(this.client).videosFromUrl(hosterUrl);
    if (has("mixdrop", "mixdroop")) return new MixDropExtractor(this.client).videoFromUrl(hosterUrl);
    if (has("maxstream")) return new MaxStreamExtractor(this.client, this.headers).videoFromUrl(hosterUrl);
    if (has("emturbovid")) return new EmTurboExtractor(this.client, this.headers).getVideos(hosterUrl);
    return [];
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY, PREF_QUALITY_DEFAULT)!;
    const isJavClan = (it: Video) => (["javplaya", "javclan", "streamwish", "wishembed"].some((host) => it.videoUrl.includes(host)) ? 1 : 0);
    return [...videos].sort((a, b) => isJavClan(a) - isJavClan(b) || Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)));
  }

  // ========================= Utilities =========================

  private getIDFromUrl(element: Elements): string | null {
    try {
      const first = new URL(element.attr("abs:href")).pathname.split("/").filter(Boolean)[0];
      return first && /^-?\d+$/.test(first) ? `/${Number.parseInt(first, 10)}/` : null;
    } catch {
      return null;
    }
  }

  override getFilterList(): FilterList {
    return getFilters();
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY;
    pref.title = PREF_QUALITY_TITLE;
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_VALUES;
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    pref.summary = "%s";
    screen.addPreference(pref);

    JavCoverFetcher.addPreferenceToScreen(screen);
  }
}

function pageNumberFromUrlOrNull(url: string | null | undefined): number | null {
  const n = url ? Number.parseInt(PAGINATION_REGEX.exec(url)?.[1] ?? "", 10) : Number.NaN;
  return Number.isNaN(n) ? null : n;
}
