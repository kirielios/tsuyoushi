// Port of yuzono/anime-extensions src/id/minioppai/MiniOppai.kt
import { DateTimeFormatter, GET, Locale, type Document, type Element, type FilterList, type Response, type SAnime, type SEpisode, type Video } from "../../../sdk/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";
import { MiniOppaiExtractor } from "./extractors/minioppai.ts";
import { getFilterList, getSearchParameters } from "./filters.ts";

const PLAYER_HOSTS = new Set(["paistream.my.id", "streampai.my.id"]);

export default class MiniOppai extends AnimeStream {
  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.set("Referer", this.baseUrl);
    return headers;
  }

  protected override dateFormatter = DateTimeFormatter.ofPattern("MMMM d, yyyy", new Locale("id"));

  // Popular and latest: AnimeStream's own ?page=N. The site ignores /anime/page/N/ (upstream's path) and answers page 1
  // for every N, so paging never moved on (2026-10-17).

  // ============================== Episodes ==============================
  protected override episodeFromElement(element: Element): SEpisode {
    const episode = super.episodeFromElement(element);
    const text = element.selectFirst(".epl-num")!.text();
    const num = text.slice(text.lastIndexOf(" ") + 1);
    episode.episode_number = Number.parseFloat(num) || 0;
    episode.name = /OVA/i.test(text) ? `OVA ${num}` : `Episode ${num}`;
    return episode;
  }

  // ============================ Video Links =============================
  // ponytail: gdriveplayer mirrors are not ported; every mirror on the site is streampai as of 2026-10-16.
  protected override async getVideoListFromUrl(url: string, _name: string): Promise<Video[]> {
    let host: string | null = null;
    try {
      host = new URL(url).host;
    } catch {
      return [];
    }
    return PLAYER_HOSTS.has(host) ? new MiniOppaiExtractor(this.client).videosFromUrl(url, this.headers) : [];
  }

  // =========================== Anime Details ============================
  protected override getAnimeDescription(document: Document) {
    return document.select("div.entry-content > p").eachText().join("\n");
  }

  protected override animeDetailsParse(response: Response): SAnime {
    const anime = super.animeDetailsParse(response);
    anime.title = anime.title.split("Episode")[0].split(" OVA ")[0];
    return anime;
  }

  // =============================== Search ===============================
  protected override searchAnimeRequest(page: number, query: string, filters: FilterList) {
    if (query) return GET(`${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}`, this.headers);
    const params = getSearchParameters(filters);
    const multi = params.multi.filter((s) => s.trim()).join("&");
    return GET(`${this.animeListUrl}/?page=${page}&order=${params.order}${multi ? `&${multi}` : ""}`, this.headers);
  }

  // ============================== Filters ===============================
  override getFilterList(): FilterList {
    return getFilterList();
  }
}
