// Port of yuzono/anime-extensions src/all/anizone/AniZone.kt
import {
  AnimeHttpSource,
  EditTextPreference,
  Filter,
  FilterList,
  firstInstanceOrNull,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  parseHtml,
  POST,
  SAnime,
  SEpisode,
  SwitchPreferenceCompat,
  Track,
  urlWithoutDomain,
  Video,
  type ClientBuilder,
  type Document,
  type Element,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";
import {
  animeXDataToSAnime,
  animeXDataWrappedToSAnime,
  episodeXDataToSEpisode,
  livewireCall,
  parseDate,
  type AnimeXData,
  type AnimeXDataWrapped,
  type EpisodeXData,
  type LivewireCall,
  type LivewireDto,
  type VidstackConfig,
} from "./dto.ts";

const HEX_ESCAPE = /\\x([0-9a-fA-F]{2})/g;
const INVALID_BACKSLASH = /\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;
const BR_REGEX = /<br\s*\/?>/gi;
const FALLBACK_TITLE_REGEX = /getTitle\([^,]+,\s*'([^']+)'\)/;
const SLUG_REGEX = /anmSlug:\s*'([^']+)'/;
const SET_VIDEO_REGEX = /setVideo\(['"]?(\d+)['"]?\)/;
const JSON_PARSE_REGEX = /([a-zA-Z0-9_]+):\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/g;
const VIDSTACK_REGEX = /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SEASON_REGEX = /s\d+/i;
const EPISODE_NUMBER_REGEX = /\d+(\.\d+)?/g;
const NEXT_CURSOR_REGEX = /nextCursor:\s*'([^']+)'/;

const ANIME_SNAPSHOT_KEY = "anime_snapshot_key";
const EPISODE_SNAPSHOT_KEY = "episode_snapshot_key";
const VIDEO_SNAPSHOT_KEY = "video_snapshot_key";

/** Safety cap on episode-list pagination follow-up requests, in case `hasMore`/`nextCursor` never settle. */
const MAX_PAGINATION_ITERATIONS = 50;

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_TITLE = "Preferred Quality";
const PREF_QUALITY_DEFAULT = "1080";
const PREF_QUALITY_ENTRIES = ["1080p", "720p", "480p", "360p"];
const PREF_QUALITY_ENTRY_VALUES = ["1080", "720", "480", "360"];

const PREF_AUDIO_KEY = "preferred_audio";
const PREF_AUDIO_TITLE = "Preferred Audio Language";
const PREF_AUDIO_DEFAULT = "jpn";
const PREF_AUDIO_ENTRIES = ["English", "French", "Polish", "Korean", "Japanese", "German", "Italian", "Spanish", "Hungarian", "Portuguese (Brazilian)", "Arabic", "Thai", "Spanish (Latin American)", "Filipino (Tagalog)", "Indonesian", "Hindi"];
const PREF_AUDIO_ENTRY_VALUES = ["eng", "fra", "pol", "kor", "jpn", "deu", "ita", "spa", "hun", "por-br", "ara", "tha", "spa-la", "fil", "ind", "hin"];

const PREF_SUB_KEY = "preferred_subtitle";
const PREF_SUB_TITLE = "Preferred Subtitle Language";
const PREF_SUB_DEFAULT = "eng";
const PREF_SUB_ENTRIES = ["English", "Japanese", "Arabic", "Spanish", "Catalan", "Czech", "Danish", "German", "Greek", "Spanish (Latin American)", "Spanish (European)", "Spanish (Basque)", "Finnish", "Filipino (Tagalog)", "French", "Spanish (Galician)", "Hebrew", "Hindi", "Latin", "Croatian", "Hungarian", "Indonesian", "Italian", "Korean", "Malay", "Norwegian", "Dutch", "Polish", "Portuguese (Brazilian)", "Portuguese (European)", "Romanian", "Russian", "Swedish", "Thai", "Turkish", "Ukrainian", "Vietnamese", "Chinese (Simplified)", "Chinese (Traditional)"];
const PREF_SUB_ENTRY_VALUES = ["eng", "jpn", "ara", "spa", "cat", "ces", "dan", "deu", "ell", "spa-la", "spa-eu", "eus", "fin", "fil", "fra", "glg", "heb", "hin", "lat", "hrv", "hun", "ind", "ita", "kor", "msa", "nor", "nld", "pol", "por-br", "por-eu", "ron", "rus", "swe", "tha", "tur", "ukr", "vie", "zho-s", "zho-t"];

const PREF_LOAD_ALL_KEY = "load_all_tracks";
const PREF_LOAD_ALL_TITLE = "Load All Audio/Subtitle Tracks";
const PREF_LOAD_ALL_DEFAULT = false;

const PREF_SUB_COUNT_KEY = "subtitle_count";
const PREF_SUB_COUNT_TITLE = "Subtitle Count";
const PREF_SUB_COUNT_DEFAULT = "2";

