// Port of yuzono/anime-extensions src/en/hstream/Hstream.kt and HstreamFilters.kt
import {
  AnimeHttpSource,
  Filter,
  FilterList,
  GET,
  ListPreference,
  MangasPage,
  POST,
  SAnime,
  SEpisode,
  Track,
  urlWithoutDomain,
  Video,
  type Element,
  type Hoster,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";

const EPISODE_PARSER = /\s*(?:[-–—]\s*|\bEpisode\s*)\d+(?:\.\d+)?\s*$/i;
const PREFIX_SEARCH = "id:";

const PREF_QUALITY_KEY = "pref_quality_key";
const PREF_QUALITY_TITLE = "Preferred quality";
const PREF_QUALITY_DEFAULT = "720p";
const PREF_QUALITY_ENTRIES = ["720p (HD)", "1080p (FULLHD)", "2160p (4K)"];
const PREF_QUALITY_VALUES = ["720p", "1080p", "2160p"];

interface PlayerApiResponse {
  legacy?: number;
  resolution?: string;
  stream_url: string;
  stream_domains: string[];
}

// ============================== Filters ===============================
class QueryPartFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => it[0]),
    );
  }
  toQueryPart() {
    return this.vals[this.state][1];
  }
}
class GenresFilter extends Filter.Group<Filter.TriState> {
  constructor() {
    super(
      "Genres",
      GENRES.map((it) => new Filter.TriState(it[0])),
    );
  }
}
class StudiosFilter extends Filter.Group<Filter.CheckBox> {
  constructor() {
    super(
      "Studios",
      STUDIOS.map((it) => new Filter.CheckBox(it[0])),
    );
  }
}
class OrderFilter extends QueryPartFilter {
  constructor() {
    super("Order by", ORDERS);
  }
}

function getSearchParameters(filters: FilterList) {
  const lookup = (options: [string, string][], name: string) =>
    options.find((it) => it[0] === name)![1];
  const genres =
    filters.find((f): f is GenresFilter => f instanceof GenresFilter)?.state ??
    [];
  const studios =
    filters.find((f): f is StudiosFilter => f instanceof StudiosFilter)
      ?.state ?? [];
  const order = filters.find((f): f is OrderFilter => f instanceof OrderFilter);
  return {
    genres: genres
      .filter((g) => g.isIncluded())
      .map((g) => lookup(GENRES, g.name)),
    blacklisted: genres
      .filter((g) => g.isExcluded())
      .map((g) => lookup(GENRES, g.name)),
    studios: studios.filter((s) => s.state).map((s) => lookup(STUDIOS, s.name)),
    order: order?.toQueryPart() ?? "view-count",
  };
}

export default class Hstream extends AnimeHttpSource {
  override get supportsLatest() {
    return true;
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(
      `${this.baseUrl}/search?order=view-count&page=${page}`,
      this.headers,
    );
  }

  /** popularAnimeSelector + popularAnimeFromElement + the distinctBy override, shared by popular, latest and search. */
  protected popularAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const seen = new Set<string>();
    const animes = document
      .select("div.items-center div.w-full > a")
      .map(popularAnimeFromElement)
      .filter((a) => !seen.has(a.url) && seen.add(a.url));
    return new MangasPage(
      animes,
      document.selectFirst("span[aria-current] + a") != null,
    );
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(
      `${this.baseUrl}/search?order=recently-uploaded&page=${page}`,
      this.headers,
    );
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =============================== Search ===============================
  override getFilterList(): FilterList {
    return FilterList(
      new OrderFilter(),
      new GenresFilter(),
      new StudiosFilter(),
    );
  }

