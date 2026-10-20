// Port of yuzono/anime-extensions src/id/animeindo/AnimeIndo.kt
import { GET, SAnime, SEpisode, urlWithoutDomain, type Element, type FilterList, type Video } from "../../../sdk/index.ts";
import { GdrivePlayerExtractor } from "../../../libs/gdriveplayerextractor/index.ts";
import { Mp4uploadExtractor } from "../../../libs/mp4uploadextractor/index.ts";
import { OkruExtractor } from "../../../libs/okruextractor/index.ts";
import { StreamTapeExtractor } from "../../../libs/streamtapeextractor/index.ts";
import { YourUploadExtractor } from "../../../libs/youruploadextractor/index.ts";
import { AnimeStream } from "../../../themes/animestream/index.ts";

export default class AnimeIndo extends AnimeStream {
  // ============================== Filters ============================== (fetch URL)
  protected override get animeListUrl() {
    return `${this.baseUrl}/browse`;
  }

  // ============================== Popular ===============================
  protected override popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/browse?sort=view&page=${page}`, this.headers);
  }

  // =============================== Latest ===============================
  protected override latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/browse?sort=created_at&page=${page}`, this.headers);
  }

  // =============================== Search ===============================
  // ponytail: AnimeIndoFilters (order/status/type/genre/season/studio, scraped from the browse page at runtime) is not
  // ported, like the theme's fetched filters; search is by title only.
  protected override searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    const url = new URL(`${this.baseUrl}/browse`);
    url.searchParams.set("page", String(page));
    if (query.trim()) url.searchParams.set("title", query);
    return GET(url.href, this.headers);
  }

  protected override searchAnimeSelector() {
    return "div.animepost > div > a";
  }

  protected override searchAnimeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(element.attr("href"));
    anime.title = element.selectFirst("div.title")!.text();
    anime.thumbnail_url = this.imageUrlOf(element.selectFirst("img"));
    return anime;
  }

  protected override searchAnimeNextPageSelector() {
    return "div.pagination a:has(i#nextpagination)";
  }

  // =========================== Anime Details ============================
  protected override parseStatus(statusString: string | null): number {
    switch (statusString?.trim().toLowerCase()) {
      case "finished airing":
        return SAnime.COMPLETED;
      case "currently airing":
        return SAnime.ONGOING;
      default:
        return SAnime.UNKNOWN;
    }
  }

  // ============================== Episodes ==============================
  protected override episodeListSelector() {
    return "div.listeps li:has(.epsleft)";
  }

  protected override episodeFromElement(element: Element): SEpisode {
    const episode = SEpisode.create();
    const ahref = element.selectFirst("a")!;
    episode.url = urlWithoutDomain(ahref.attr("href"));
    const num = ahref.text();
    episode.name = `Episode ${num}`;
    episode.episode_number = Number.parseFloat(num.trim()) || 0;
    episode.date_upload = this.dateFormatter.tryParseDate(element.selectFirst("span.date")?.text());
    return episode;
  }

  // ============================ Video Links =============================
  protected override async getVideoListFromUrl(url: string, name: string): Promise<Video[]> {
    if (name.includes("streamtape")) {
      const video = await new StreamTapeExtractor(this.client).videoFromUrl(url);
      return video ? [video] : [];
    }
    if (name.includes("mp4")) return new Mp4uploadExtractor(this.client).videosFromUrl(url, this.headers);
    if (name.includes("yourupload")) return new YourUploadExtractor(this.client).videoFromUrl(url, this.headers);
    if (url.includes("ok.ru")) return new OkruExtractor(this.client).videosFromUrl(url);
    if (name.includes("gdrive")) {
      const gdriveUrl = url.includes(this.baseUrl) ? `https:${new URL(url).searchParams.get("data")!}` : url;
      return new GdrivePlayerExtractor(this.client).videosFromUrl(gdriveUrl, "Gdrive", this.headers);
    }
    return [];
  }
}