const PREF_TITLE_LANG_KEY = "preferred_title_lang";
const PREF_TITLE_LANG_TITLE = "Preferred Title Language";
const PREF_TITLE_LANG_DEFAULT = "1";
const PREF_TITLE_LANG_ENTRIES = ["English", "Romaji"];
const PREF_TITLE_LANG_ENTRY_VALUES = ["1", "5"];

const LANG_REGEX_CACHE = new Map<string, RegExp | null>();
const STRIP_FIELD_REGEX_CACHE = new Map<string, RegExp>();

class SortFilter extends Filter.Select<string> {
  static readonly vals: [string, string][] = [
    ["A-Z", "title-asc"],
    ["Z-A", "title-desc"],
    ["Earliest Release", "release-asc"],
    ["Latest Release", "release-desc"],
    ["First Added", "added-asc"],
    ["Last Added", "added-desc"],
  ];
  constructor() {
    super(
      "Sort",
      SortFilter.vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return SortFilter.vals[this.state][1];
  }
}

/** Parser.unescapeEntities */
const unescapeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|apos|lt|gt|nbsp|#039);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)));
    return ({ quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[k] ?? m;
  });

const clean = (s: string) => unescapeEntities(s).replaceAll("\\/", "/").replaceAll("`", "'").trim();

const unescapeXDataJson = (s: string) => s.replaceAll("\\u0022", '"').replaceAll("\\u0026", "&").replaceAll("\\'", "'").replaceAll("\\/", "/").replaceAll("\\\\", "\\");

/** Fixes malformed escape sequences commonly found in XData payloads. */
const sanitizeInvalidEscapes = (s: string) =>
  s
    .replaceAll("\\&", "&")
    .replaceAll("\\'", "'")
    .replaceAll("\\0", "\\u0000")
    .replace(HEX_ESCAPE, (_, h: string) => `\\u${parseInt(h, 16).toString(16).padStart(4, "0")}`)
    .replace(INVALID_BACKSLASH, "");

/** Finds the raw (still-escaped) argument to `JSON.parse('...')` for the x-data key named `key`. */
const findRawJsonParseArg = (s: string, key: string) => [...s.matchAll(JSON_PARSE_REGEX)].find((m) => m[1] === key)?.[2] ?? null;

/** Removes an unused field's value from a raw (still hex-escaped) x-data object, before the lossy unescape step. */
function stripXDataTextField(s: string, key: string) {
  let re = STRIP_FIELD_REGEX_CACHE.get(key);
  if (!re) STRIP_FIELD_REGEX_CACHE.set(key, (re = new RegExp(`(\\\\u0022${key}\\\\u0022:\\\\u0022)[\\s\\S]*?(\\\\u0022,\\\\u0022|\\\\u0022\\})`, "g")));
  return s.replace(re, "$1$2");
}

/** Splits a JSON array's raw text into the raw text of each top-level object, by brace depth (not quote-aware, as upstream). */
function splitTopLevelJsonObjects(rawArray: string): string[] {
  let body = rawArray.trim();
  if (body.startsWith("[")) body = body.slice(1);
  if (body.endsWith("]")) body = body.slice(0, -1);
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (body[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        chunks.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function extractJsonFromXData<T>(xData: string, key: string): T | null {
  const rawJson = findRawJsonParseArg(xData, key);
  return rawJson == null ? null : tryParse<T>(unescapeXDataJson(rawJson));
}

/** Same source as extractJsonFromXData, but for a JSON array, parsed element by element (see upstream's note on stray quotes). */
function extractJsonListFromXData<T>(xData: string, key: string, stripFields: string[] = []): T[] | null {
  const rawArray = findRawJsonParseArg(xData, key);
  if (rawArray == null) return null;
  return splitTopLevelJsonObjects(rawArray).flatMap((rawElement) => {
    const cleaned = sanitizeInvalidEscapes(unescapeXDataJson(stripFields.reduce((acc, field) => stripXDataTextField(acc, field), rawElement)));
    const v = tryParse<T>(cleaned);
    return v == null ? [] : [v];
  });
}

function extractAndParseJson(s: string, prefix: string): unknown {
  const at = s.indexOf(`${prefix}: JSON.parse('`);
  if (at === -1) return null;
  const rest = s.slice(at + `${prefix}: JSON.parse('`.length);
  const jsonString = rest.slice(0, rest.indexOf("')") === -1 ? rest.length : rest.indexOf("')"));
  if (!jsonString) return null;
  const cleanJson = unescapeEntities(jsonString).replaceAll("\\u0022", '"').replaceAll("\\\\", "\\").replaceAll("\\/", "/");
  return tryParse(cleanJson);
}

function getLangRegex(langValue: string): RegExp | null {
  if (LANG_REGEX_CACHE.has(langValue)) return LANG_REGEX_CACHE.get(langValue)!;
  const shortCode = (
    {
      jpn: "ja|jp|jap",
      eng: "en|eng",
      fra: "fr|fra",
      deu: "de|deu",
      ita: "it|ita",
      kor: "ko|kor",
      ara: "ar|ara",
      rus: "ru|rus",
      spa: "es|spa",
      "spa-la": "es|spa",
      "spa-eu": "es|spa",
      "por-br": "pt|por",
      "por-eu": "pt|por",
    } as Record<string, string>
  )[langValue];
  if (!shortCode) return null;
  const re = new RegExp(`(^|[^a-z])(${shortCode})([^a-z]|$)`);
  LANG_REGEX_CACHE.set(langValue, re);
  return re;
}

function containsLang(s: string, langValue: string, langEntry: string, regex: RegExp | null = null) {
  const normalized = s.toLowerCase();
  if (normalized.includes(langEntry.toLowerCase()) || normalized.includes(langValue.toLowerCase())) return true;
  return regex?.test(normalized) ?? false;
}

const itemsLoaded = (dto: LivewireDto) => dto.components[0]?.effects?.dispatches?.find((it) => it.name === "items-loaded");

export default class AniZone extends AnimeHttpSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  private token = "";
  private nextCursor = "";
  private currentSlug = "/anime";
  private readonly livewireUpdateUrl = "/livewire/update";
  private readonly snapShots: Record<string, string> = { [ANIME_SNAPSHOT_KEY]: "", [EPISODE_SNAPSHOT_KEY]: "", [VIDEO_SNAPSHOT_KEY]: "" };
  private readonly seenUrls = new Set<string>();

  private isLivewire(res: Response) {
    return new URL(res.url).pathname.includes(this.livewireUpdateUrl);
  }

  // ============================== Popular ===============================
  override async fetchPopularManga(page: number): Promise<MangasPage> {
    if (page === 1) this.resetAnimeListState("/anime");
    const request = page === 1 ? GET(`${this.baseUrl}/anime?sort=title-asc`, this.headers) : await this.createLivewireReq(ANIME_SNAPSHOT_KEY, {}, this.buildLoadPageCalls(this.nextCursor), this.currentSlug);
    return this.parseAnimesPage(await this.fetchAnimesResponse(request));
  }

  private async parseAnimesPage(res: Response): Promise<MangasPage> {
    const isLivewire = this.isLivewire(res);

    let dispatchedItems: AnimeXData[] | null = null;
    let dispatchedCursor: string | null = null;
    let dispatchedHasMore: boolean | null = null;

    let html: Element;
    if (isLivewire) {
      const dto = res.parseAs<LivewireDto>();
      const loaded = itemsLoaded(dto);
      dispatchedItems = (loaded?.params?.items as AnimeXData[] | null | undefined) ?? null;
      dispatchedCursor = loaded?.params?.nextCursor ?? null;
      dispatchedHasMore = loaded?.params?.hasMore ?? null;
      html = this.getHtml(dto, ANIME_SNAPSHOT_KEY);
    } else {
      html = this.updateState(res.asJsoup(), ANIME_SNAPSHOT_KEY);
    }

    const xData = html.selectFirst("[x-data*=items]")?.attr("x-data") ?? "";
    const itemsJson = extractAndParseJson(xData, "items");
    const fromXData = extractJsonListFromXData<AnimeXData>(xData, "items");
    const items = dispatchedItems ?? (fromXData?.length ? fromXData : null);

    let rawAnimeList: SAnime[];
    if (items?.length) {
      rawAnimeList = items.map((it) => animeXDataToSAnime(it, this.preferredTitleLang)).filter((a): a is SAnime => a != null);
    } else {
      const wrapped = Array.isArray(itemsJson) ? (itemsJson as AnimeXDataWrapped[]).filter((it) => it?.anime) : null;
      if (wrapped?.length) {
        rawAnimeList = wrapped.map((it) => animeXDataWrappedToSAnime(it, this.preferredTitleLang)).filter((a): a is SAnime => a != null);
      } else {
        const animeDict = extractJsonFromXData<Record<string, Record<string, string>>>(html.selectFirst("[x-data*=animeDict]")?.attr("x-data") ?? "", "animeDict") ?? {};
        rawAnimeList = html
          .select(".grid > div, .grid > li, li.space-y-3")
          .filter((it) => it.selectFirst("a[href*=/anime/]") != null)
          .map((element) => this.animeFromElement(element, animeDict))
          .filter((a): a is SAnime => a != null);
      }
    }

    const animeList = rawAnimeList.filter((it) => !this.seenUrls.has(it.url) && (this.seenUrls.add(it.url), true));

    // Fallback only: the initial SSR'd Alpine state, usually blank; the live cursor comes from the dispatch above.
    this.nextCursor = dispatchedCursor ?? NEXT_CURSOR_REGEX.exec(xData)?.[1] ?? "";

    const hasNextPage = this.nextCursor.trim() ? (dispatchedHasMore ?? true) : html.selectFirst("div[x-intersect~=loadMore]") != null;

    // Livewire returned only duplicates: stop paging, but keep the page non-empty.
    if (isLivewire && !animeList.length && rawAnimeList.length) return new MangasPage(rawAnimeList, false);
    return new MangasPage(animeList, hasNextPage);
  }

  private animeFromElement(element: Element, animeDict: Record<string, Record<string, string>> = {}): SAnime | null {
    const allLinks = element.select("a[href*=/anime/]");
    const titleLink =
      allLinks.find((it) => {
        const href = it.attr("href");
        const path = href.slice(href.indexOf("/anime/") + "/anime/".length).replace(/^\/+|\/+$/g, "");
        return path && !path.includes("/");
      }) ??
      allLinks.first() ??
      null;
    if (!titleLink) return null;

    const xData = element.attr("x-data");
    const anime = SAnime.create();
    const rawUrl = new URL(titleLink.absUrl("href"));
    const segments = rawUrl.pathname.split("/").filter(Boolean);
    const anmIndex = segments.indexOf("anime");
    if (anmIndex !== -1 && segments.length > anmIndex + 2) rawUrl.pathname = "/" + segments.slice(0, anmIndex + 2).join("/");
    anime.url = urlWithoutDomain(rawUrl.toString());

    const seriesTitleElement = titleLink.selectFirst("span[x-text*=AnimeTitle]") ?? element.selectFirst("span[x-text*=AnimeTitle]");
    const fallback = seriesTitleElement?.text() ?? (titleLink.attr("title").trim() ? titleLink.attr("title") : null) ?? (titleLink.text() || null);

    const anmSlug = SLUG_REGEX.exec(xData)?.[1];
    const titlesFromDict = anmSlug ? animeDict[anmSlug] : undefined;

    const title = this.getPreferredTitle(xData, fallback, true, titlesFromDict);
    if (title == null) return null;
    anime.title = title;
    anime.thumbnail_url = element.selectFirst("img")?.attr("abs:src") ?? "";
    return anime;
  }

  // =============================== Latest ===============================
  override async fetchLatestUpdates(page: number): Promise<MangasPage> {
    if (page === 1) this.resetAnimeListState("/");
    const request = page === 1 ? GET(`${this.baseUrl}/`, this.headers) : await this.createLivewireReq(ANIME_SNAPSHOT_KEY, {}, this.buildLoadPageCalls(this.nextCursor), this.currentSlug);
    return this.parseAnimesPage(await this.fetchAnimesResponse(request));
  }

  private async fetchAnimesResponse(request: Request): Promise<Response> {
    return this.retryOn419(await this.client.execute(request), (req) =>
      new URL(req.url).pathname.includes(this.livewireUpdateUrl) ? this.newLivewireCall(ANIME_SNAPSHOT_KEY, {}, this.buildLoadPageCalls(this.nextCursor), this.currentSlug) : this.client.execute(req),
      request,
    );
  }

  // =============================== Search ===============================
  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortFilter = firstInstanceOrNull(filters, SortFilter) ?? new SortFilter();
    let request: Request;
    if (page === 1) {
      const url = new URL(`${this.baseUrl}/anime`);
      url.searchParams.set("search", query);
      url.searchParams.set("sort", sortFilter.toUriPart());
      this.resetAnimeListState(url.pathname + url.search);
      request = GET(url, this.headers);
    } else {
      request = await this.createLivewireReq(ANIME_SNAPSHOT_KEY, {}, this.buildLoadPageCalls(this.nextCursor), this.currentSlug);
    }
    return this.parseAnimesPage(await this.fetchAnimesResponse(request));
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): SAnime {
    const document = response.asJsoup();
    const anime = SAnime.create();
    anime.thumbnail_url = document.selectFirst("div.flex.items-start img")?.attr("abs:src") ?? "";

    const xData = document.selectFirst("[x-data*=anmTitles]")?.attr("x-data") ?? "";
    const fallbackText = document.selectFirst("h1")?.text() || document.selectFirst("title")?.text()?.split(" — AniZone")[0] || null;
    const title = this.getPreferredTitle(xData, fallbackText);
    if (title == null) throw new Error("Could not find title");
    anime.title = title;

    const status = document
      .select("span.inline-block")
      .find((it) => ["completed", "ongoing", "upcoming", "cancelled"].includes(it.text().toLowerCase()))
      ?.text()
      .toLowerCase();
    anime.status = status === "completed" ? SAnime.COMPLETED : status === "ongoing" ? SAnime.ONGOING : status === "cancelled" ? SAnime.CANCELLED : SAnime.UNKNOWN;

    anime.genre = document.select("a[href*=/tag/]").eachText().join(", ");

    const synopsis = document.selectFirst("div:has(> h3:contains(Synopsis)) > div")?.html();
    if (synopsis != null) anime.description = parseHtml(this.host.load, synopsis.replace(BR_REGEX, "___br___"), this.baseUrl).text().replaceAll("___br___", "\n").replaceAll("`", "'");
    return anime;
  }

  // ============================== Episodes ==============================
  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    this.snapShots[EPISODE_SNAPSHOT_KEY] = "";
    const request = GET(this.baseUrl + anime.url, this.headers);
    const response = await this.executeSuccess(request);
    return this.parseEpisodeList(await this.retryOn419(response, (req) => this.client.execute(req), request));
  }

  private async parseEpisodeList(res: Response): Promise<SEpisode[]> {
    const isLivewire = this.isLivewire(res);

    let dispatchedItems: EpisodeXData[] | null = null;
    let dispatchedHasMore: boolean | null = null;
    let dispatchedCursor: string | null = null;

    let html: Element;
    if (isLivewire) {
      const dto = res.parseAs<LivewireDto>();
      const loaded = itemsLoaded(dto);
      dispatchedItems = (loaded?.params?.items as EpisodeXData[] | null | undefined) ?? null;
      dispatchedHasMore = loaded?.params?.hasMore ?? null;
      dispatchedCursor = loaded?.params?.nextCursor ?? null;
      html = this.getHtml(dto, EPISODE_SNAPSHOT_KEY);
    } else {
      html = this.updateState(res.asJsoup(), EPISODE_SNAPSHOT_KEY);
    }

    const xData = html.selectFirst("[x-data*=items]")?.attr("x-data") ?? "";
    const items = dispatchedItems ?? extractJsonListFromXData<EpisodeXData>(xData, "items", ["summary"]);

    const episodeList: SEpisode[] = [];
    if (items?.length) {
      episodeList.push(...items.map((it) => episodeXDataToSEpisode(it, this.preferredTitleLang)).filter((e): e is SEpisode => e != null));
    } else {
      // Only a "no episodes" fallback for older layouts: the <li> markup lives in an Alpine <template x-for>.
      episodeList.push(...html.select(this.episodeSelector).map((e) => this.episodeFromElement(e)).filter((e): e is SEpisode => e != null));
    }

    // Track added URLs to prevent duplication from cumulative Livewire HTML snapshots
    const seenEpisodeUrls = new Set(episodeList.map((it) => it.url));

    let hasMore = dispatchedHasMore ?? html.selectFirst("div[x-intersect~=loadMore]") != null;
    let cursor = dispatchedCursor ?? NEXT_CURSOR_REGEX.exec(xData)?.[1] ?? "";

    let iterations = 0;
    const path = new URL(res.url).pathname;
    while (hasMore && cursor.trim()) {
      if (++iterations > MAX_PAGINATION_ITERATIONS) break;
      const resp = await this.newLivewireCall(EPISODE_SNAPSHOT_KEY, {}, this.buildLoadPageCalls(cursor), path);
      const liveDto = resp.parseAs<LivewireDto>();
      const liveHtml = this.getHtml(liveDto, EPISODE_SNAPSHOT_KEY); // always update snapshot state
      const liveDispatch = itemsLoaded(liveDto);
      const newItems = liveDispatch?.params?.items as EpisodeXData[] | null | undefined;

      const newlyParsed = newItems?.length
        ? newItems.map((it) => episodeXDataToSEpisode(it, this.preferredTitleLang)).filter((e): e is SEpisode => e != null)
        : liveHtml.select(this.episodeSelector).map((e) => this.episodeFromElement(e)).filter((e): e is SEpisode => e != null);

      for (const episode of newlyParsed) {
        if (!seenEpisodeUrls.has(episode.url)) {
          seenEpisodeUrls.add(episode.url);
          episodeList.push(episode);
        }
      }

      const newCursor = liveDispatch?.params?.nextCursor ?? "";
      hasMore = (liveDispatch?.params?.hasMore ?? false) && newCursor !== cursor && !!newCursor.trim();
      cursor = newCursor;
    }

    const isSpecial = (it: SEpisode) => {
      const baseName = it.name.split(" - ")[0];
      return SEASON_REGEX.test(baseName) || /special/i.test(baseName) || /recap/i.test(baseName);
    };
    const byNumberDesc = (a: SEpisode, b: SEpisode) => b.episode_number - a.episode_number;
    return [...episodeList.filter(isSpecial).sort(byNumberDesc), ...episodeList.filter((it) => !isSpecial(it)).sort(byNumberDesc)];
  }

  private readonly episodeSelector = "ul > li";

  private episodeFromElement(element: Element): SEpisode | null {
    const url = element.select("a[href*=/anime/]").first()?.absUrl("href") ?? element.selectFirst("a[href]")?.absUrl("href");
    if (!url) return null;

    const xData = element.attr("x-data");
    const h3 = element.selectFirst("h3");
    const baseName = h3 ? clean(h3.ownText()) : "Episode";
    const span = h3?.selectFirst("span")?.text();
    const fallbackTitle = span == null ? null : span.slice(span.indexOf(":") + 1);
    const episodeTitle = this.getPreferredTitle(xData, fallbackTitle, false);

    const episode = SEpisode.create();
    episode.url = urlWithoutDomain(url);
    episode.name = episodeTitle?.trim() && episodeTitle !== "Unknown" ? `${baseName} - ${episodeTitle}` : baseName;
    episode.episode_number = Number.parseFloat([...baseName.matchAll(EPISODE_NUMBER_REGEX)].at(-1)?.[0] ?? "") || -1;
    const date = element.select("span").find((it) => DATE_REGEX.test(it.text()))?.text();
    episode.date_upload = date ? parseDate(date) : 0;
    return episode;
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Not used");
  }

  // ============================ Video Links =============================
  private vidstackData(document: Element): VidstackConfig | null {
    const xData = document.selectFirst("[x-data*=vidstackPlayer]")?.attr("x-data");
    if (xData == null) return null;
    const jsonString = VIDSTACK_REGEX.exec(xData)?.[1];
    if (jsonString == null) return null;
    return tryParse<VidstackConfig>(jsonString.replaceAll("\\u0022", '"').replaceAll("\\u0026", "&").replaceAll("\\'", "'").replaceAll("\\/", "/"));
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const urlPath = episode.url;
    const document = (await this.executeSuccess(GET(`${this.baseUrl}${urlPath}`, this.headers))).asJsoup();
    this.snapShots[VIDEO_SNAPSHOT_KEY] = this.getSnapshot(document) ?? "";

    return document
      .select("button[wire:click]")
      .filter((it) => it.attr("wire:click").includes("setVideo"))
      .map((btn) => {
        const videoId = SET_VIDEO_REGEX.exec(btn.attr("wire:click"))?.[1] ?? "0";
        // The server whose stream is already embedded in this page load is rendered 'disabled'
        const isDefault = btn.hasAttr("disabled");
        const hosterName = btn.selectFirst("div.text-lg")?.text() || btn.text();
        // ponytail: Hoster has no internalData here; upstream's "path###id###default" rides in hosterUrl.
        return new Hoster(`${urlPath}###${videoId}###${isDefault}`, hosterName);
      });
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const [urlPath, videoId = "0", isDefault = "false"] = hoster.hosterUrl.split("###");
    if (!urlPath) return [];
    const request = GET(`${this.baseUrl}${urlPath}`, this.headers);
    const response = await this.executeSuccess(request);
    return this.extractVideos(await this.retryOn419(response, (req) => this.client.execute(req), request), hoster.hosterName, videoId, isDefault === "true");
  }

  private async extractVideos(res: Response, hosterName: string, videoId: string, isDefault: boolean): Promise<Video[]> {
    const initialDocument = res.asJsoup();
    this.snapShots[VIDEO_SNAPSHOT_KEY] = this.getSnapshot(initialDocument) ?? "";

    const loadAll = this.preferences.getBoolean(PREF_LOAD_ALL_KEY, PREF_LOAD_ALL_DEFAULT);

    const audioValue = this.audio;
    const audioEntry = PREF_AUDIO_ENTRIES[PREF_AUDIO_ENTRY_VALUES.indexOf(audioValue)] ?? audioValue;
    const audioRegex = getLangRegex(audioValue);
    const fallbackAudioValue = "jpn";
    const fallbackAudioEntry = "Japanese";
    const fallbackAudioRegex = getLangRegex(fallbackAudioValue);

    const subValue = this.subtitle;
    const subEntry = PREF_SUB_ENTRIES[PREF_SUB_ENTRY_VALUES.indexOf(subValue)] ?? subValue;
    const subRegex = getLangRegex(subValue);
    const fallbackSubValue = "eng";
    const fallbackSubEntry = "English";
    const fallbackSubRegex = getLangRegex(fallbackSubValue);

    const subCount = Number.parseInt(this.preferences.getString(PREF_SUB_COUNT_KEY, PREF_SUB_COUNT_DEFAULT) ?? "") || Number(PREF_SUB_COUNT_DEFAULT);

    const filterSubs = (subs: Track[]): Track[] => {
      if (loadAll) return subs;
      const preferred = subs.filter((it) => containsLang(it.lang, subValue, subEntry, subRegex));
      const fallback = subs.filter((it) => containsLang(it.lang, fallbackSubValue, fallbackSubEntry, fallbackSubRegex));
      const initial = [...preferred, ...fallback].filter((t, i, a) => a.findIndex((x) => x.url === t.url) === i);
      if (initial.length >= subCount) return initial.slice(0, subCount);
      const others = subs.filter((track) => initial.every((it) => it.url !== track.url));
      return [...initial, ...others].slice(0, subCount);
    };

    let document: Element = initialDocument;
    if (!isDefault) {
      const calls = [livewireCall("setVideo", [Number.parseInt(videoId) || 0])];
      const resp = await this.newLivewireCall(VIDEO_SNAPSHOT_KEY, {}, calls, new URL(res.url).pathname);
      document = this.getHtml(resp.parseAs<LivewireDto>(), VIDEO_SNAPSHOT_KEY);
    }

    const vidstack = this.vidstackData(document);
    const subtitles = filterSubs(
      vidstack?.subtitles?.map((it) => new Track(it.file.replaceAll("\\/", "/"), it.title)) ??
        document.select("track[kind=subtitles]").map((it) => new Track(it.attr("src").replaceAll("\\/", "/"), it.attr("label"))),
    );

    // the src arrives as "https:\/\/..." (doubly escaped); upstream unescapes only the subtitle files
    const videoUrl = (vidstack?.src ?? document.selectFirst("media-player")?.attr("src"))?.replaceAll("\\/", "/");
    if (!videoUrl) return [];

    const allVideos = await new PlaylistUtils(this.client, this.headers).extractFromHls(videoUrl, { referer: `${this.baseUrl}/`, videoNameGen: (q) => `${hosterName} - ${q}`, subtitleList: subtitles });
    if (loadAll) return allVideos;

    const filtered = allVideos
      .map((video) => {
        const filteredAudio = video.audioTracks.filter((it) => containsLang(it.lang, audioValue, audioEntry, audioRegex));
        const finalAudio = filteredAudio.length ? filteredAudio : video.audioTracks.filter((it) => containsLang(it.lang, fallbackAudioValue, fallbackAudioEntry, fallbackAudioRegex));
        return new Video({ videoUrl: video.videoUrl, videoTitle: video.videoTitle, headers: video.headers, subtitleTracks: filterSubs(video.subtitleTracks), audioTracks: finalAudio });
      })
      .filter(
        (video) =>
          containsLang(video.videoTitle, audioValue, audioEntry, audioRegex) ||
          containsLang(video.videoTitle, fallbackAudioValue, fallbackAudioEntry, fallbackAudioRegex) ||
          video.audioTracks.length > 0,
      );
    return filtered.length ? filtered : allVideos;
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT) ?? PREF_QUALITY_DEFAULT;
    const audio = this.audio.toLowerCase();
    const subtitle = this.subtitle.toLowerCase();
    const score = (v: Video) => {
      const t = v.videoTitle.toLowerCase();
      return (
        (v.videoTitle.includes(quality) ? 4 : 0) +
        (t.includes(audio) || (audio === "jpn" && (t.includes("jp") || t.includes("ja"))) ? 2 : 0) +
        (t.includes(subtitle) || (subtitle === "eng" && t.includes("en")) ? 1 : 0)
      );
    };
    return [...videos].reverse().sort((a, b) => score(b) - score(a));
  }

