// Port of yuzono/anime-extensions src/id/kuramanime/Kuramanime.kt
import {
  AnimeHttpSource,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  parallelCatchingFlatMap,
  parseHtml,
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
import { FilemoonExtractor } from "../../../libs/filemoonextractor/index.ts";
import { StreamTapeExtractor } from "../../../libs/streamtapeextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VidGuardExtractor } from "../../../libs/vidguardextractor/index.ts";

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_TITLE = "Preferred quality";
const PREF_QUALITY_DEFAULT = "1080p";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];

// Shall we add "archive", "archive-v2"? archive.org usually returns a beautiful 403 xD
const SUPPORTED_HOSTERS = ["kuramadrive", "kuramadrive-v2", "filelions", "filemoon", "mega", "streamwish", "streamtape", "vidguard"];

type ScriptData = { authPath: string; tokenId: string; tokenParam: string; serverParam: string };

export default class Kuramanime extends AnimeHttpSource {
  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/anime?page=${page}`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    const document = response.asJsoup();
    const animes = document.select("div.filter__gallery > a").map((e) => this.popularAnimeFromElement(e));
    return new MangasPage(animes, document.selectFirst("div.product__pagination > a:last-child:not([aria-disabled='true'])") != null);
  }

  private popularAnimeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(element.attr("href"));
    anime.thumbnail_url = element.selectFirst("div.set-bg")?.attr("data-setbg");
    anime.title = element.selectFirst("div > h5")!.text();
    return anime;
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/anime?order_by=updated&page=${page}`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =============================== Search ===============================
  protected searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    return GET(`${this.baseUrl}/anime?search=${encodeURIComponent(query)}&page=${page}`, this.headers);
  }
  protected searchAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.thumbnail_url = document.selectFirst("div.anime__details__pic")?.attr("data-setbg");
    const details = document.selectFirst("div.anime__details__text")!;
    anime.title = details.selectFirst("div > h3")!.text().replace("Judul: ", "");

    const infos = details.selectFirst("div.anime__details__widget")!;
    // upstream's "li:contains(X) > a": the links now sit inside div.row > div.col-9 (2026-10-20).
    anime.artist = infos.select("li:contains(Studio:) a").eachText().join(", ") || undefined;
    anime.status = parseStatus(infos.selectFirst("li:contains(Status:) a")?.text());
    anime.genre =
      infos
        .select("li:contains(Genre:) a, li:contains(Tema:) a, li:contains(Demografis:) a")
        .eachText()
        .map((it) => it.replace(/[, ]+$/, ""))
        .join(", ") || undefined;

    let description = details.selectFirst("p#synopsisField")?.text() ?? "";
    const alt = details.selectFirst("div.anime__details__title > span")?.text();
    if (alt != null) description += `\n\nAlternative names: ${alt}\n`;
    for (const it of infos.select("ul > li").eachText()) description += `\n${it}`;
    anime.description = description;
    return anime;
  }

  // ============================== Episodes ==============================
  protected episodeListParse(response: Response): SEpisode[] {
    const document = response.asJsoup();
    const html = document.selectFirst("a#episodeLists")?.attr("data-content");
    if (html == null) return [];
    const newDoc = parseHtml(this.host.load, html, this.baseUrl);
    const limits = newDoc.select("a.btn-secondary");

    if (!limits.length) {
      // 12 episodes or less
      return newDoc
        .select("a")
        .filter((it) => !it.attr("href").includes("batch"))
        .map((it) => this.episodeFromElement(it))
        .reverse();
    }
    // More than 12 episodes
    const [start, end] = limits
      .eachText()
      .slice(0, 2)
      .map((it) => Number.parseInt(it.replace(/\D/g, ""), 10));
    const location = document.location();
    const episodes: SEpisode[] = [];
    for (let episodeNumber = end; episodeNumber >= start; episodeNumber--) {
      const episode = SEpisode.create();
      episode.name = `Ep ${episodeNumber}`;
      episode.episode_number = episodeNumber;
      episode.url = urlWithoutDomain(`${location}/episode/${episodeNumber}`);
      episodes.push(episode);
    }
    return episodes;
  }

  private episodeFromElement(element: Element): SEpisode {
    const episode = SEpisode.create();
    episode.url = urlWithoutDomain(element.attr("href"));
    episode.name = element.text();
    episode.episode_number = Number.parseFloat(episode.name.replace(/\D/g, "")) || 1;
    return episode;
  }

  // ============================ Video Links =============================
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  protected override async videoListParse(response: Response): Promise<Video[]> {
    const doc = response.asJsoup();
    // The script name moved from data-kps to data-kk (window.init_process.env.MIX_JS_ROUTE_PARAM_ATTR, 2026-10-20).
    const origin = new URL(response.url).origin;
    const kps = doc.selectFirst("[data-kps]")?.attr("data-kps") || doc.selectFirst("[data-kk]")?.attr("data-kk");
    const scriptData = kps ? await this.getScriptData(origin, kps) : null;
    if (!scriptData) return [];

    // upstream reads the attribute "csrf-token" (always empty, so it never got this far); the token is in content.
    const csrfToken = doc.selectFirst("meta[name=csrf-token]")?.attr("content");
    if (!csrfToken) return [];

    const servers = doc
      .select("select#changeServer > option")
      .map((it) => [it.attr("value"), it.text().split(" (")[0]] as const)
      .filter(([server]) => SUPPORTED_HOSTERS.includes(server));

    const episodeUrl = response.url;
    const headers = this.headersBuilder();
    headers.set("Referer", episodeUrl);
    headers.set("X-Requested-With", "XMLHttpRequest");

    return parallelCatchingFlatMap(servers, async ([server, serverName]) => {
      const newHeaders = new Headers(headers);
      newHeaders.set("X-CSRF-TOKEN", csrfToken);
      newHeaders.set("X-Fuck-ID", scriptData.tokenId);
      newHeaders.set("X-Request-ID", getRandomString());
      newHeaders.set("X-Request-Index", "0");

      // origin, not baseUrl: the site redirects to a new vN domain, and the hash is tied to that domain's session cookie.
      const hash = (await this.executeSuccess(GET(`${origin}/${scriptData.authPath}`, newHeaders))).text().replace(/^"+|"+$/g, "");

      const newUrl = new URL(episodeUrl);
      newUrl.searchParams.append(scriptData.tokenParam, hash);
      newUrl.searchParams.append(scriptData.serverParam, server);

      // ponytail: the site now loads the player with jLoadSecure (from the obfuscated /storage/leviathan.js), a POST
      // carrying an "authorization" value built inside that script; without it this page has no player, so every
      // server gives no videos (2026-10-20). Needs a decision on how to obtain that value.
      const playerDoc: Document = (await this.executeSuccess(GET(newUrl.href, headers))).asJsoup();
      const url = playerDoc.selectFirst("div.video-content iframe")?.attr("src") || null;
      if (url != null) {
        switch (server) {
          case "filelions":
          case "streamwish":
            return new StreamWishExtractor(this.client, this.headers).videosFromUrl(url);
          case "filemoon":
            return new FilemoonExtractor(this.client).videosFromUrl(url);
          // mega.nz source
          case "streamtape":
            return new StreamTapeExtractor(this.client).videosFromUrl(url);
          case "vidguard":
            return new VidGuardExtractor(this.client).videosFromUrl(url);
        }
      }
      return playerDoc.select("video#player > source").map((it) => {
        const src = it.attr("src");
        return new Video({ videoUrl: src, videoTitle: `${it.attr("size")}p - ${serverName}` });
      });
    });
  }

  private async getScriptData(origin: string, scriptName: string): Promise<ScriptData | null> {
    try {
      const response = (await this.client.get(`${origin}/assets/js/${scriptName}.js`, this.headers)).text();
      // Extract the data from the window.process assignment
      const envMatch = /window\.process\s*=\s*\{[\s\S]*?env:\s*\{([\s\S]*?)\}[\s\S]*?\}/.exec(response);
      if (!envMatch) return null;
      // Parse each environment variable
      const envVars: Record<string, string> = {};
      for (const m of envMatch[1].matchAll(/(\w+):\s*['"]([^'"]+)['"]/g)) envVars[m[1]] = m[2];
      const env = (k: string) => envVars[k] ?? "";
      return {
        authPath: env("MIX_PREFIX_AUTH_ROUTE_PARAM") + env("MIX_AUTH_ROUTE_PARAM"),
        tokenId: `${env("MIX_AUTH_KEY")}:${env("MIX_AUTH_TOKEN")}`,
        tokenParam: env("MIX_PAGE_TOKEN_KEY"),
        serverParam: env("MIX_STREAM_SERVER_KEY"),
      };
    } catch {
      return null;
    }
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT)!;
    // sortedWith(compareBy { contains(quality) }).reversed(): the preferred ones first, the rest reversed.
    return [...videos].sort((a, b) => Number(a.videoTitle.includes(quality)) - Number(b.videoTitle.includes(quality))).reverse();
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY_KEY;
    pref.title = PREF_QUALITY_TITLE;
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_ENTRIES;
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    pref.summary = "%s";
    screen.addPreference(pref);
  }
}

function parseStatus(statusString: string | undefined): number {
  if (statusString === "Sedang Tayang") return SAnime.ONGOING;
  if (statusString === "Selesai Tayang") return SAnime.COMPLETED;
  return SAnime.UNKNOWN;
}

function getRandomString(length = 8): string {
  const allowedChars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => allowedChars[Math.floor(Math.random() * allowedChars.length)]).join("");
}
