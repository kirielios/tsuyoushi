// Port of yuzono/anime-extensions lib-multisrc/anikototheme (AnikotoTheme.kt, AnikotoExtractor.kt,
// AnikotoThemeFilters.kt, dto/AnikotoThemeDto.kt; lib 16). The video path needs no third-party decoder: MegaPlay's
// getSources `enc` is AES-CBC with a key/IV hardcoded upstream, and its CDN token is an HMAC-SHA256 the extension signs
// itself with a hardcoded secret. The only outside service is the server mapper (mapper.nekostream.site), which lists
// extra servers by MAL id; it failing only drops those servers, as upstream.
import {
  AnimeHttpSource,
  aesCbcDecrypt,
  Base64,
  ClientBuilder,
  DateTimeFormatter,
  Filter,
  fromUtf8,
  GET,
  hmacSha256,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  MultiSelectListPreference,
  parseHtml,
  rc4,
  SAnime,
  SEpisode,
  SwitchPreferenceCompat,
  toHttpUrl,
  Track,
  urlWithoutDomain,
  utf8,
  Video,
  type Document,
  type Element,
  type FilterList,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import { PlaylistUtils } from "../../libs/playlistutils/index.ts";

// =============================== Filters ================================
export class QueryPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toQueryPart() {
    return this.vals[this.state][1];
  }
}

export class CheckBoxFilterList extends Filter.Group<Filter.CheckBox> {
  constructor(
    name: string,
    readonly vals: [string, string][],
  ) {
    super(
      name,
      vals.map((it) => new Filter.CheckBox(it[0])),
    );
  }
  toQueryPart(): string[] {
    return this.state.filter((c) => c.state).flatMap((c) => this.vals.find((v) => v[0] === c.name)?.[1] ?? []);
  }
}

const SORT: [string, string][] = [
  ["Default", "default"],
  ["Latest Updated", "latest-updated"],
  ["Latest Added", "latest-added"],
  ["Score", "score"],
  ["Name A-Z", "name-az"],
  ["Release Date", "release-date"],
  ["Most Viewed", "most-viewed"],
  ["Number of episodes", "number_of_episodes"],
];
const GENRE: [string, string][] = [
  ["Action", "1"], ["Adventure", "2"], ["Cars", "538"], ["Comedy", "8"], ["Dementia", "453"], ["Demons", "119"],
  ["Drama", "62"], ["Ecchi", "214"], ["Fantasy", "3"], ["Game", "180"], ["Harem", "215"], ["Historical", "70"],
  ["Horror", "222"], ["Isekai", "74"], ["Josei", "404"], ["Kids", "46"], ["Magic", "203"], ["Martial Arts", "114"],
  ["Mecha", "123"], ["Military", "125"], ["Music", "242"], ["Mystery", "57"], ["Parody", "162"], ["Police", "136"],
  ["Psychological", "73"], ["Romance", "28"], ["Samurai", "163"], ["School", "14"], ["Sci-Fi", "12"], ["Seinen", "50"],
  ["Shoujo", "252"], ["Shoujo Ai", "235"], ["Shounen", "15"], ["Shounen Ai", "233"], ["Slice of Life", "35"],
  ["Space", "124"], ["Sports", "29"], ["Super Power", "16"], ["Supernatural", "9"], ["Thriller", "54"],
  ["unknown", "32"], ["Vampire", "58"],
];
const SEASON: [string, string][] = [["Fall", "fall"], ["Summer", "summer"], ["Spring", "spring"], ["Winter", "winter"]];
const YEAR = (): [string, string][] => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: currentYear + 1 - 1980 + 1 }, (_, i) => String(currentYear + 1 - i)).map((y) => [y, y]);
};
const TYPE: [string, string][] = [["Movie", "Movie"], ["TV", "TV"], ["OVA", "OVA"], ["ONA", "ONA"], ["Special", "Special"], ["Music", "Music"]];
const STATUS: [string, string][] = [["Finished Airing", "finished-airing"], ["Currently Airing", "currently-airing"], ["Not Yet Aired", "not-yet-aired"]];
const LANGUAGE: [string, string][] = [["Sub", "sub"], ["Dub", "dub"]];
const RATING: [string, string][] = [
  ["PG - Children", "PG"],
  ["PG 13 - Teens 13 and Older", "PG-13"],
  ["G - All Ages", "G"],
  ["R - 17+, Violence & Profanity", "R"],
  ["R+ - Profanity & Mild Nudity", "R+"],
  ["Rx - Hentai", "Rx"],
];
const SOURCE: [string, string][] = [
  ["4-koma Manga", "4-koma_manga"], ["Book", "book"], ["Card Game", "card_game"], ["Game", "game"],
  ["Light Novel", "light_novel"], ["Manga", "manga"], ["Mixed Media", "mixed_media"], ["Music", "music"],
  ["Novel", "novel"], ["Original", "original"], ["Other", "other"], ["Picture Book", "picture_book"], ["Radio", "radio"],
  ["Unknown", "unknown"], ["Video Game", "video_game"], ["Visual Novel", "visual_novel"], ["Web Manga", "web_manga"],
  ["Web Novel", "web_novel"],
];

export class SortFilter extends QueryPartFilter { constructor() { super("Sort order", SORT); } } // prettier-ignore
export class GenreFilter extends CheckBoxFilterList { constructor() { super("Genre", GENRE); } } // prettier-ignore
export class SeasonFilter extends CheckBoxFilterList { constructor() { super("Season", SEASON); } } // prettier-ignore
export class YearFilter extends CheckBoxFilterList { constructor() { super("Year", YEAR()); } } // prettier-ignore
export class TypeFilter extends CheckBoxFilterList { constructor() { super("Type", TYPE); } } // prettier-ignore
export class StatusFilter extends CheckBoxFilterList { constructor() { super("Status", STATUS); } } // prettier-ignore
export class LanguageFilter extends CheckBoxFilterList { constructor() { super("Language", LANGUAGE); } } // prettier-ignore
export class RatingFilter extends CheckBoxFilterList { constructor() { super("Rating", RATING); } } // prettier-ignore
export class SourceFilter extends CheckBoxFilterList { constructor() { super("Source", SOURCE); } } // prettier-ignore
export class EpisodesMinFilter extends Filter.Text { constructor() { super("Minimum episodes"); } } // prettier-ignore
export class EpisodesMaxFilter extends Filter.Text { constructor() { super("Maximum episodes"); } } // prettier-ignore