  // ============================== Filters ===============================
  override getFilterList(): FilterList {
    return FilterList(new SortFilter());
  }

  // ============================= Utilities ==============================
  /** Resets all per-list state (snapshot, csrf token, dedupe set, cursor) and records the page Livewire calls are scoped to. */
  private resetAnimeListState(slug: string) {
    this.snapShots[ANIME_SNAPSHOT_KEY] = "";
    this.token = "";
    this.seenUrls.clear();
    this.nextCursor = "";
    this.currentSlug = slug;
  }

  /** Builds the Livewire `calls` payload for requesting the next page via `loadPage`. */
  private buildLoadPageCalls(cursor: string): LivewireCall[] {
    return [livewireCall("loadPage", [cursor])];
  }

  private async newLivewireCall(mapKey: string, updates: Record<string, unknown>, calls: LivewireCall[], initialSlug = "/anime"): Promise<Response> {
    const build = () => this.createLivewireReq(mapKey, updates, calls, initialSlug);
    const request = await build();
    return this.retryOn419(await this.client.execute(request), async () => this.client.execute(await build()), request);
  }

  private async retryOn419(res: Response, onRetry: (req: Request) => Promise<Response>, request: Request): Promise<Response> {
    if (res.code === 419) {
      this.token = "";
      return onRetry(request);
    }
    return res;
  }

