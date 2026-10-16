// Port of yuzono/anime-extensions src/id/samehadaku/Samehadaku.kt (lib 16)
// Cloudflare challenges every path with more than one segment (/anime/<slug>/, /daftar-anime-2/page/2/,
// /wp-admin/admin-ajax.php) but not single-segment ones, so listings page with ?paged=N (preview=true keeps
// WordPress from redirecting to /page/N/) and details load as /anime/?anime=<slug>.
import {
  AnimeHttpSource,
  DateTimeFormatter,
  GET,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  POST,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Document,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { BloggerExtractor } from "../../../libs/bloggerextractor/index.ts";
import { PixelDrainExtractor } from "../../../libs/pixeldrainextractor/index.ts";
import { getFilterList, getSearchParameters } from "./filters.ts";

const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_DEFAULT = "720p";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];
const DATE_FORMATTER = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH);
const SRC_REGEX = /src\s*=\s*["']([^"']+)["']/;
const EPISODE_REGEX = /Episode\s+(\d+(?:\.\d+)?)/;

export default class Samehadaku extends AnimeHttpSource {
  private readonly bloggerExtractor = new BloggerExtractor(this.client);

  // --- catalogue
  protected popularAnimeRequest(page: number) {
    return GET(this.listUrl(page, "&order=popular"), this.headers);
  }
  protected popularAnimeParse(response: Response) {
    return this.getAnimeParse(response.asJsoup(), "div.relat article");
  }
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(this.listUrl(page, "&order=update"), this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.getAnimeParse(response.asJsoup(), "div.relat article");
  }
  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    return GET(this.listUrl(page, `&title=${encodeURIComponent(query)}${getSearchParameters(filters)}`), this.headers);
  }
  protected searchAnimeParse(response: Response) {
    return this.getAnimeParse(response.asJsoup(), ".relat article");
  }
  override getFilterList(): FilterList {
    return getFilterList();
  }

  private listUrl(page: number, params: string) {
    return `${this.baseUrl}/daftar-anime-2/?paged=${page}${params}&preview=true`;
  }

  private getAnimeParse(document: Document, query: string): MangasPage {
    const animes = document.select(query).flatMap((elm) => {
      const href = elm.selectFirst("div > a")?.attr("href");
      const title = elm.selectFirst("div.title > h2")?.text();
      if (!href || !title) return [];
      const anime = SAnime.create();
      anime.url = urlWithoutDomain(href);
      anime.title = title;
      anime.thumbnail_url = elm.selectFirst("div.content-thumb > img")?.attr("src") || undefined;
      return [anime];
    });
    const pagination = document.selectFirst("div.pagination");
    const total = Number.parseInt(pagination?.selectFirst("span:nth-child(1)")?.text().split(" ").pop() ?? "", 10);
    const current = Number.parseInt(pagination?.selectFirst("span.page-numbers.current")?.text() ?? "", 10);
    return new MangasPage(animes, current < total);
  }

  // --- details
  override animeDetailsRequest(anime: SAnime) {
    const slug = /^\/anime\/([^/?#]+)/.exec(anime.url)?.[1];
    return GET(slug ? `${this.baseUrl}/anime/?anime=${slug}` : this.baseUrl + anime.url, this.headers);
  }

  protected animeDetailsParse(response: Response): SAnime {
    const doc = response.asJsoup();
    const info = doc.selectFirst("h2:contains(Nonton Anime)")?.parent();
    const poster = info?.selectFirst("img");
    const anime = SAnime.create();
    anime.title = poster?.attr("alt").trim() || doc.selectFirst("h1")!.text().replace(/Sub Indo$/, "").trim();
    anime.thumbnail_url = poster?.absUrl("src") || undefined;
    anime.description = info?.selectFirst("p")?.text();
    anime.genre = info
      ?.select("a[href*=/genre/]")
      .map((it) => it.text())
      .join(", ");
    anime.author = this.getInfo(doc, "Studio");
    const status = this.getInfo(doc, "Status")?.trim().toLowerCase();
    anime.status = status === "completed" ? SAnime.COMPLETED : status === "ongoing" ? SAnime.ONGOING : SAnime.UNKNOWN;
    return anime;
  }

  private getInfo(doc: Document, label: string): string | undefined {
    return doc.selectFirst(`span:matchesOwn(^\\s*${label}\\s*$) + span`)?.text();
  }

  // --- episodes
  protected episodeListParse(response: Response): SEpisode[] {
    const list = response.asJsoup().selectFirst("h3:contains(List Episode)")?.parent();
    if (!list) return [];
    return list.select("h4 > a[href]").map((link) => {
      const ep = SEpisode.create();
      ep.url = urlWithoutDomain(link.attr("href"));
      ep.name = link.text();
      ep.episode_number = Number.parseFloat(EPISODE_REGEX.exec(ep.name)?.[1] ?? "") || 1;
      ep.date_upload = DATE_FORMATTER.tryParseDate(link.parent()?.nextElementSibling()?.text());
      return ep;
    });
  }

  // --- hosters and videos
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const doc = (await this.executeSuccess(GET(hoster.hosterUrl, this.headers))).asJsoup();
    const embeds = await Promise.all(doc.select("#server > ul > li > div").map((it) => this.getEmbedLink(it).catch(() => null)));
    const settled = await Promise.allSettled(embeds.flatMap((it) => (it ? [this.getVideosFromEmbed(it[0], it[1])] : [])));
    return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)));
  }

  private async getEmbedLink(element: Element): Promise<[string, string]> {
    const server = element.selectFirst("span")?.text() ?? "";
    const embed = SRC_REGEX.exec(element.attr("data-embed"))?.[1];
    if (embed?.trim()) return [server, embed];
    const form = new URLSearchParams({ action: "player_ajax", post: element.attr("data-post"), nume: element.attr("data-nume"), type: element.attr("data-type") });
    const ajaxHeaders = new Headers(this.headers);
    ajaxHeaders.set("User-Agent", USER_AGENT);
    const body = (await this.executeSuccess(POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, ajaxHeaders, form))).text();
    const link = SRC_REGEX.exec(body)?.[1];
    if (!link?.trim()) throw new Error("no embed");
    return [server, link];
  }

  private async getVideosFromEmbed(server: string, link: string): Promise<Video[]> {
    const videoHeaders = new Headers(this.headers);
    videoHeaders.set("User-Agent", USER_AGENT);
    videoHeaders.set("Referer", link);
    const page = async () => (await this.client.get(link, videoHeaders)).asJsoup();

    if (link.includes("mega.nz")) return [];
    if (link.includes(".mp4") || link.includes(".webm") || link.includes(".m3u8")) return [new Video({ videoUrl: link, videoTitle: server, headers: videoHeaders })];
    if (["filedon", "uservideo", "userdrive", "samevideo"].some((it) => link.includes(it))) {
      const dataPage = (await page()).selectFirst("div#app")?.attr("data-page");
      if (!dataPage) return [];
      const videoUrl = (JSON.parse(dataPage) as { props: { url: string } }).props.url;
      return [new Video({ videoUrl, videoTitle: server, headers: videoHeaders })];
    }
    if (link.includes("krakenfiles")) {
      const src = (await page()).selectFirst("source")?.attr("src");
      if (!src) return [];
      return [new Video({ videoUrl: new URL(src, link).href.replaceAll("&amp;", "&"), videoTitle: server, headers: videoHeaders })];
    }
    if (link.includes("pixeldrain.com")) return new PixelDrainExtractor().videosFromUrl(link.split("?")[0], `${server} - `);
    if (link.includes("blogger")) return this.bloggerExtractor.videosFromUrl(link, this.headers, server);
    const src = (await page()).selectFirst("video source")?.attr("src");
    if (!src) return [];
    return [new Video({ videoUrl: new URL(src, link).href, videoTitle: server, headers: videoHeaders })];
  }

  // --- settings
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY_KEY;
    pref.title = "Preferred quality";
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_ENTRIES;
    pref.summary = "%s";
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    screen.addPreference(pref);
  }
}