export const AnikotoThemeFilters = {
  getFilterList(hasSource: boolean, hasEpisodes: boolean): FilterList {
    return [
      new SortFilter(),
      new GenreFilter(),
      new SeasonFilter(),
      new YearFilter(),
      new TypeFilter(),
      new StatusFilter(),
      new LanguageFilter(),
      new RatingFilter(),
      ...(hasSource ? [new SourceFilter()] : []),
      ...(hasEpisodes ? [new EpisodesMinFilter(), new EpisodesMaxFilter()] : []),
    ];
  },

  getSearchParameters(filters: FilterList) {
    const first = <T>(cls: abstract new (...a: never[]) => T) => filters.find((f) => f instanceof cls) as T | undefined;
    const digits = (f?: Filter.Text) => (f?.state ?? "").trim().replace(/\D/g, "");
    return {
      sort: first(SortFilter)?.toQueryPart() ?? "",
      genres: first(GenreFilter)?.toQueryPart() ?? [],
      seasons: first(SeasonFilter)?.toQueryPart() ?? [],
      years: first(YearFilter)?.toQueryPart() ?? [],
      types: first(TypeFilter)?.toQueryPart() ?? [],
      statuses: first(StatusFilter)?.toQueryPart() ?? [],
      languages: first(LanguageFilter)?.toQueryPart() ?? [],
      ratings: first(RatingFilter)?.toQueryPart() ?? [],
      sources: first(SourceFilter)?.toQueryPart() ?? [],
      episodesMin: digits(first(EpisodesMinFilter)),
      episodesMax: digits(first(EpisodesMaxFilter)),
    };
  },

  addQueryParameterIfNotEmpty(b: HttpUrlBuilder, query: string, value: string) {
    if (value) b.addQueryParameter(query, value);
    return b;
  },

  addListQueryParameter(b: HttpUrlBuilder, query: string, values: string[]) {
    for (const v of values) b.addQueryParameter(`${query}[]`, v);
    return b;
  },
};

// ================================= DTOs =================================
interface ResultResponse {
  result: string;
}
interface ServerResponseDto {
  result: { url: string };
}
interface MapperServerDto {
  sub?: { url?: string | null } | null;
  dub?: { url?: string | null } | null;
}
interface MegaPlaySourcesDto {
  enc?: string | null;
  sources?: unknown;
  tracks?: { file: string; label?: string }[] | null;
  intro?: { start?: number; end?: number } | null;
  outro?: { start?: number; end?: number } | null;
}

/** MegaPlaySourcesFieldSerializer: an object's or the first array item's "file", or a plain string. */
function megaPlaySourcesField(element: unknown): string | null {
  const file = (e: unknown) => (e && typeof e === "object" && "file" in e ? String((e as { file: unknown }).file) : null);
  if (Array.isArray(element)) {
    const it = element[0];
    return typeof it === "string" ? it : file(it);
  }
  if (typeof element === "string") return element;
  return file(element);
}