  private getHtml(dto: LivewireDto, mapKey: string): Document {
    const data = dto.components[0];
    this.snapShots[mapKey] = data.snapshot.replaceAll('\\"', '"');
    return parseHtml(this.host.load, data.effects.html.replaceAll('\\"', '"').replaceAll("\\n", ""), this.baseUrl);
  }

  private getSnapshot(document: Element): string | null {
    return document.selectFirst("main > div[wire:snapshot], main > ul[wire:snapshot]")?.attr("wire:snapshot").replaceAll("&quot;", '"') ?? null;
  }

  private updateState(document: Document, mapKey: string): Element {
    const csrf = document.selectFirst("script[data-csrf]")?.attr("data-csrf");
    if (csrf) this.token = csrf;
    const snapshot = this.getSnapshot(document);
    if (snapshot != null) this.snapShots[mapKey] = snapshot;
    return document.selectFirst("main > div[wire:snapshot], main > ul[wire:snapshot]") ?? document.selectFirst("body") ?? document;
  }

  private async createLivewireReq(mapKey: string, updates: Record<string, unknown>, calls: LivewireCall[], initialSlug = "/anime"): Promise<Request> {
    if (!this.snapShots[mapKey] || !this.token) {
      this.updateState((await this.client.execute(GET(this.baseUrl + initialSlug, this.headers))).asJsoup(), mapKey);
      if (!this.token) throw new Error("Failed to get csrf token");
    }
    const requestHeaders = this.headersBuilder();
    requestHeaders.append("Accept", "*/*");
    requestHeaders.append("Content-Type", "application/json");
    requestHeaders.append("X-Livewire", "");
    requestHeaders.append("Origin", this.baseUrl);
    requestHeaders.append("Referer", `${this.baseUrl}${initialSlug}`);
    const payload = { _token: this.token, components: [{ snapshot: this.snapShots[mapKey] ?? "", updates, calls }] };
    return POST(`${this.baseUrl}/livewire/update`, requestHeaders, JSON.stringify(payload));
  }