  override async getSearchAnime(
    page: number,
    query: string,
    filters: FilterList,
  ): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      if (url.host !== new URL(this.baseUrl).host)
        throw new Error("Unsupported url");
      const id = url.pathname.split("/").filter(Boolean)[1];
      if (!id) throw new Error("Unsupported url");
      return this.getSearchAnime(page, `${PREFIX_SEARCH}${id}`, filters);
    }
    if (query.startsWith(PREFIX_SEARCH)) {
      const id = query.slice(PREFIX_SEARCH.length);
      const response = await this.executeSuccess(
        GET(`${this.baseUrl}/hentai/${id}`, this.headers),
      );
      const details = this.animeDetailsParse(response);
      details.url = urlWithoutDomain(response.url);
      details.initialized = true;
      return new MangasPage([details], false);
    }
    return super.getSearchAnime(page, query, filters);
  }

  protected searchAnimeRequest(
    page: number,
    query: string,
    filters: FilterList,
  ) {
    const params = getSearchParameters(filters);
    const url = new URL(`${this.baseUrl}/search`);
    if (query.trim()) url.searchParams.append("search", query);
    url.searchParams.append("page", String(page));
    url.searchParams.append("order", params.order);
    params.genres.forEach((genre, index) =>
      url.searchParams.append(`tags[${index}]`, genre),
    );
    params.blacklisted.forEach((it) =>
      url.searchParams.append("blacklist[]", it),
    );
    params.studios.forEach((it) => url.searchParams.append("studios[]", it));
    return GET(url, this.headers);
  }
  protected searchAnimeParse(response: Response) {
    return this.popularAnimeParse(response);
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.status = SAnime.COMPLETED;
    const mainContent = document.selectFirst("div.flex-1")!;
    anime.title =
      mainContent.selectFirst("h1 span")?.text() ??
      mainContent.selectFirst("h1")!.text();
    anime.author = mainContent.selectFirst("div.mt-4.flex.flex-wrap a")?.text();
    anime.thumbnail_url = document
      .selectFirst("div.hidden.shrink-0.md\\:block img")
      ?.absUrl("src");
    anime.genre = document
      .select("h2:contains(Genres) + div a")
      .map((e) => e.text())
      .join(", ");
    anime.description =
      document.selectFirst("h2:contains(Description) + p")?.text() ??
      document.selectFirst("div.border-t p.leading-relaxed")?.text();
    return anime;
  }

  // ============================== Episodes ==============================
  protected episodeListParse(response: Response): SEpisode[] {
    const doc = response.asJsoup();
    const showPath = new URL(response.url).pathname.replace(/\/+$/, "");

    const dateText =
      doc
        .selectFirst(
          "div.mt-4.flex.flex-wrap.items-center.gap-2.text-sm > div:has(i.fa-upload)",
        )
        ?.text() ?? "";
    const parsed = /\d{4}-\d{2}-\d{2}/.exec(dateText);
    const uploadDate = parsed ? Date.parse(`${parsed[0]}T00:00:00`) || 0 : 0;

    const seen = new Set<string>();
    return doc
      .select(`a[href*='${showPath}-']`)
      .flatMap((element) => {
        const href = element.attr("href");
        const path = new URL(element.absUrl("href")).pathname.replace(
          /\/+$/,
          "",
        );
        if (!path.startsWith(`${showPath}-`)) return [];
        const numStr = path.slice(showPath.length + 1);
        const num = Number(numStr);
        if (!numStr || Number.isNaN(num)) return [];
        const ep = SEpisode.create();
        ep.url = urlWithoutDomain(element.absUrl("href")) || href;
        ep.episode_number = num;
        ep.name = `Episode ${numStr}`;
        ep.date_upload = uploadDate;
        return [ep];
      })
      .filter((e) => !seen.has(e.url) && seen.add(e.url))
      .sort((a, b) => b.episode_number - a.episode_number);
  }

  // ============================ Video Links =============================
  protected override async videoListParse(
    response: Response,
    _hoster: Hoster,
  ): Promise<Video[]> {
    const doc = response.asJsoup();

    const token = this.client.cookieJar
      .loadForRequest(response.url)
      .find((c) => c.name.toLowerCase() === "xsrf-token");
    if (!token) throw new Error("No XSRF-TOKEN cookie");
    const episodeId = doc.selectFirst("input#e_id")!.attr("value");

    const newHeaders = this.headers;
    newHeaders.set("Referer", doc.location());
    newHeaders.set("Origin", this.baseUrl);
    newHeaders.set("X-Requested-With", "XMLHttpRequest");
    newHeaders.set("X-XSRF-TOKEN", decodeURIComponent(token.value));

    const body = JSON.stringify({ episode_id: episodeId });
    const data = (
      await this.executeSuccess(
        POST(
          `${this.baseUrl}/player/api`,
          newHeaders,
          body,
          "application/json; charset=utf-8",
        ),
      )
    ).parseAs<PlayerApiResponse>();

    const urlBase = `${data.stream_domains[Math.floor(Math.random() * data.stream_domains.length)]}/${data.stream_url}`;
    const subtitleList = [new Track(`${urlBase}/eng.ass`, "English")];

    const resolutions = [
      "720",
      "1080",
      ...((data.resolution ?? "4k") === "4k" ? ["2160"] : []),
    ];

    // Determine if we need to force legacy mode based on manifest inspection to handle html video chunks
    let forceLegacy = (data.legacy ?? 0) !== 0;
    if (!forceLegacy) {
      try {
        const manifestString = (
          await this.client.execute(
            GET(`${urlBase}/720/manifest.mpd`, this.headers),
          )
        ).text();
        if (manifestString.includes(".html")) forceLegacy = true;
      } catch {
        /* keep DASH */
      }
    }

    return resolutions.map((resolution) => {
      const url = urlBase + getVideoUrlPath(forceLegacy, resolution);
      return new Video({
        videoUrl: url,
        videoTitle: `${resolution}p${forceLegacy ? " (Legacy)" : ""}`,
        subtitleTracks: subtitleList,
      });
    });
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new ListPreference(screen.context);
    p.key = PREF_QUALITY_KEY;
    p.title = PREF_QUALITY_TITLE;
    p.entries = PREF_QUALITY_ENTRIES;
    p.entryValues = PREF_QUALITY_VALUES;
    p.setDefaultValue(PREF_QUALITY_DEFAULT);
    p.summary = "%s";
    screen.addPreference(p);
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(
      PREF_QUALITY_KEY,
      PREF_QUALITY_DEFAULT,
    )!;
    // compareBy { contains(quality) }.reversed(): the preferred quality first, the rest in reverse order
    return [...videos]
      .reverse()
      .sort(
        (a, b) =>
          Number(b.videoTitle.includes(quality)) -
          Number(a.videoTitle.includes(quality)),
      );
  }
}