// ================================= VRF ==================================
const b64UrlSafe = (b: Uint8Array) => Base64.encode(b).replace(/\+/g, "-").replace(/\//g, "_");

const AnikotoUtils = {
  ORDER: [
    ["exchange", ["AP6GeR8H0lwUz1", "UAz8Gwl10P6ReH"]],
    ["rc4", ["ItFKjuWokn4ZpB"]],
    ["rc4", ["fOyt97QWFB3"]],
    ["exchange", ["1majSlPQd2M5", "da1l2jSmP5QM"]],
    ["exchange", ["CPYvHj09Au3", "0jHA9CPYu3v"]],
    ["reverse", []],
    ["rc4", ["736y1uTJpBLUX"]],
    ["base64", []],
  ] as [string, string[]][],

  vrfEncrypt(input: string): string {
    let vrf = input;
    for (const [op, keys] of this.ORDER) {
      if (op === "exchange") vrf = [...vrf].map((c) => (keys[0].indexOf(c) !== -1 ? keys[1][keys[0].indexOf(c)] : c)).join("");
      else if (op === "rc4") vrf = b64UrlSafe(rc4(utf8(vrf), utf8(keys[0])));
      else if (op === "reverse") vrf = [...vrf].reverse().join("");
      else if (op === "base64") vrf = b64UrlSafe(utf8(vrf));
    }
    // java.net.URLEncoder: the URL-safe base64 alphabet only needs "=" escaped
    return encodeURIComponent(vrf);
  },
};

// ================================ Theme =================================
export interface VideoData {
  type: string;
  serverId: string;
  serverName: string;
}

/** Hoster(hosterUrl = serverId, hosterName, internalData = "type\0epUrl"). */
export class AnikotoHoster extends Hoster {
  constructor(
    hosterUrl: string,
    hosterName: string,
    readonly internalData: string,
  ) {
    super(hosterUrl, hosterName);
  }
}

const SOFTSUB_REGEX = /\bsoftsub\b/i;
const RELEASE_REGEX = /Release: (\d+\/\d+\/\d+ \d+:\d+)/;
export const EP_URL_SUFFIX_REGEX = /\/ep-\d+$/;
const DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm", Locale.ENGLISH);
const INTERNAL_DATA_SEPARATOR = "\u0000";

const PREF_TITLE_LANG_KEY = "preferred_title_lang";
const PREF_TITLE_LANG_DEFAULT = "English";
const PREF_TITLE_LANG_ENTRIES = ["English", "Japanese"];
const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_ENTRIES = ["1080", "720", "480", "360"];
const PREF_QUALITY_DISPLAY_ENTRIES = ["1080p", "720p", "480p", "360p"];
const PREF_QUALITY_DEFAULT = PREF_QUALITY_ENTRIES[0];
const PREF_HOSTER_EXCLUDE_KEY = "hoster_exclusion";
const PREF_SERVER_KEY = "preferred_server";
const PREF_TYPE_EXCLUDE_KEY = "type_exclusion";
const PREF_TYPE_KEY = "preferred_language";
const PREF_TYPE_DEFAULT = "Sub";
export const SCORE_POS_TOP = "top";
export const SCORE_POS_BOTTOM = "bottom";
export const SCORE_POS_NONE = "none";
const PREF_SCORE_POSITION_KEY = "score_position";
const PREF_SCORE_POSITION_DEFAULT = SCORE_POS_TOP;
const PREF_SCORE_POSITION_ENTRIES = ["Top of description", "Bottom of description", "Don't show"];
const PREF_SCORE_POSITION_VALUES = [SCORE_POS_TOP, SCORE_POS_BOTTOM, SCORE_POS_NONE];
const PREF_MARK_FILLER_KEY = "mark_fillers";
const PREF_HIDE_FILLER_KEY = "hide_fillers";
const PREF_DISCOVERED_TYPES_KEY = "discovered_types";
const PREF_DISCOVERED_HTML_SERVERS_KEY = "discovered_html_servers";
const PREF_DISCOVERED_MAPPER_SERVERS_KEY = "discovered_mapper_servers";
const PREF_SERVER_TIMESTAMPS_KEY = "server_timestamps";
const PREF_SERVER_INVALID_FLAG = "server_invalid_flag";
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

const containsIgnoreCase = (set: Iterable<string>, s: string) => [...set].some((it) => it.toLowerCase() === s.toLowerCase());
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ponytail: related titles (relatedAnimeListParse, watch-order API) and clearOldPrefs' migration of pre-lib-16 keys
// are not ported: the reader does not ask for related titles and there are no old installs to migrate.
export abstract class AnikotoTheme extends AnimeHttpSource {
  /** The constructor's hosterNames: seed/fallback server names until the site's are discovered. */
  protected abstract readonly hosterNames: string[];

  protected rateLimit = 5;

  mapperUrl = "https://mapper.nekostream.site/api";

  protected useEpisodeTitles = true;
  protected hasSourceFilter = false;
  protected hasEpisodeFilter = false;

  // ============================ Headers & Client =========================
  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Referer", `${this.baseUrl}/`);
    return h;
  }

  protected get docHeaders(): Headers {
    return this.headersBuilder();
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(this.rateLimit);
  }

  private _playlistUtils?: PlaylistUtils;
  get playlistUtils() {
    return (this._playlistUtils ??= new PlaylistUtils(this.client, this.headers));
  }

  private _extractors?: AnikotoExtractor;
  private get extractors() {
    return (this._extractors ??= new AnikotoExtractor(this));
  }

  // ============================ Discovered servers =======================
  protected get discoveredServers(): Set<string> {
    const merged = new Set([...this.preferences.getStringSet(PREF_DISCOVERED_HTML_SERVERS_KEY), ...this.preferences.getStringSet(PREF_DISCOVERED_MAPPER_SERVERS_KEY)]);
    return merged.size ? merged : new Set(this.hosterNames);
  }

  updateDiscoveredServers(rawNames: string[], isMapper: boolean) {
    const newExact = new Set(rawNames.map((it) => it.trim()).filter(Boolean));
    if (!newExact.size) return;
    const prefs = this.preferences;
    const now = Date.now();
    const serverTimestamps = new Map<string, number>();
    for (const entry of prefs.getStringSet(PREF_SERVER_TIMESTAMPS_KEY)) {
      const i = entry.indexOf("|");
      const ts = i === -1 ? NaN : Number(entry.slice(i + 1));
      if (!Number.isNaN(ts)) serverTimestamps.set(entry.slice(0, i), ts);
    }
    for (const it of newExact) serverTimestamps.set(it, now);

    const html = new Set(prefs.getStringSet(PREF_DISCOVERED_HTML_SERVERS_KEY));
    const mapper = new Set(prefs.getStringSet(PREF_DISCOVERED_MAPPER_SERVERS_KEY));
    const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
    let htmlNow = html;
    let mapperNow = mapper;
    if (isMapper) {
      const merged = new Set([...mapper, ...newExact]);
      if (!sameSet(merged, mapper)) {
        mapperNow = merged;
        prefs.edit().putStringSet(PREF_DISCOVERED_MAPPER_SERVERS_KEY, [...merged]).apply();
      }
    } else {
      const valid = new Set([...html, ...newExact].filter((s) => newExact.has(s) || now - (serverTimestamps.get(s) ?? 0) < SEVEN_DAYS_MS));
      if (!sameSet(valid, html)) {
        htmlNow = valid;
        prefs.edit().putStringSet(PREF_DISCOVERED_HTML_SERVERS_KEY, [...valid]).apply();
        this.cleanStaleExclusions(this.discoveredServers, PREF_HOSTER_EXCLUDE_KEY);
      }
    }
    const current = new Set([...htmlNow, ...mapperNow]);
    prefs.edit().putStringSet(PREF_SERVER_TIMESTAMPS_KEY, [...serverTimestamps].filter(([k]) => current.has(k)).map(([k, v]) => `${k}|${v}`)).apply();
  }

  protected seedTypes = ["Sub", "HSub", "Dub", "H-Sub", "A-Dub"];

  protected get discoveredTypes(): Set<string> {
    const saved = this.preferences.getStringSet(PREF_DISCOVERED_TYPES_KEY);
    return new Set(saved.length ? saved : this.seedTypes);
  }

  updateDiscoveredTypes(rawTypes: string[]) {
    const newTypes = rawTypes.map((it) => it.trim()).filter(Boolean);
    if (!newTypes.length) return;
    const current = this.discoveredTypes;
    const merged = new Set([...current, ...newTypes]);
    if (merged.size !== current.size) this.preferences.edit().putStringSet(PREF_DISCOVERED_TYPES_KEY, [...merged]).apply();
    this.cleanStaleExclusions(merged, PREF_TYPE_EXCLUDE_KEY);
  }

  private cleanStaleExclusions(validEntries: Set<string>, exclusionKey: string) {
    const currentExcluded = this.preferences.getStringSet(exclusionKey);
    const validExcluded = currentExcluded.filter((it) => validEntries.has(it));
    if (validExcluded.length !== currentExcluded.length) this.preferences.edit().putStringSet(exclusionKey, validExcluded).apply();
  }

  protected extractBaseServerName(rawName: string): string {
    return rawName
      .replace(/-\*\d+\s*$/, "")
      .replace(/[- ]+$/, "")
      .trim();
  }

  protected getHosterDisplayName(baseName: string): string {
    return baseName;
  }

  protected getTypeDisplayName(typeKey: string): string {
    return typeKey === "S-Sub" ? "Soft Sub" : typeKey;
  }

  get hostToggle(): Set<string> {
    const excluded = new Set(this.preferences.getStringSet(PREF_HOSTER_EXCLUDE_KEY));
    return new Set([...this.discoveredServers].filter((it) => !excluded.has(it)));
  }
  get typeToggle(): Set<string> {
    const excluded = new Set(this.preferences.getStringSet(PREF_TYPE_EXCLUDE_KEY));
    return new Set([...this.discoveredTypes].filter((it) => !excluded.has(it)));
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(toHttpUrl(this.baseUrl).newBuilder().addPathSegment("most-viewed").addPathSegment("").addQueryParameter("page", String(page)).build(), this.docHeaders);
  }

  protected popularAnimeSelector() {
    return "div.ani.items > div.item";
  }

  protected popularAnimeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    const a = element.selectFirst("a.name");
    if (a) {
      anime.url = urlWithoutDomain(a.attr("abs:href").split("?")[0].replace(EP_URL_SUFFIX_REGEX, ""));
      anime.title = this.getTitle(a);
    }
    const img = element.selectFirst(this.listingThumbnailSelector);
    if (img) anime.thumbnail_url = img.attr("data-src") || img.attr("src");
    return anime;
  }

  protected popularAnimeNextPageSelector() {
    return "nav > ul.pagination > li.active ~ li";
  }

  protected parseListing(response: Response, selector: string, fromElement: (e: Element) => SAnime, nextSelector: string): MangasPage {
    const document = response.asJsoup();
    const animes = document.select(selector).flatMap((e) => {
      try {
        return [fromElement(e)];
      } catch {
        return [];
      }
    });
    return new MangasPage(animes, document.selectFirst(nextSelector) != null);
  }

  protected popularAnimeParse(response: Response) {
    return this.parseListing(response, this.popularAnimeSelector(), (e) => this.popularAnimeFromElement(e), this.popularAnimeNextPageSelector());
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(toHttpUrl(this.baseUrl).newBuilder().addPathSegment("latest-updated").addPathSegment("").addQueryParameter("page", String(page)).build(), this.docHeaders);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.parseListing(response, this.popularAnimeSelector(), (e) => this.popularAnimeFromElement(e), this.popularAnimeNextPageSelector());
  }

  // =============================== Search ===============================
  protected searchAnimeRequest(page: number, query: string, filters: FilterList) {
    const params = AnikotoThemeFilters.getSearchParameters(filters);
    const vrf = query ? this.vrfEncrypt(query) : "";
    const { addListQueryParameter: list, addQueryParameterIfNotEmpty: ifNotEmpty } = AnikotoThemeFilters;
    const b = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("filter").addQueryParameter("keyword", query).addQueryParameter("page", String(page)).addQueryParameter("vrf", vrf);
    list(b, "genre", params.genres);
    list(b, "season", params.seasons);
    list(b, "year", params.years);
    list(b, "term_type", params.types);
    list(b, "status", params.statuses);
    list(b, "language", params.languages);
    list(b, "rating", params.ratings);
    list(b, "source", params.sources);
    ifNotEmpty(b, "ep_min", params.episodesMin);
    ifNotEmpty(b, "ep_max", params.episodesMax);
    ifNotEmpty(b, "sort", params.sort);
    return GET(b.build(), this.docHeaders);
  }

  protected searchAnimeParse(response: Response) {
    return this.parseListing(response, this.popularAnimeSelector(), (e) => this.popularAnimeFromElement(e), this.popularAnimeNextPageSelector());
  }

  override getFilterList(): FilterList {
    return AnikotoThemeFilters.getFilterList(this.hasSourceFilter, this.hasEpisodeFilter);
  }

  // =========================== Anime Details ============================
  protected animeDetailsParse(response: Response): Promise<SAnime> {
    return this.parseAnimeDetails(response.asJsoup());
  }

  protected async parseAnimeDetails(document: Document): Promise<SAnime> {
    const newDocument = await this.resolveSearchAnime(document);
    const titleElement = newDocument.selectFirst("h1.title, h2.title");
    const animeId = newDocument.selectFirst("[data-id]")?.attr("data-id") ?? newDocument.selectFirst("[data-tip]")?.attr("data-tip");
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(newDocument.location());
    if (animeId) anime.url += `#${animeId}`;
    const title = titleElement ? this.getTitle(titleElement) : "";
    if (title) anime.title = title;
    anime.genre = newDocument.select("div:contains(Genres) > span > a").eachText().join(", ");
    anime.author = newDocument.select("div:contains(Studios) > span > a").eachText().join(", ");
    anime.status = this.parseStatus(newDocument.select("div:contains(Status) > span").text());
    anime.description = this.buildDescription(newDocument, titleElement);
    if (this.detailThumbnailSelector) {
      const img = newDocument.selectFirst(this.detailThumbnailSelector);
      const url = img ? img.attr("data-src") || img.attr("src") : "";
      if (url) anime.thumbnail_url = url;
    }
    return anime;
  }

  // ============================== Episodes ==============================
  protected episodeListSelector() {
    return "div.episodes ul > li > a";
  }

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const animeId = anime.url.includes("#") ? anime.url.slice(anime.url.indexOf("#") + 1) : "";
    const animeUrl = anime.url.split("#")[0];

    let id = animeId;
    if (!id) {
      const doc = await this.resolveSearchAnime((await this.client.get(this.baseUrl + animeUrl, this.docHeaders)).asJsoup());
      id = doc.selectFirst("[data-id]")?.attr("data-id") ?? doc.selectFirst("[data-tip]")?.attr("data-tip") ?? "";
      if (!id) throw new Error("Anime ID not found");
    }

    const listHeaders = this.xhrHeaders(this.baseUrl + animeUrl);
    const response = await this.client.get(`${this.baseUrl}/ajax/episode/list/${id}?vrf=${this.vrfEncrypt(id)}`, listHeaders);
    return this.parseEpisodes(response, animeUrl);
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Not used");
  }

  private parseEpisodes(response: Response, animeUrl: string): SEpisode[] {
    try {
      const hideFiller = this.preferences.getBoolean(PREF_HIDE_FILLER_KEY, false);
      return this.resultDocument(response)
        .select(this.episodeListSelector())
        .filter((it) => !hideFiller || !this.isFiller(it))
        .map((it) => this.episodeFromElement(it, animeUrl))
        .reverse();
    } catch {
      return [];
    }
  }

  protected isFiller(element: Element): boolean {
    return element.hasClass("filler");
  }

  private episodeFromElement(element: Element, animeUrl: string): SEpisode {
    const tooltip = element.parent()?.attr("title") ?? "";
    const epNum = element.attr("data-num");
    const ids = element.attr("data-ids");
    const sub = element.attr("data-sub") === "1" ? "Sub" : "";
    const dub = element.attr("data-dub") === "1" ? "Dub" : "";
    const softSub = SOFTSUB_REGEX.test(tooltip) ? "SoftSub" : "";

    let name = element.parent()?.select("span.d-title").text() ?? "";
    if (this.useEpisodeTitles && !name && tooltip) name = tooltip.split("Release:")[0].split("Softsub")[0].trim();

    const malId = element.attr("data-mal");
    const slug = element.attr("data-slug");
    const tsText = element.attr("data-timestamp");
    const timestamp = /^-?\d+$/.test(tsText) ? Number(tsText) : null;

    const fillerTag = this.isFiller(element) && this.preferences.getBoolean(PREF_MARK_FILLER_KEY, true) ? " [Filler]" : "";

    const episode = SEpisode.create();
    episode.name = `Episode ${epNum}` + (name && name !== `Episode ${epNum}` ? `: ${name}` : "") + fillerTag;
    episode.url = `${ids}&epurl=${animeUrl.replace(EP_URL_SUFFIX_REGEX, "")}/ep-${epNum}` + (malId ? `&mal=${malId}` : "") + (slug ? `&slug=${slug}` : "") + (timestamp != null ? `&ts=${timestamp}` : "");
    episode.episode_number = Number.parseFloat(epNum) || 0;
    episode.date_upload = timestamp != null ? timestamp * 1000 : DATE_FORMATTER.tryParseDateTime(RELEASE_REGEX.exec(tooltip)?.[1]);
    episode.scanlator = [sub, softSub, dub].filter(Boolean).join(" & ");
    return episode;
  }

  // ============================ Video List ==============================
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    const prefServer = this.prefServer;
    const isServerInvalid =
      this.preferences.getBoolean(PREF_SERVER_INVALID_FLAG, false) || (prefServer !== "" && !this.discoveredServers.has(prefServer) && !this.hosterNames.includes(prefServer));
    if (isServerInvalid) {
      this.preferences.edit().putBoolean(PREF_SERVER_INVALID_FLAG, true).apply();
      throw new Error("The site's video servers have changed. Please open the extension settings to update your Preferred Server.");
    }

    const ids = episode.url.split("&")[0];
    const epUrl = substringBeforeAmp(episode.url.slice(episode.url.indexOf("epurl=") + "epurl=".length));
    const response = await this.client.get(`${this.baseUrl}/ajax/server/list?servers=${ids}`, this.xhrHeaders(this.baseUrl + epUrl));

    let document: Document;
    try {
      document = this.resultDocument(response);
    } catch {
      return [];
    }
    const servers = await this.extractors.getServerData(document, episode);
    return servers.map((server) => new AnikotoHoster(server.serverId, server.serverName, `${server.type}${INTERNAL_DATA_SEPARATOR}${epUrl}`));
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const data = (hoster as AnikotoHoster).internalData?.split(INTERNAL_DATA_SEPARATOR) ?? [];
    if (data.length !== 2) return [];
    return this.extractors.extractVideo({ type: data[0], serverId: hoster.hosterUrl, serverName: hoster.hosterName }, data[1]);
  }

  // =========================== Hoster Sort ===============================
  override sortHosters(hosters: Hoster[]): Hoster[] {
    const preferredServer = this.prefServer.toLowerCase();
    const preferredBase = this.extractBaseServerName(this.prefServer).toLowerCase();
    const sortType = this.buildTypeFallbackChain(this.prefType).map((it) => it.toLowerCase());
    const typeScore = (h: Hoster) => (sortType.includes(((h as AnikotoHoster).internalData ?? "").split(INTERNAL_DATA_SEPARATOR)[0].toLowerCase()) ? 1 : 0);
    const nameScore = (h: Hoster) => (h.hosterName.toLowerCase() === preferredServer ? 2 : this.extractBaseServerName(h.hosterName).toLowerCase() === preferredBase ? 1 : 0);
    return [...hosters].sort((a, b) => typeScore(b) - typeScore(a) || nameScore(b) - nameScore(a));
  }

  // ============================ Video Sort ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT) ?? PREF_QUALITY_DEFAULT;
    const qualitiesList = [...PREF_QUALITY_ENTRIES].reverse();
    const lastIdx = (v: Video) => qualitiesList.reduce((acc, q, i) => (v.videoTitle.includes(q) ? i : acc), -1);
    return [...videos].sort((a, b) => Number(b.videoTitle.includes(quality)) - Number(a.videoTitle.includes(quality)) || lastIdx(b) - lastIdx(a));
  }

  protected buildTypeFallbackChain(type: string): string[] {
    switch (type) {
      case "Sub":
        return ["Sub", "H-Sub", "HSub"];
      case "H-Sub":
      case "HSub":
        return ["H-Sub", "HSub"];
      case "S-Sub":
        return ["S-Sub", "Sub"];
      case "Dub":
        return ["Dub", "A-Dub"];
      case "A-Dub":
        return ["A-Dub", "Dub"];
      default:
        return [type];
    }
  }

  // =================== Protected Open Selector Properties ===============
  protected listingThumbnailSelector = "div.poster img";
  protected metaContainerSelector = "div.bmeta";
  protected scoreLabelName = "MAL";
  protected aliasContainerSelector = "div.names.font-italic";
  protected metaExclusionLabels = ["Genres", "Status", "Studios", "Producers", "MAL"];
  protected synopsisContentSelector = "div.synopsis > div.shorting > div.content";
  protected detailThumbnailSelector = "";

  // ========================= Protected Open Helpers =====================
  protected vrfEncrypt(input: string): string {
    return AnikotoUtils.vrfEncrypt(input);
  }

  xhrHeaders(referer: string): Headers {
    const h = this.headers;
    h.set("Accept", "application/json, text/javascript, */*; q=0.01");
    h.set("Referer", referer);
    h.set("X-Requested-With", "XMLHttpRequest");
    return h;
  }

  /** ResultResponse.toDocument(): the JSON's `result` HTML fragment. */
  resultDocument(response: Response): Document {
    return parseHtml(this.host.load, response.parseAs<ResultResponse>().result, this.baseUrl);
  }

  protected buildDescription(document: Document, titleElement: Element | null): string {
    const out: string[] = [];
    const enTitle = titleElement?.text() || null;
    const jpTitle = titleElement?.attr("data-jp").trim() || null;
    const metaDivs = document.select(`${this.metaContainerSelector} div.meta > div`);
    const malScore = metaDivs.find((it) => it.ownText().replace(/:$/, "").toLowerCase() === this.scoreLabelName.toLowerCase())?.select("span").text();
    const fancyScore = this.getFancyScore(malScore);
    const scorePosition = this.scorePosition;

    if (scorePosition === SCORE_POS_TOP && fancyScore) out.push(fancyScore);
    const synopsis = document.selectFirst(this.synopsisContentSelector)?.text();
    if (synopsis != null) out.push(synopsis);

    const meta = metaDivs.flatMap((div) => {
      const label = div.ownText().replace(/:$/, "").replace(/ $/, "");
      let value = div.select("span").text();
      if (label.toLowerCase() === "duration") {
        const d = value.replace(/\D/g, "");
        if (d) value = `${d} min`;
      }
      return label && value && !this.metaExclusionLabels.includes(label) ? [`${label}: ${value}`] : [];
    });
    if (meta.length) out.push(meta.join(" | "));

    const studios = document.select("div:contains(Studios) > span > a").eachText().join(", ");
    const producers = document.select("div:contains(Producers) > span > a").eachText().join(", ");
    const sp = studioLine(studios, producers);
    if (sp) out.push(sp);

    const altNames: string[] = [];
    const other = this.useEnglish() ? jpTitle : enTitle;
    if (other) altNames.push(other);
    const namesText = document.selectFirst(this.aliasContainerSelector)?.text();
    if (namesText) altNames.push(...namesText.split(";").map((it) => it.trim()).filter((it) => it && it !== jpTitle && it !== enTitle));
    if (altNames.length) out.push(`**Other name(s):** ${altNames.join(", ")}`);

    if (scorePosition === SCORE_POS_BOTTOM && fancyScore) out.push(fancyScore);
    return out.join("\n\n").trim();
  }

  protected async resolveSearchAnime(document: Document): Promise<Document> {
    if (document.location().startsWith(`${this.baseUrl}/filter?keyword=`)) {
      const foundAnimePath = document.selectFirst(this.popularAnimeSelector())?.selectFirst("a[href]")?.attr("href");
      if (!foundAnimePath) throw new Error("Search element not found");
      return (await this.client.get(this.baseUrl + urlWithoutDomain(foundAnimePath).replace(EP_URL_SUFFIX_REGEX, ""))).asJsoup();
    }
    return document;
  }

  resolveTypeLabel(typeElem: Element): string {
    const labelText = typeElem.selectFirst("label")?.text() ?? "";
    const dataType = typeElem.attr("data-type");
    const byLabel: Record<string, string> = { sub: "Sub", "h-sub": "H-Sub", hsub: "HSub", dub: "Dub", "a-dub": "A-Dub", adub: "A-Dub", "s-sub": "S-Sub" };
    const byData: Record<string, string> = { sub: "Sub", hsub: "HSub", dub: "Dub", adub: "A-Dub" };
    const l = byLabel[labelText.toLowerCase()];
    if (l) return l;
    const d = byData[dataType.toLowerCase()];
    if (d) return d;
    if (dataType === "") return labelText ? capitalize(labelText) : "Unknown";
    return capitalize(dataType);
  }

  parseServerListData(document: Document): VideoData[] {
    const typeElements = document.select("div.servers > div.type");
    this.updateDiscoveredTypes([...new Set(typeElements.map((e) => this.resolveTypeLabel(e)).filter((it) => it && it !== "Unknown"))]);
    this.updateDiscoveredServers(
      typeElements.flatMap((e) =>
        e
          .select("li")
          .filter((it) => !it.hasClass("download-icon"))
          .map((it) => it.text())
          .filter(Boolean),
      ),
      false,
    );

    const typeToggle = this.typeToggle;
    const hostToggle = this.hostToggle;
    return typeElements.flatMap((elem) => {
      const label = this.resolveTypeLabel(elem);
      if (!this.isTypeEnabled(label, typeToggle)) return [];
      return elem.select("li").flatMap((serverElement) => {
        if (serverElement.hasClass("download-icon")) return [];
        const serverId = serverElement.attr("data-link-id");
        if (!serverId) return [];
        const serverName = serverElement.text();
        if (!containsIgnoreCase(hostToggle, serverName)) return [];
        return [{ type: label, serverId, serverName }];
      });
    });
  }

  getServerDisplayName(serverName: string): string {
    return serverName.replace(/[- ]+$/, "");
  }

  mapMapperServerName(key: string): string {
    const k = key.toLowerCase();
    if (k === "gogoanime") return "Vidstream";
    if (k === "anivibe") return "Vibe-Stream";
    if (k === "animepahe") return "Kiwi-Stream";
    if (k.startsWith("kiwi-stream")) return "Kiwi-Stream";
    return capitalize(key);
  }

  cleanHlsQuality(quality: string): string {
    return quality.split(" (")[0].split(" - ")[0];
  }

  isTypeEnabled(label: string, typeSelection: Set<string>): boolean {
    return containsIgnoreCase(typeSelection, label);
  }

  // ============================ Shared Utilities ========================
  protected getTitle(element: Element): string {
    const enTitle = element.text() || null;
    const jpTitle = element.attr("data-jp").trim() || null;
    return (this.useEnglish() ? (enTitle ?? jpTitle) : (jpTitle ?? enTitle)) ?? element.text();
  }

  protected parseStatus(statusString: string): number {
    switch (statusString.toLowerCase()) {
      case "ongoing anime":
      case "currently airing":
        return SAnime.ONGOING;
      case "finished airing":
      case "completed":
        return SAnime.COMPLETED;
      default:
        return SAnime.UNKNOWN;
    }
  }

  protected getFancyScore(score: string | null | undefined): string {
    if (!score?.trim()) return "";
    const n = Number(score);
    if (!Number.isFinite(n) || n <= 0) return "";
    // BigDecimal.divide(2, 0, HALF_UP)
    const stars = Math.min(Math.max(Math.round(n / 2 + 1e-9), 0), 5);
    return "★".repeat(stars) + "☆".repeat(5 - stars) + " " + String(n);
  }

  protected useEnglish() {
    return this.preferences.getString(PREF_TITLE_LANG_KEY, PREF_TITLE_LANG_DEFAULT) === "English";
  }
  protected get prefServer(): string {
    return this.preferences.getString(PREF_SERVER_KEY, this.hosterNames[0] ?? "") ?? "";
  }
  protected get prefType(): string {
    return this.preferences.getString(PREF_TYPE_KEY, PREF_TYPE_DEFAULT) ?? PREF_TYPE_DEFAULT;
  }
  protected get scorePosition(): string {
    return this.preferences.getString(PREF_SCORE_POSITION_KEY, PREF_SCORE_POSITION_DEFAULT) ?? PREF_SCORE_POSITION_DEFAULT;
  }

  // ============================== Preferences ===========================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    if (this.preferences.getBoolean(PREF_SERVER_INVALID_FLAG, false)) {
      this.preferences
        .edit()
        .putBoolean(PREF_SERVER_INVALID_FLAG, false)
        .putString(PREF_SERVER_KEY, [...this.discoveredServers][0] ?? this.hosterNames[0] ?? "")
        .apply();
    }
    const list = (key: string, title: string, entries: string[], values: string[], def: string) => {
      const p = new ListPreference(screen.context);
      p.key = key;
      p.title = title;
      p.entries = entries;
      p.entryValues = values;
      p.setDefaultValue(def);
      p.summary = "%s";
      screen.addPreference(p);
    };
    const servers = [...this.discoveredServers];
    const types = [...this.discoveredTypes];
    const typeEntries = types.map((it) => this.getTypeDisplayName(it));

    list(PREF_TITLE_LANG_KEY, "Preferred Title Language", PREF_TITLE_LANG_ENTRIES, PREF_TITLE_LANG_ENTRIES, PREF_TITLE_LANG_DEFAULT);
    list(PREF_QUALITY_KEY, "Preferred Quality", PREF_QUALITY_DISPLAY_ENTRIES, PREF_QUALITY_ENTRIES, PREF_QUALITY_DEFAULT);
    list(PREF_SERVER_KEY, "Preferred Server", servers.map((it) => this.getHosterDisplayName(it)), servers, servers[0] ?? "");
    list(PREF_TYPE_KEY, "Preferred Type", typeEntries, types, PREF_TYPE_DEFAULT);
    list(PREF_SCORE_POSITION_KEY, "Score Display Position", PREF_SCORE_POSITION_ENTRIES, PREF_SCORE_POSITION_VALUES, PREF_SCORE_POSITION_DEFAULT);

    const sw = (key: string, title: string, summary: string, def: boolean) => {
      const p = new SwitchPreferenceCompat(screen.context);
      p.key = key;
      p.title = title;
      p.summary = summary;
      p.setDefaultValue(def);
      screen.addPreference(p);
    };
    sw(PREF_MARK_FILLER_KEY, "Mark Filler Episodes", "Mark filler episodes in the episode list", true);
    sw(PREF_HIDE_FILLER_KEY, "Hide Filler Episodes", "Hides detected filler episodes from episode list", false);

    const multi = (key: string, title: string, summary: string, entries: string[], values: string[]) => {
      const p = new MultiSelectListPreference(screen.context);
      p.key = key;
      p.title = title;
      p.summary = summary;
      p.entries = entries;
      p.entryValues = values;
      p.setDefaultValue([]);
      screen.addPreference(p);
    };
    multi(PREF_HOSTER_EXCLUDE_KEY, "Exclude Servers", "Choose which exact servers you want to exclude", servers.map((it) => this.getHosterDisplayName(it)), servers);
    multi(PREF_TYPE_EXCLUDE_KEY, "Exclude Types", "Choose which video types you want to exclude", typeEntries, types);
  }
}