  private getPreferredTitle(xData: string, fallbackText: string | null = null, isAnime = true, titlesFromDict?: Record<string, string>): string | null {
    const fromRegex = FALLBACK_TITLE_REGEX.exec(xData)?.[1];
    const fallbackTitle = fromRegex?.trim() ? clean(fromRegex) : fallbackText;
    const titlesMap = titlesFromDict ?? extractJsonFromXData<Record<string, string>>(xData, isAnime ? "anmTitles" : "epsTitles");
    const title = (titlesMap ? this.preferredTitle(titlesMap) : undefined) ?? fallbackTitle;
    return title == null ? null : clean(title);
  }

  /** The configured title language, then "1" (English) and "5" (Romaji), the two keys AniZone always populates. */
  private preferredTitle(m: Record<string, string>): string | undefined {
    return m[this.preferredTitleLang] ?? m["1"] ?? m["5"];
  }

  private get audio() {
    return this.preferences.getString(PREF_AUDIO_KEY, PREF_AUDIO_DEFAULT) ?? PREF_AUDIO_DEFAULT;
  }
  private get subtitle() {
    return this.preferences.getString(PREF_SUB_KEY, PREF_SUB_DEFAULT) ?? PREF_SUB_DEFAULT;
  }
  private get preferredTitleLang() {
    return this.preferences.getString(PREF_TITLE_LANG_KEY, PREF_TITLE_LANG_DEFAULT) ?? PREF_TITLE_LANG_DEFAULT;
  }