function popularAnimeFromElement(element: Element): SAnime {
  const anime = SAnime.create();
  const href = element.attr("href").replace(/\/+$/, "");
  const showUrl = `${href.slice(0, Math.max(href.lastIndexOf("-"), 0)) || href}/`;
  const epNum = href.slice(href.lastIndexOf("-") + 1);
  anime.url = urlWithoutDomain(showUrl);

  const imgElement = element.selectFirst("img")!;
  anime.title = imgElement.attr("alt").replace(EPISODE_PARSER, "").trim();

  const src = imgElement.absUrl("src");
  anime.thumbnail_url = `${src.slice(0, src.lastIndexOf("/"))}/cover-ep-${epNum}.webp`;
  return anime;
}

function getVideoUrlPath(isLegacy: boolean, resolution: string): string {
  if (isLegacy)
    return resolution === "720" ? "/x264.720p.mp4" : `/av1.${resolution}.webm`;
  return `/${resolution}/manifest.mpd`;
}

const GENRES: [string, string][] = [
  ["3D", "3d"],
  ["4K", "4k"],
  ["Ahegao", "ahegao"],
  ["Anal", "anal"],
  ["Bdsm", "bdsm"],
  ["Big Boobs", "big-boobs"],
  ["Blow Job", "blow-job"],
  ["Bondage", "bondage"],
  ["Boob Job", "boob-job"],
  ["Censored", "censored"],
  ["Comedy", "comedy"],
  ["Cosplay", "cosplay"],
  ["Creampie", "creampie"],
  ["Dark Skin", "dark-skin"],
  ["Elf", "elf"],
  ["Facial", "facial"],
  ["Fantasy", "fantasy"],
  ["Filmed", "filmed"],
  ["Foot Job", "foot-job"],
  ["Futanari", "futanari"],
  ["Gangbang", "gangbang"],
  ["Glasses", "glasses"],
  ["Hand Job", "hand-job"],
  ["Harem", "harem"],
  ["Horror", "horror"],
  ["Incest", "incest"],
  ["Inflation", "inflation"],
  ["Lactation", "lactation"],
  ["Loli", "loli"],
  ["Maid", "maid"],
  ["Masturbation", "masturbation"],
  ["Milf", "milf"],
  ["Mind Break", "mind-break"],
  ["Mind Control", "mind-control"],
  ["Monster", "monster"],
  ["Nekomimi", "nekomimi"],
  ["Ntr", "ntr"],
  ["Nurse", "nurse"],
  ["Orgy", "orgy"],
  ["Pov", "pov"],
  ["Pregnant", "pregnant"],
  ["Public Sex", "public-sex"],
  ["Rape", "rape"],
  ["Reverse Rape", "reverse-rape"],
  ["Rimjob", "rimjob"],
  ["Scat", "scat"],
  ["School Girl", "school-girl"],
  ["Shota", "shota"],
  ["Small Boobs", "small-boobs"],
  ["Succubus", "succubus"],
  ["Swim Suit", "swim-suit"],
  ["Teacher", "teacher"],
  ["Tentacle", "tentacle"],
  ["Threesome", "threesome"],
  ["Toys", "toys"],
  ["Trap", "trap"],
  ["Tsundere", "tsundere"],
  ["Ugly Bastard", "ugly-bastard"],
  ["Uncensored", "uncensored"],
  ["Vanilla", "vanilla"],
  ["Virgin", "virgin"],
  ["X-Ray", "x-ray"],
  ["Yuri", "yuri"],
];