const substringBeforeAmp = (s: string) => s.split("&")[0];

export function studioLine(studios: string, producers: string): string | null {
  if (studios && producers) return `**Studio:** ${studios} (**Producers:** ${producers})`;
  if (studios) return `**Studio:** ${studios}`;
  if (producers) return `**Producers:** ${producers}`;
  return null;
}

// =============================== Extractor ==============================
const MEGAPLAY_AES_KEY = "i?LMTAx0Q6,:}50U";
const MEGAPLAY_AES_IV = "W0;27ToaUpl_P%'c";
const MEGAPLAY_TOKEN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
const MEGAPLAY_HOST_REGEX = /megaplay\.[^/]+\/stream\//i;
const DATA_ID_REGEX = /data-id=["']([^"']+)["']/i;
const FILE_ID_REGEX = /File\s+(\d+)/i;
const FILE_JSON_REGEX = /"file"\s*:\s*"([^"]+)"/;
const TOKEN_PARAM_REGEX = /[?&]token=/i;
const PATH_KEY_REGEX = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i;
const HOST_MAP_REGEX = /var HOST_MAP\s*=\s*\{([^}]+)\}/;
const HOST_ENTRY_REGEX = /'([^']+)'\s*:\s*'([^']+)'/g;

const b64UrlNoPad = (b: Uint8Array) => b64UrlSafe(b).replace(/=+$/, "");
const param = (url: string, key: string) => {
  const m = new RegExp(`&${key}=([^&]*)`).exec(url);
  return m?.[1] ?? "";
};

export class AnikotoExtractor {
  constructor(private readonly theme: AnikotoTheme) {}

  async getServerData(document: Document, episode: SEpisode): Promise<VideoData[]> {
    return [...this.theme.parseServerListData(document), ...(await this.fetchMapperServers(episode))];
  }

  private async getEmbedLink(serverId: string, epUrl: string): Promise<string> {
    const t = this.theme;
    const response = await t.client.get(`${t.baseUrl}/ajax/server?get=${serverId}`, t.xhrHeaders(t.baseUrl + epUrl));
    if (!response.isSuccessful) throw new Error(`Server API returned HTTP ${response.code}`);
    return response.parseAs<ServerResponseDto>().result.url;
  }

  private async fetchMapperServers(episode: SEpisode): Promise<VideoData[]> {
    const t = this.theme;
    const malId = param(episode.url, "mal");
    const slug = param(episode.url, "slug");
    const ts = param(episode.url, "ts");
    if (!malId || !slug || !ts) return [];
    try {
      const mapperHeaders = t.headers;
      mapperHeaders.set("Accept", "application/json, text/javascript, */*; q=0.01");
      mapperHeaders.set("Referer", `${t.baseUrl}/`);
      mapperHeaders.set("Origin", t.baseUrl);
      const mapperJson = (await t.client.get(`${t.mapperUrl}/mal/${malId}/${slug}/${ts}`, mapperHeaders)).parseAs<Record<string, MapperServerDto | null>>();
      const keys = Object.keys(mapperJson).filter((k) => k.toLowerCase() !== "status");
      t.updateDiscoveredServers(
        keys.map((k) => t.mapMapperServerName(k)),
        true,
      );
      t.updateDiscoveredTypes(["H-Sub", "A-Dub"]);

      const hostToggle = t.hostToggle;
      const typeToggle = t.typeToggle;
      const servers: VideoData[] = [];
      for (const key of keys) {
        const serverDto = mapperJson[key];
        const serverName = t.mapMapperServerName(key);
        for (const [typeKey, typeLabel] of [["sub", "H-Sub"], ["dub", "A-Dub"]] as const) {
          const linkId = serverDto?.[typeKey]?.url;
          if (!linkId?.trim()) continue;
          if (!hostToggle.has(serverName)) continue;
          if (!t.isTypeEnabled(typeLabel, typeToggle)) continue;
          servers.push({ type: typeLabel, serverId: linkId, serverName });
        }
      }
      return servers;
    } catch {
      return [];
    }
  }

  // ponytail: upstream's mpv/ffmpeg force_mpegts args and intro/outro timestamps have no field on this Video; dropped.
  async extractVideo(server: VideoData, epUrl: string): Promise<Video[]> {
    try {
      const embedLink = server.serverId.startsWith("http") ? server.serverId : await this.getEmbedLink(server.serverId, epUrl);
      if (this.isMegaPlayServer(server.serverName) || MEGAPLAY_HOST_REGEX.test(embedLink)) return await this.extractFromMegaPlay(embedLink, server);
      if (embedLink.includes("mewcdn.online/player/plyr.php")) return await this.extractFromMewcdnPlayer(embedLink, server);
      if (embedLink.endsWith(".m3u8") || (embedLink.includes(".m3u8") && !embedLink.includes("/stream/"))) return await this.extractDirectM3u8(embedLink, server);
      return [];
    } catch {
      return [];
    }
  }

  // ======================== MegaPlay ========================
  private isMegaPlayServer(serverName: string): boolean {
    const name = serverName.toLowerCase().replace(/[ -]/g, "");
    return name.includes("vidstream") || name.includes("hd1") || name.includes("hd2");
  }

  private nameGen(server: VideoData) {
    const displayName = this.theme.getServerDisplayName(server.serverName);
    const typeSuffix = server.type ? ` - ${server.type}` : "";
    return (quality: string) => `${displayName}${typeSuffix} - ${this.theme.cleanHlsQuality(quality)}`;
  }

  private async extractFromMegaPlay(embedUrl: string, server: VideoData): Promise<Video[]> {
    const t = this.theme;
    const pageHeaders = t.headers;
    pageHeaders.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    pageHeaders.set("X-Requested-With", "XMLHttpRequest");
    pageHeaders.set("Referer", `${t.baseUrl}/`);
    const page = await t.client.get(embedUrl, pageHeaders);
    if (!page.isSuccessful) throw new Error(`MegaPlay page failed: HTTP ${page.code}`);
    const pageBody = page.text();

    const mediaId = DATA_ID_REGEX.exec(pageBody)?.[1]?.trim() || FILE_ID_REGEX.exec(pageBody)?.[1];
    if (!mediaId) throw new Error("Failed to find MegaPlay media ID");

    const apiHeaders = t.headers;
    apiHeaders.set("Accept", "application/json,*/*");
    apiHeaders.set("X-Requested-With", "XMLHttpRequest");
    apiHeaders.set("Referer", embedUrl);
    const res = await t.client.get(this.buildMegaPlayGetSourcesUrl(embedUrl, mediaId), apiHeaders);
    if (!res.isSuccessful) throw new Error(`MegaPlay getSources failed: HTTP ${res.code}`);
    const sourcesDto = res.parseAs<MegaPlaySourcesDto>();

    const m3u8 = await this.processMegaPlaySource(sourcesDto.enc, megaPlaySourcesField(sourcesDto.sources));
    if (!m3u8) throw new Error("Failed to decrypt/find MegaPlay source");

    const tracks = (sourcesDto.tracks ?? []).filter((it) => it.label?.trim()).map((it) => new Track(it.file, it.label!));
    let host = "megaplay.buzz";
    try {
      host = new URL(embedUrl).host;
    } catch {
      /* keep the default */
    }
    const vidHeaders = t.headers;
    vidHeaders.set("Referer", `https://${host}/`);
    vidHeaders.set("Origin", `https://${host}`);
    return t.playlistUtils.extractFromHls(m3u8, { videoNameGen: this.nameGen(server), subtitleList: tracks, referer: `https://${host}/`, masterHeaders: vidHeaders, videoHeaders: vidHeaders });
  }

  private buildMegaPlayGetSourcesUrl(embedUrl: string, id: string): string {
    let base = "https://megaplay.buzz/stream/getSources";
    let s: string | null = null;
    try {
      const u = new URL(embedUrl);
      base = `${u.protocol}//${u.host}/stream/getSources`;
      s = u.searchParams.get("s");
    } catch {
      /* keep the default */
    }
    const b = toHttpUrl(base).newBuilder().addQueryParameter("id", id);
    if (s != null) b.addQueryParameter("s", s);
    return b.build().toString();
  }

  private async processMegaPlaySource(enc: string | null | undefined, source: string | null): Promise<string | null> {
    let m3u8: string | null = null;
    let wasDecrypted = false;
    if (enc?.trim()) {
      try {
        const keyBytes = new Uint8Array(32);
        keyBytes.set(utf8(MEGAPLAY_AES_KEY).subarray(0, 32));
        const encrypted = Base64.decode(enc);
        if (encrypted.length && encrypted.length % 16 === 0) {
          const json = fromUtf8(await aesCbcDecrypt(keyBytes, utf8(MEGAPLAY_AES_IV), encrypted));
          const fileMatch = FILE_JSON_REGEX.exec(json);
          if (fileMatch) {
            m3u8 = fileMatch[1];
            wasDecrypted = true;
          }
        }
      } catch {
        /* fall back to the plain source */
      }
    }
    if (!m3u8?.trim()) m3u8 = source;
    if (!m3u8?.trim()) return null;
    if (!wasDecrypted || TOKEN_PARAM_REGEX.test(m3u8)) return m3u8;

    const match = PATH_KEY_REGEX.exec(m3u8);
    if (!match) return m3u8;
    const pathKey = `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
    const expiry = Math.floor(Date.now() / 1000) + 90;
    const payload = `${expiry}|${pathKey}`;
    try {
      const signature = b64UrlNoPad(await hmacSha256(MEGAPLAY_TOKEN_SECRET, payload));
      const token = `${b64UrlNoPad(utf8(payload))}.${signature}`;
      return toHttpUrl(m3u8).newBuilder().setQueryParameter("token", token).build().toString();
    } catch {
      return m3u8;
    }
  }

  // ======================== Other paths ========================
  private extractDirectM3u8(m3u8Url: string, server: VideoData, referer = `${this.theme.baseUrl}/`): Promise<Video[]> {
    const vidHeaders = this.theme.headers;
    vidHeaders.set("Referer", referer);
    return this.theme.playlistUtils.extractFromHls(m3u8Url, { videoNameGen: this.nameGen(server), referer, masterHeaders: vidHeaders, videoHeaders: vidHeaders });
  }

  private async extractFromMewcdnPlayer(serverUrl: string, server: VideoData): Promise<Video[]> {
    const t = this.theme;
    const fragment = serverUrl.includes("#") ? serverUrl.split("#")[1] : "";
    if (!fragment) throw new Error("No fragment found in mewcdn player URL");
    const rawM3u8 = fromUtf8(Base64.decode(fragment)).trim();
    if (!rawM3u8.startsWith("http")) throw new Error("Invalid m3u8 URL decoded from mewcdn fragment");

    const pageHeaders = t.headers;
    pageHeaders.set("Referer", `${t.baseUrl}/`);
    const html = (await t.client.get(serverUrl, pageHeaders)).text();
    const mapMatch = HOST_MAP_REGEX.exec(html);
    let m3u8 = rawM3u8;
    for (const [, origin, proxy] of mapMatch ? mapMatch[1].matchAll(HOST_ENTRY_REGEX) : []) {
      if (m3u8.includes(origin)) {
        m3u8 = m3u8.replaceAll(origin, proxy);
        break;
      }
    }

    const vidHeaders = t.headers;
    vidHeaders.set("Referer", "https://mewcdn.online/");
    vidHeaders.set("Origin", "https://mewcdn.online");
    return t.playlistUtils.extractFromHls(m3u8, { videoNameGen: this.nameGen(server), referer: "https://mewcdn.online/", masterHeaders: vidHeaders, videoHeaders: vidHeaders });
  }
}
