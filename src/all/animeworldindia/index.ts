// Port of yuzono/anime-extensions src/all/animeworldindia/AnimeWorldIndia.kt (and AnimeWorldIndiaFactory.kt: one source per lang)
import {
  AnimeHttpSource,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  SAnime,
  SEpisode,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type Document,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { getFilterList, getSearchParams } from "./filters.ts";
import { MyStreamExtractor } from "./mystream.ts";

/** AnimeWorldIndiaFactory: the site's language for each source lang ("all" is every language). */
const LANGUAGES: Record<string, string> = { all: "", bn: "bengali", en: "english", hi: "hindi", ja: "japanese", ml: "malayalam", mr: "marathi", ta: "tamil", te: "telugu" };

type SeasonDto = { episodes: { all: { id: number; metadata: { number: string; title: string; released?: string | null } }[] } };
type PlayerDto = { type: string; url: string; language: string; server: string };

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_TITLE = "Preferred quality";
const PREF_QUALITY_DEFAULT = "1080";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p", "240p"];
const PREF_QUALITY_VALUES = ["1080", "720", "480", "360", "240"];

export default class AnimeWorldIndia extends AnimeHttpSource {
  private get language() {
    return LANGUAGES[this.lang] ?? "";
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/advanced-search/page/${page}/?s_lang=${this.lang}&s_orderby=viewed`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    return this.searchAnimeParse(response);
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.baseUrl}/advanced-search/page/${page}/?s_lang=${this.lang}&s_orderby=update`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.searchAnimeParse(response);
  }

  // =============================== Search ===============================
  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const searchParams = getSearchParams(filters);
    return GET(`${this.baseUrl}/advanced-search/page/${page}/?s_keyword=${encodeURIComponent(query)}&s_lang=${this.lang}${searchParams}`, this.headers);
  }

  protected searchAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const animes = document.select("div.col-span-1").map((e) => this.searchAnimeFromElement(e));
    return new MangasPage(animes, document.selectFirst("ul.page-numbers li:has(span.current) + li") != null);
  }

  private searchAnimeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
    anime.thumbnail_url = element.selectFirst("img")!.attr("abs:src");
    anime.title = element.selectFirst("div.font-medium.line-clamp-2.mb-3")!.text();
    return anime;
  }

  override getFilterList(): FilterList {
    return getFilterList();
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.title = document.selectFirst("h2.text-4xl")!.text();
    anime.genre = document.select("span.leading-6 a[class~=border-opacity-30]").eachText().join(", ");
    anime.description = document.selectFirst("div[data-synopsis]")?.text();
    anime.author = document.selectFirst('span.leading-6 a[href*="producer"]:first-child')?.text();
    anime.artist = document.selectFirst('span.leading-6 a[href*="studio"]:first-child')?.text();
    anime.status = this.parseStatus(document);
    return anime;
  }

  private readonly selector = "ul li:has(div.w-1.h-1.bg-gray-500.rounded-full) + li";

  private parseStatus(document: Document): number {
    const type = document.selectFirst(`${this.selector} a:not(:contains(Ep))`)?.text();
    if (type == null) return SAnime.UNKNOWN;
    if (type === "Movie") return SAnime.COMPLETED;
    const epParts = document.selectFirst(`${this.selector} a:not(:contains(TV))`)?.text().slice(3).split("/");
    if (!epParts || epParts.length < 2) return SAnime.UNKNOWN;
    return epParts[0].trim() === epParts[1].trim() ? SAnime.COMPLETED : SAnime.ONGOING;
  }

  // ============================== Episodes ==============================
  protected episodeListParse(response: Response): SEpisode[] {
    const document = response.asJsoup();
    const isMovie = document.selectFirst('nav li > a[href*="type/movies/"]') != null;
    const seasonsJson = JSON.parse(substringBefore(substringAfter(document.html(), "var season_list = "), "var season_label =").trim().slice(0, -1)) as SeasonDto[];

    let episodeNumberFallback = 1;
    const isSingleSeason = seasonsJson.length === 1;
    return seasonsJson
      .flatMap((season, seasonNumber) => {
        const seasonName = isSingleSeason ? "" : `Season ${seasonNumber + 1}`;
        return [...season.episodes.all].reverse().map((episode) => {
          const episodeTitle = episode.metadata.title;
          const parsed = /^-?\d+$/.test(episode.metadata.number) ? Number(episode.metadata.number) : null;
          const epNum = parsed ?? Math.trunc(episodeNumberFallback);
          let episodeName = "Movie";
          if (!isMovie) {
            episodeName = "";
            if (seasonName.trim()) episodeName += `${seasonName} - `;
            episodeName += `Episode ${epNum}`;
            if (episodeTitle.trim()) episodeName += ` - ${episodeTitle}`;
          }
          const ep = SEpisode.create();
          ep.name = episodeName;
          ep.episode_number = isSingleSeason ? epNum : episodeNumberFallback;
          episodeNumberFallback++;
          ep.url = `/wp-json/kiranime/v1/episode?id=${episode.id}`;
          const released = Number(episode.metadata.released ?? "");
          ep.date_upload = episode.metadata.released && Number.isFinite(released) ? released * 1000 : 0;
          return ep;
        });
      })
      .sort((a, b) => b.episode_number - a.episode_number);
  }

  // ============================ Video Links =============================
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  protected override async videoListParse(response: Response): Promise<Video[]> {
    const body = response.text();
    const documentTrimmed = substringBefore(body.slice(body.lastIndexOf('"players":') + '"players":'.length), ',"noplayer":').trim();
    const streams = (JSON.parse(documentTrimmed) as PlayerDto[]).filter((it) => it.type === "stream" && it.url.trim());
    if (!streams.length) throw new Error("No streams available!");
    const playersList = streams.filter((it) => !this.language || it.language === this.language);
    if (!playersList.length) throw new Error("No videos for your language!");

    const mystreamExtractor = new MyStreamExtractor(this.client, this.headers);
    const videos: Video[] = [];
    for (const it of playersList) if (it.server === "Mystream") videos.push(...(await mystreamExtractor.videosFromUrl(it.url, it.language)));
    return videos;
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT) ?? PREF_QUALITY_DEFAULT;
    const has = (v: Video) => (v.videoTitle.includes(quality) ? 1 : 0);
    return [...videos].reverse().sort((a, b) => has(b) - has(a));
  }

  // ============================ Preferences =============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new ListPreference(screen.context);
    p.key = PREF_QUALITY_KEY;
    p.title = PREF_QUALITY_TITLE;
    p.entries = PREF_QUALITY_ENTRIES;
    p.entryValues = PREF_QUALITY_VALUES;
    p.setDefaultValue(PREF_QUALITY_DEFAULT);
    p.summary = "%s";
    screen.addPreference(p);
  }
}