const STUDIOS: [string, string][] = [
  ["BOMB! CUTE! BOMB!", "bomb-cute-bomb"],
  ["BreakBottle", "breakbottle"],
  ["ChiChinoya", "chichinoya"],
  ["ChuChu", "chuchu"],
  ["Circle Tribute", "circle-tribute"],
  ["Collaboration Works", "collaboration-works"],
  ["Digital Works", "digital-works"],
  ["Discovery", "discovery"],
  ["Edge", "edge"],
  ["Gold Bear", "gold-bear"],
  ["Green Bunny", "green-bunny"],
  ["Himajin Planning", "himajin-planning"],
  ["King Bee", "king-bee"],
  ["L.", "l"],
  ["Lune Pictures", "lune-pictures"],
  ["MS Pictures", "ms-pictures"],
  ["Majin", "majin"],
  ["Mary Jane", "mary-jane"],
  ["Mediabank", "mediabank"],
  ["Mousou Senka", "mousou-senka"],
  ["Natural High", "natural-high"],
  ["Nihikime no Dozeu", "nihikime-no-dozeu"],
  ["Nur", "nur"],
  ["Pashmina", "pashmina"],
  ["Peak Hunt", "peak-hunt"],
  ["Pink Pineapple", "pink-pineapple"],
  ["Pixy Soft", "pixy-soft"],
  ["Pixy", "pixy"],
  ["PoRO", "poro"],
  ["Queen Bee", "queen-bee"],
  ["Rabbit Gate", "rabbit-gate"],
  ["SELFISH", "selfish"],
  ["Seven", "seven"],
  ["Showten", "showten"],
  ["Studio 1st", "studio-1st"],
  ["Studio Eromatick", "studio-eromatick"],
  ["Studio Fantasia", "studio-fantasia"],
  ["Suiseisha", "suiseisha"],
  ["Suzuki Mirano", "suzuki-mirano"],
  ["T-Rex", "t-rex"],
  ["Toranoana", "toranoana"],
  ["Union Cho", "union-cho"],
  ["Valkyria", "valkyria"],
  ["White Bear", "white-bear"],
  ["ZIZ", "ziz"],
];

const ORDERS: [string, string][] = [
  ["View Count", "view-count"], // the only reason I'm not using a sort filter
  ["A-Z", "az"],
  ["Z-A", "za"],
  ["Recently Uploaded", "recently-uploaded"],
  ["Recently Released", "recently-released"],
  ["Oldest Uploads", "oldest-uploads"],
  ["Oldest Releases", "oldest-releases"],
];
