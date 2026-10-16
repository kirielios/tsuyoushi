// Port of yuzono/anime-extensions src/id/nimegami/NimeGami.kt (lib 16)
import {
  AnimeHttpSource,
  extractNextJs,
  GET,
  hasKeys,
  Hoster,
  MangasPage,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Document,
  type Element,
  type FilterList,
  type Response,
} from "../../../sdk/index.ts";
import { Mp4uploadExtractor } from "../../../libs/mp4uploadextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";

type LinkDto = { playUrl?: string | null; mode?: string | null; label?: string | null; host?: string; quality?: string | null; episode?: number | null };
type PlayerData = { links: LinkDto[]; slug: string; movie?: boolean; episodeInfo?: { number: number }[] };

const PREFIX_SEARCH = "id:";
const SUPPORTED_HOSTS = ["berkasdrive", "workers.dev", "mp4upload", "vidhide"];
const QUALITY_REGEX = /(\d{3,4})p/;

export default class NimeGami extends AnimeHttpSource {
  // --- catalogue
  protected popularAnimeRequest(page: number) {
    return this.catalogRequest(page, "popular");
  }
  protected popularAnimeParse(response: Response) {
    return this.catalogParse(response);
  }
  protected latestUpdatesAnimeRequest(page: number) {
    return this.catalogRequest(page, "updated");
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.catalogParse(response);
  }
  protected searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    return this.catalogRequest(page, "updated", query);
  }
  protected searchAnimeParse(response: Response) {
    return this.catalogParse(response);
  }

  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (url.host !== new URL(this.baseUrl).host || !id) throw new Error("Unsupported url");
      return this.getSearchAnime(page, PREFIX_SEARCH + id, filters);
    }
    if (query.startsWith(PREFIX_SEARCH)) {
      const response = await this.executeSuccess(GET(`${this.baseUrl}/${query.slice(PREFIX_SEARCH.length)}/`, this.headers));
      const details = this.animeDetailsParse(response);
      details.url = urlWithoutDomain(response.url);
      details.initialized = true;
      return new MangasPage([details], false);
    }
    return super.getSearchAnime(page, query, filters);
  }

  private catalogRequest(page: number, sort: string, query = "") {
    const url = new URL(`${this.baseUrl}/anime/`);
    if (query.trim()) url.searchParams.set("q", query);
    url.searchParams.set("sort", sort);
    if (page > 1) url.searchParams.set("page", String(page));
    return GET(url, this.headers);
  }

  private catalogParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const animes = document.select("article.anime-card > a.poster-link").map((link) => {
      const anime = SAnime.create();
      anime.url = urlWithoutDomain(link.absUrl("href"));
      const poster = link.selectFirst("img");
      anime.title = poster?.attr("alt").trim() || link.attr("aria-label").replace(/^Lihat /, "");
      anime.thumbnail_url = (poster && this.imageUrl(poster)) ?? undefined;
      return anime;
    });
    return new MangasPage(animes, document.selectFirst("a.page-arrow[aria-label=Halaman berikutnya]") != null);
  }

  // --- details
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.title = document.selectFirst("header.post-header h1")!.text();
    const poster = document.selectFirst("div.detail-poster img");
    anime.thumbnail_url = (poster && this.imageUrl(poster)) ?? undefined;
    anime.genre = document.select("div.post-genres a").map((a) => a.text()).join(", ");
    anime.artist = this.getInfo(document, "Studio") ?? undefined;
    const status = this.getInfo(document, "Status")?.toLowerCase();
    anime.status = status === "ongoing" ? SAnime.ONGOING : status === "completed" || status === "finished" || status === "tamat" ? SAnime.COMPLETED : SAnime.UNKNOWN;
    let description = document.select("div.synopsis-block > p").eachText().map((t) => `${t}\n`).join("");
    for (const label of ["Judul alternatif", "Tipe", "Musim", "Mulai tayang", "Durasi"]) {
      const v = this.getInfo(document, label);
      if (v) description += `\n${label}: ${v}`;
    }
    anime.description = description.trim();
    return anime;
  }

  private getInfo(document: Document, label: string): string | null {
    const v = document.selectFirst(`dl div:has(> dt:containsOwn(${label})) > dd`)?.text();
    return v && v !== "Belum tersedia" ? v : null;
  }

  private imageUrl(el: Element): string | null {
    const src = el.attr("srcset").split(" ")[0] || el.attr("src");
    if (!src) return null;
    try {
      const image = new URL(src, this.baseUrl);
      const inner = image.searchParams.get("url");
      return inner ? new URL(inner, this.baseUrl).href : image.href;
    } catch {
      return null;
    }
  }

  // --- episodes
  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const data = await this.fetchPlayerData(anime.url);
    const numbers = [...new Set([...data.links.flatMap((l) => (l.episode != null ? [l.episode] : [])), ...(data.episodeInfo ?? []).map((e) => e.number)])].sort((a, b) => b - a);
    return numbers.map((n) => {
      const ep = SEpisode.create();
      ep.url = `/${data.slug}/#episode_${n}`;
      ep.episode_number = n;
      ep.name = data.movie && numbers.length === 1 ? "Movie" : `Episode ${n}`;
      return ep;
    });
  }
  protected episodeListParse(): SEpisode[] {
    throw new Error("unused");
  }

  // --- hosters and videos
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const n = Number.parseInt(episode.url.split("#episode_")[1] ?? "", 10);
    if (Number.isNaN(n)) throw new Error("Refresh the episode list to play this episode");
    const data = await this.fetchPlayerData(episode.url.split("#")[0]);
    return data.links
      .filter((l) => l.episode === n && l.mode === "embed" && l.playUrl && SUPPORTED_HOSTS.some((h) => (l.host ?? "").includes(h)))
      .map((l) => new Hoster(l.playUrl!, [l.label, l.quality].filter(Boolean).join(" - ")));
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const url = hoster.hosterUrl;
    if (url.includes("mp4upload")) return new Mp4uploadExtractor(this.client).videosFromUrl(url, this.headers, `${hoster.hosterName} - `);
    if (url.includes("vidhide")) return new VidHideExtractor(this.client, this.headers).videosFromUrl(url, (q) => `${hoster.hosterName} (${q})`);
    const document = (await this.executeSuccess(GET(url, this.headers))).asJsoup();
    const videoUrl = document.selectFirst("main#player[data-src]")?.absUrl("data-src") || document.selectFirst("video[src], video source[src]")?.absUrl("src");
    return videoUrl ? [new Video({ videoUrl, videoTitle: hoster.hosterName, headers: this.headers })] : [];
  }

  override sortHosters(hosters: Hoster[]): Hoster[] {
    const q = (h: Hoster) => Number.parseInt(QUALITY_REGEX.exec(h.hosterName)?.[1] ?? "0", 10);
    return [...hosters].sort((a, b) => q(b) - q(a));
  }

  private async fetchPlayerData(animeUrl: string): Promise<PlayerData> {
    const response = await this.executeSuccess(GET(this.baseUrl + animeUrl, this.headers));
    const data = extractNextJs<PlayerData>(response, hasKeys("links", "slug"));
    if (!data) throw new Error("No episodes found");
    return data;
  }
}
