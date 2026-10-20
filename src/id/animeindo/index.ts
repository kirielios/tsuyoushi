// Port of yuzono/anime-extensions src/id/animeindo/AnimeIndo.kt, rewritten for the site's current Laravel/Livewire
// movie & TV CMS (/tv-show/<slug>, /movie/<slug>, /episode/<slug>/<season>-<episode>); upstream's AnimeStream
// selectors match nothing there.
import {
  AnimeHttpSource,
  Filter,
  FilterList,
  GET,
  Hoster,
  MangasPage,
  parseAs,
  parseHtml,
  POST,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Document,
  type Element,
  type Response,
} from "../../../sdk/index.ts";
import { DoodExtractor } from "../../../libs/doodextractor/index.ts";
import { FilemoonExtractor } from "../../../libs/filemoonextractor/index.ts";
import { GoogleDriveExtractor } from "../../../libs/googledriveextractor/index.ts";
import { Mp4uploadExtractor } from "../../../libs/mp4uploadextractor/index.ts";
import { StreamTapeExtractor } from "../../../libs/streamtapeextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";
import { streamRubyVideos } from "./extractors/streamruby.ts";

type Snapshot = { data: Record<string, unknown>; memo: { name: string } };
type VideoEntry = [{ label: string; type: string; link: string }, unknown];
type LivewireDto = { components: { effects: { html?: string } }[] };

const NEXT_PAGE = "[wire:click^=nextPage]";
const SEASON_BUTTON = "button[wire:click^=updateSeason]";
const SEASON_ID = /updateSeason\('(\d+)'\)/;
const SEASON_EPISODE = /\/(\d+)-(\d+)$/;

class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((v) => v[0]),
    );
  }
  get value() {
    return this.vals[this.state][1];
  }
}

