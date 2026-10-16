// Port of yuzono/anime-extensions src/id/otakudesu/OtakuDesu.kt
import {
  AnimeHttpSource,
  Base64,
  DateTimeFormatter,
  Filter,
  fromUtf8,
  GET,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  parallelCatchingFlatMap,
  parseHtml,
  POST,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { BloggerExtractor } from "../../../libs/bloggerextractor/index.ts";
import { StreamWishExtractor } from "../../../libs/streamwishextractor/index.ts";
import { VidHideExtractor } from "../../../libs/vidhideextractor/index.ts";
import { YourUploadExtractor } from "../../../libs/youruploadextractor/index.ts";

const NONCE_ACTION_REGEX = /\{action:"([^"]+)"/;
const EMBED_ACTION_REGEX = /nonce:[^,]+,action:"([^"]+)"/;
const DESUSTREAM_FILE_REGEX = /(?:file|videoURL)["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/;
const NAME_REGEX = /.+?(?=Episode)|\sSubtitle.+/g;
const DATE_FORMATTER = DateTimeFormatter.ofPattern("d MMMM,yyyy", new Locale("id", "ID"));

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_DEFAULT = "1080p";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];

const GENRES: [string, string][] = [
  ["<select>", ""],
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Demons", "demons"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Game", "game"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Josei", "josei"],
  ["Magic", "magic"],
  ["Martial Arts", "martial-arts"],
  ["Mecha", "mecha"],
  ["Military", "military"],
  ["Music", "music"],
  ["Mystery", "mystery"],
  ["Psychological", "psychological"],
  ["Parody", "parody"],
  ["Police", "police"],
  ["Romance", "romance"],
  ["Samurai", "samurai"],
  ["School", "school"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shoujo Ai", "shoujo-ai"],
  ["Shounen", "shounen"],
  ["Slice of Life", "slice-of-life"],
  ["Sports", "sports"],
  ["Space", "space"],
  ["Super Power", "super-power"],
  ["Supernatural", "supernatural"],
  ["Thriller", "thriller"],
  ["Vampire", "vampire"],
];

class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genres", GENRES.map((g) => g[0]));
  }
  toUriPart() {
    return GENRES[this.state][1];
  }
}

const b64Decode = (s: string) => fromUtf8(Base64.decode(s));