  protected popularAnimeRequest(): Request {
    throw new Error("Not used");
  }
  protected popularAnimeParse(): MangasPage {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeRequest(): Request {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(): MangasPage {
    throw new Error("Not used");
  }
  protected searchAnimeRequest(): Request {
    throw new Error("Not used");
  }
  protected searchAnimeParse(): MangasPage {
    throw new Error("Not used");
  }

  // ============================ Preferences =============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const list = (key: string, title: string, entries: string[], entryValues: string[], def: string) => {
      const p = new ListPreference(screen.context);
      p.key = key;
      p.title = title;
      p.entries = entries;
      p.entryValues = entryValues;
      p.setDefaultValue(def);
      p.summary = "%s";
      screen.addPreference(p);
    };
    list(PREF_TITLE_LANG_KEY, PREF_TITLE_LANG_TITLE, PREF_TITLE_LANG_ENTRIES, PREF_TITLE_LANG_ENTRY_VALUES, PREF_TITLE_LANG_DEFAULT);
    list(PREF_QUALITY_KEY, PREF_QUALITY_TITLE, PREF_QUALITY_ENTRIES, PREF_QUALITY_ENTRY_VALUES, PREF_QUALITY_DEFAULT);
    list(PREF_AUDIO_KEY, PREF_AUDIO_TITLE, PREF_AUDIO_ENTRIES, PREF_AUDIO_ENTRY_VALUES, PREF_AUDIO_DEFAULT);
    list(PREF_SUB_KEY, PREF_SUB_TITLE, PREF_SUB_ENTRIES, PREF_SUB_ENTRY_VALUES, PREF_SUB_DEFAULT);

    const loadAll = new SwitchPreferenceCompat(screen.context);
    loadAll.key = PREF_LOAD_ALL_KEY;
    loadAll.title = PREF_LOAD_ALL_TITLE;
    loadAll.setDefaultValue(PREF_LOAD_ALL_DEFAULT);
    screen.addPreference(loadAll);

    const subCount = new EditTextPreference(screen.context);
    subCount.key = PREF_SUB_COUNT_KEY;
    subCount.title = PREF_SUB_COUNT_TITLE;
    subCount.setDefaultValue(PREF_SUB_COUNT_DEFAULT);
    subCount.summary = `Number of subtitle tracks to load when 'Load all' is disabled. Current: ${this.preferences.getString(PREF_SUB_COUNT_KEY, PREF_SUB_COUNT_DEFAULT)}`;
    screen.addPreference(subCount);
  }
}