export default class AnimeIndo extends AnimeHttpSource {
  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/trending?page=${page}`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    return this.listParse(response);
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/browse?page=${page}`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.listParse(response);
  }

  // =============================== Search ===============================
  // ponytail: genre/country/year filters (numeric ids on /browse) are not offered; sort and type cover browsing.
  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    if (query.trim()) return GET(`${this.baseUrl}/search/${encodeURIComponent(query.trim())}?page=${page}`, this.headers);
    const url = new URL(`${this.baseUrl}/browse`);
    url.searchParams.set("page", String(page));
    const [sort, type] = filters.filter((f): f is SelectFilter => f instanceof SelectFilter).map((f) => f.value);
    if (sort) url.searchParams.set("sort", sort);
    if (type) url.searchParams.set("type", type);
    return GET(url.href, this.headers);
  }
  protected searchAnimeParse(response: Response) {
    return this.listParse(response);
  }
  override getFilterList(): FilterList {
    return FilterList(
      new Filter.Header("Filter diabaikan saat mencari judul"),
      new SelectFilter("Urutkan", [
        ["Terbaru", ""],
        ["Paling dilihat", "view"],
        ["Tanggal rilis", "release_date"],
        ["Paling disukai", "like_count"],
        ["Judul", "title"],
        ["Rating", "vote_average"],
      ]),
      new SelectFilter("Tipe", [
        ["Semua", ""],
        ["TV", "tv"],
        ["Movie", "movie"],
      ]),
    );
  }

  private listParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const animes = document.select("a.aspect-poster[href]").map((a) => {
      const anime = SAnime.create();
      anime.url = urlWithoutDomain(a.attr("href"));
      const img = a.selectFirst("img");
      anime.title = a.parent()?.selectFirst("h3")?.text() || img?.attr("alt") || "";
      anime.thumbnail_url = img?.attr("data-src") || img?.attr("src") || undefined;
      return anime;
    });
    return new MangasPage(animes, document.selectFirst(NEXT_PAGE) != null);
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.title = document.selectFirst("h1")?.text() ?? "";
    anime.thumbnail_url = document.selectFirst('div[class*="aspect-[2/3]"] img')?.attr("src") || document.selectFirst("meta[property=og:image]")?.attr("content") || undefined;
    const rows = new Map(document.select("div.my-6.space-y-2 > div").map((row) => [row.children()[0]?.text().trim() ?? "", row.children()[1]] as const));
    anime.genre = rows.get("Genre")?.select("a").map((a) => a.text()).join(", ") || undefined;
    const info = [...rows].filter(([k, v]) => k && v && k !== "Genre" && k !== "Cast").map(([k, v]) => `${k}: ${v!.text()}`);
    const alt = document.selectFirst("h2")?.text();
    anime.description = [document.selectFirst("h1 ~ p")?.text(), alt && `Judul lain: ${alt}`, info.join("\n")].filter(Boolean).join("\n\n");
    anime.status = SAnime.UNKNOWN;
    return anime;
  }

  // ============================== Episodes ==============================
  // A TV show's page lists one season; the others come from the season component's Livewire `updateSeason` call
  // (it needs the page's session cookie, which the client's cookie jar - or the browser's, via the Helper - keeps).
  protected async episodeListParse(response: Response): Promise<SEpisode[]> {
    const path = urlWithoutDomain(response.url);
    if (path.startsWith("/movie/")) {
      const episode = SEpisode.create();
      episode.url = path;
      episode.name = "Movie";
      episode.episode_number = 1;
      return [episode];
    }
    const document = response.asJsoup();
    const docs: Element[] = [document];
    const buttons = document.select(SEASON_BUTTON);
    const season = this.snapshots(document).find((s) => s.json.memo.name === "season-component");
    const token = document.selectFirst("meta[name=csrf-token]")?.attr("content");
    if (buttons.length > 1 && season && token) {
      const current = `Season ${season.json.data.season_number}`;
      for (const b of buttons.filter((b) => b.text().trim() !== current)) {
        const id = SEASON_ID.exec(b.attr("wire:click"))?.[1];
        if (id) docs.push(await this.livewire(path, token, season.raw, "updateSeason", [id]));
      }
    }
    const seen = new Set<string>();
    const episodes = docs
      .flatMap((d) => d.select("a[href*=/episode/]"))
      .flatMap((a) => {
        const url = urlWithoutDomain(a.attr("href"));
        const m = SEASON_EPISODE.exec(url);
        if (!m || seen.has(url)) return [];
        seen.add(url);
        const title = a.parent()?.selectFirst("h3")?.text() ?? "";
        const episode = SEpisode.create();
        episode.url = url;
        episode.name = `S${m[1]} E${m[2]}${title && !/^Episode \d+$/i.test(title) ? ` ${title}` : ""}`;
        episode.episode_number = Number(m[2]);
        episode.memo = { season: Number(m[1]) };
        return [episode];
      })
      .sort((a, b) => (a.memo.season as number) - (b.memo.season as number) || a.episode_number - b.episode_number);
    // several seasons: number straight through, so each episode keeps its own number
    if (new Set(episodes.map((e) => e.memo.season)).size > 1) episodes.forEach((e, i) => (e.episode_number = i + 1));
    return episodes.reverse();
  }

  private snapshots(document: Document): { raw: string; json: Snapshot }[] {
    return document.select("[wire:snapshot]").map((e) => {
      const raw = e.attr("wire:snapshot");
      return { raw, json: parseAs<Snapshot>(raw) };
    });
  }

  private async livewire(path: string, token: string, snapshot: string, method: string, params: unknown[]): Promise<Document> {
    const headers = new Headers(this.headers);
    headers.set("Accept", "*/*");
    headers.set("X-Livewire", "true");
    headers.set("Origin", this.baseUrl);
    headers.set("Referer", this.baseUrl + path);
    const body = JSON.stringify({ _token: token, components: [{ snapshot, updates: {}, calls: [{ path: "", method, params }] }] });
    const dto = (await this.executeSuccess(POST(`${this.baseUrl}/livewire/update`, headers, body, "application/json"))).parseAs<LivewireDto>();
    return parseHtml(this.host.load, dto.components[0]?.effects.html ?? "", this.baseUrl);
  }

  // ============================ Video Links =============================
  // The watch component's snapshot lists the servers, each an /embed/<id> page holding a <source> or an <iframe>.
  protected override hosterListParse(response: Response): Hoster[] {
    const watch = this.snapshots(response.asJsoup()).find((s) => s.json.memo.name === "watch-component");
    const videos = (watch?.json.data.videos as [VideoEntry[], unknown] | undefined)?.[0] ?? [];
    return videos.map(([v]) => new Hoster(v.link, v.label));
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const headers = new Headers(this.headers);
    headers.set("Referer", `${this.baseUrl}/`);
    const document = (await this.executeSuccess(GET(hoster.hosterUrl, headers))).asJsoup();
    const name = hoster.hosterName;
    const source = document.selectFirst("video source[src]")?.attr("src");
    if (source) {
      // the site stores some signed R2 links cut off before their signature: those never play
      if (source.includes(".r2.cloudflarestorage.com/") && !source.includes("X-Amz-Signature")) return [];
      return [new Video({ videoUrl: source, videoTitle: name, headers })];
    }
    const url = document.selectFirst("iframe[src]")?.attr("src");
    if (!url) return [];
    const host = new URL(url).host;
    switch (true) {
      case host.includes("streamtape"): {
        const video = await new StreamTapeExtractor(this.client).videoFromUrl(url, `${name} - Streamtape`);
        return video ? [video] : [];
      }
      case name === "FM" || host.includes("filemoon"):
        return new FilemoonExtractor(this.client).videosFromUrl(url, `${name} - Filemoon - `, this.headers);
      case name === "SW" || host.includes("wish"):
        return new StreamWishExtractor(this.client, this.headers).videosFromUrl(url, (q) => `${name} - StreamWish - ${q}`);
      case name === "RB" || host.includes("ruby"):
        return streamRubyVideos(this.client, url, headers, `${name} - StreamRuby`);
      case name === "FL" || host.includes("vidhide"):
        return new VidHideExtractor(this.client, this.headers).videosFromUrl(url, (q) => `${name} - VidHide - ${q}`);
      case name === "DS" || host.includes("dood"):
        return new DoodExtractor(this.client).videosFromUrl(url, `${name} - DoodStream`);
      case host.includes("mp4upload"):
        return new Mp4uploadExtractor(this.client).videosFromUrl(url, this.headers, `${name} - `);
      case name === "GD": {
        const id = /\/d\/([\w-]+)/.exec(new URL(url).searchParams.get("link") ?? "")?.[1];
        return id ? new GoogleDriveExtractor(this.client, this.headers).videosFromUrl(id, `${name} - Google Drive`) : [];
      }
      // ponytail: MEGA (decrypts in the client), TeraBox, AceFile, aico.pw and the dead nanifile/uservideo are skipped
      default:
        return [];
    }
  }

  /** Direct files (KUMA, ARC) last: many are gone (archive.org items answer 403), while an extractor only returns live streams. */
  override sortVideos(videos: Video[]): Video[] {
    const rank = (v: Video) => ["KUMA", "ARC"].indexOf(v.videoTitle) + 1;
    return [...videos].sort((a, b) => rank(a) - rank(b));
  }
}