export default class OtakuDesu extends AnimeHttpSource {
  // --- details
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const info = document.selectFirst("div.infozingle")!;
    const anime = SAnime.create();
    anime.title = getInfo(info, "Judul") ?? "";
    anime.genre = getInfo(info, "Genre") ?? undefined;
    const status = getInfo(info, "Status");
    anime.status = status === "Ongoing" ? SAnime.ONGOING : status === "Completed" ? SAnime.COMPLETED : SAnime.UNKNOWN;
    anime.artist = getInfo(info, "Studio") ?? undefined;
    anime.author = getInfo(info, "Produser") ?? undefined;
    let description = "";
    for (const label of ["Japanese", "Skor", "Total Episode"]) {
      const v = getInfo(info, label, false);
      if (v) description += `${v}\n`;
    }
    description += "\n\nSynopsis:\n";
    for (const p of document.select("div.sinopc > p").eachText()) description += `${p}\n\n`;
    anime.description = description;
    return anime;
  }

  // --- episodes
  protected episodeListParse(response: Response): SEpisode[] {
    return response
      .asJsoup()
      .select("#venkonten > div.venser > div:nth-child(8) > ul > li")
      .map((element) => {
        const link = element.selectFirst("span > a")!;
        const text = link.text();
        const ep = SEpisode.create();
        ep.episode_number = Number.parseFloat(text.split("Episode ")[1]?.split(" ")[0] ?? "") || 1;
        ep.url = urlWithoutDomain(link.attr("href"));
        ep.name = text.replace(NAME_REGEX, "");
        ep.date_upload = DATE_FORMATTER.tryParseDate(element.selectFirst("span.zeebr")?.text());
        return ep;
      });
  }

  // --- catalogue
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/ongoing-anime/page/${page}`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    const document = response.asJsoup();
    return new MangasPage(document.select("div.detpost div.thumb > a").map(latestFromElement), document.selectFirst("a.next.page-numbers") != null);
  }
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/complete-anime/page/${page}`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    return this.latestUpdatesAnimeParse(response);
  }

  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const genre = (filters.length ? filters : this.getFilterList()).find((f) => f instanceof GenreFilter) as GenreFilter | undefined;
    if (query.trim()) return GET(`${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=anime`, this.headers);
    if (genre && genre.state !== 0) return GET(`${this.baseUrl}/genres/${genre.toUriPart()}/page/${page}`, this.headers);
    return GET(`${this.baseUrl}/complete-anime/page/${page}`, this.headers);
  }

  protected searchAnimeParse(response: Response) {
    const document = response.asJsoup();
    const searchSelector = "#venkonten > div > div.venser > div > div > ul > li";
    let animes: SAnime[];
    if (document.selectFirst(".col-anime") == null) {
      animes = document.select(searchSelector).map((element) => {
        const link = element.selectFirst("h2 > a")!;
        const anime = SAnime.create();
        anime.url = urlWithoutDomain(link.attr("href"));
        anime.title = link.text().replace(" Subtitle Indonesia", "");
        anime.thumbnail_url = element.selectFirst("img")!.attr("src");
        return anime;
      });
    } else if (document.selectFirst(searchSelector) == null) {
      animes = document.select(".col-anime").map((element) => {
        const link = element.selectFirst(".col-anime-title > a")!;
        const anime = SAnime.create();
        anime.url = urlWithoutDomain(link.attr("href"));
        anime.title = link.text();
        anime.thumbnail_url = element.selectFirst(".col-anime-cover > img")!.attr("src");
        return anime;
      });
    } else {
      animes = document.select("div.detpost div.thumb > a").map(latestFromElement);
    }
    return new MangasPage(animes, document.selectFirst("a.next.page-numbers") != null);
  }

  // --- videos
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const doc = (await this.client.get(hoster.hosterUrl, this.headers)).asJsoup();
    const script = doc.select("script").map((s) => s.data()).find((s) => s.includes("admin-ajax") && s.includes("__x__nonce"));
    if (!script) throw new Error("No mirror script found");
    const nonceAction = NONCE_ACTION_REGEX.exec(script)![1];
    const action = EMBED_ACTION_REGEX.exec(script)![1];
    const nonce = await this.ajax(new URLSearchParams({ action: nonceAction }));

    const embeds = (
      await Promise.all(
        doc.select("div.mirrorstream ul li > a").map((el) => this.getEmbedLink(el, action, nonce).catch(() => null)),
      )
    ).filter((e): e is [string, string] => e != null);
    return parallelCatchingFlatMap(embeds, ([quality, link]) => this.getVideosFromEmbed(quality, link));
  }

  private async ajax(form: URLSearchParams): Promise<string> {
    const body = (await this.client.execute(POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.headers, form), true)).text();
    return (JSON.parse(body) as { data: string }).data;
  }

  private async getEmbedLink(element: Element, action: string, nonce: string): Promise<[string, string]> {
    const { id, i, q } = JSON.parse(b64Decode(element.attr("data-content"))) as { id: number; i: number; q: string };
    const html = b64Decode(await this.ajax(new URLSearchParams({ id: String(id), i: String(i), q, nonce, action })));
    return [q, parseHtml(this.host.load, html, this.baseUrl).selectFirst("iframe")!.attr("src")];
  }

  private async getVideosFromEmbed(quality: string, link: string): Promise<Video[]> {
    if (link.includes("filelions")) return new StreamWishExtractor(this.client, this.headers).videosFromUrl(link, (q) => `FileLions - ${q}`);
    if (link.includes("yourupload")) {
      const id = (link.split("id=")[1] ?? link).split("&")[0];
      return new YourUploadExtractor(this.client).videoFromUrl(`https://yourupload.com/embed/${id}`, this.headers, `YourUpload - ${quality}`);
    }
    if (link.includes("desustream")) {
      const doc = (await this.client.get(link, this.headers)).asJsoup();
      const videoUrl =
        doc.selectFirst("video source[src~=.], video[src~=.]")?.absUrl("src") ||
        DESUSTREAM_FILE_REGEX.exec(doc.select("script").map((s) => s.data()).join("\n"))?.[1];
      return videoUrl ? [new Video({ videoUrl, videoTitle: `DesuStream - ${quality}`, headers: this.headers })] : [];
    }
    if (link.includes("blogger.com") || link.includes("video.g?token=")) return new BloggerExtractor(this.client).videosFromUrl(link, this.headers, ` - ${quality}`);
    if (link.includes("mp4upload")) {
      const doc = (await this.client.get(link, this.headers)).asJsoup();
      const script = doc.selectFirst("script:containsData(player.src)")!.data();
      const videoUrl = script.split('src: "')[1].split('"')[0];
      return [new Video({ videoUrl, videoTitle: `Mp4upload - ${quality}`, headers: this.headers })];
    }
    if (link.includes("vidhide")) return new VidHideExtractor(this.client, this.headers).videosFromUrl(link);
    return [];
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT) ?? PREF_QUALITY_DEFAULT;
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)));
  }

  // --- filters and settings
  override getFilterList(): FilterList {
    return [new Filter.Header("Text search ignores filters"), new GenreFilter()];
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = PREF_QUALITY_KEY;
    pref.title = "Preferred quality";
    pref.entries = PREF_QUALITY_ENTRIES;
    pref.entryValues = PREF_QUALITY_ENTRIES;
    pref.setDefaultValue(PREF_QUALITY_DEFAULT);
    pref.summary = "%s";
    screen.addPreference(pref);
  }
}

function latestFromElement(element: Element): SAnime {
  const anime = SAnime.create();
  anime.url = urlWithoutDomain(element.attr("href"));
  anime.thumbnail_url = element.selectFirst("img")!.attr("src");
  anime.title = element.selectFirst("h2")!.text();
  return anime;
}

function getInfo(info: Element, label: string, cut = true): string | null {
  const text = info.selectFirst(`p > span:has(b:contains(${label}))`)?.text();
  if (text == null) return null;
  return (cut ? text.slice(text.indexOf(":") + 1) : text).trim();
}
