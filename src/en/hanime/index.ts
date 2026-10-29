// Port of yuzono/anime-extensions src/en/hanime (Hanime.kt, DataModel.kt, SignatureProvider.kt,
// NativeSignatureProvider.kt, HandshakeCipher.kt).
// Only the default "native" signature provider is ported (a plain SHA-256 of the timestamp and two salts). The
// "webview" (WebViewSignatureProvider) and "wasm" (Chicory runtime over the site's WASM) providers compute the same
// signature by running site code, which bundles must not do, so the Signature provider preference is left out.
import {
  AnimeHttpSource,
  Base64,
  concat,
  Filter,
  FilterList,
  GET,
  Hoster,
  ListPreference,
  MangasPage,
  POST,
  SAnime,
  SEpisode,
  toHex,
  urlWithoutDomain,
  utf8,
  fromUtf8,
  Video,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { PlaylistUtils } from "../../../libs/playlistutils/index.ts";

/** Guest search API (v11) — returns the full catalog wrapped in `{"data": [...]}`. */
const SEARCH_URL = "https://guest.freeanimehentai.net/api/v11/search_hvs";
/** Auth API host for the v11 handshake endpoint. */
const AUTH_BASE_URL = "https://auth.hanime.tv";

const PREF_QUALITY_KEY = "preferred_quality";
const PREF_QUALITY_DEFAULT = "1080p";
const QUALITY_LIST = ["1080p", "720p", "480p", "360p"];

const PREF_CACHE_TTL_KEY = "cache_duration";
const PREF_CACHE_TTL_DEFAULT = "10";
const CACHE_TTL_LIST = ["1", "5", "10", "30"];

const PREF_EP_TITLE_FORMAT_KEY = "episode_title_format";
const EP_TITLE_FORMAT_ENTRIES = ["Clean (Episode N)", "Full (Series Name N)"];
const EP_TITLE_FORMAT_LIST = ["clean", "full"];
const PREF_EP_TITLE_FORMAT_DEFAULT = EP_TITLE_FORMAT_LIST[0];

const HTML_TAG_REGEX = /<[^>]*>/g;
const EPISODE_SUFFIX_REGEX = /\s(\d{1,3})$/;
const SEASON_PATTERN_REGEX = /\s+Season\s+(\d{1,3})$/i;
const EP_PATTERN_REGEX = /\s+Ep\s+(\d{1,3})$/i;
const TRAILING_NUMBER_REGEX = /\s+(\d{1,3})$/;
const PREFIX_REGEX = /[\s\-×x]$/i;
const QUALITY_RESOLUTION_REGEX = /(\d+)p/;

const PAGE_SIZE = 24;

// ── DataModel ──────────────────────────────────────────────────────────
interface SearchResponse {
  data?: HitsModel[];
}
interface HitsModel {
  id?: number;
  name?: string;
  slug?: string;
  description?: string | null;
  views?: number | null;
  cover_url?: string | null;
  brand?: string | null;
  likes?: number | null;
  tags?: string[];
  created_at_unix?: number | null;
  released_at_unix?: number | null;
}
interface HandshakePayload {
  sources?: HandshakeSource[];
}
interface HandshakeSource {
  src?: string;
  height?: number | null;
  label?: string | null;
  /** "normal" for playable streams, "promotion" for ad/premium placeholders. */
  kind?: string | null;
}

// ── NativeSignatureProvider: SHA256("${t},Xkdi29,https://hanime.tv,mn2,${t}") ──
interface Signature {
  signature: string;
  time: string;
}
async function getSignature(): Promise<Signature> {
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp},Xkdi29,https://hanime.tv,mn2,${timestamp}`;
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", utf8(input) as BufferSource),
  );
  return { signature: toHex(hash), time: String(timestamp) };
}
/** SignatureHeaders.build */
const signatureHeaders = (s: Signature): Record<string, string> => ({
  "x-signature": s.signature,
  "x-time": s.time,
  "x-signature-version": "web2",
  "x-session-token": "",
  "x-user-license": "",
  "x-csrf-token": "",
  "x-license": "",
});

// ── HandshakeCipher: AES-256-GCM, key SHA-256("htv-insecure-handshake-v1"), AAD "htv-insecure-v1" ──
const AAD = utf8("htv-insecure-v1");
let keyPromise: Promise<CryptoKey> | null = null;
const handshakeKey = () =>
  (keyPromise ??= crypto.subtle
    .digest("SHA-256", utf8("htv-insecure-handshake-v1") as BufferSource)
    .then((raw) =>
      crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]),
    ));

const HandshakeCipher = {
  async seal(payload: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // WebCrypto's GCM output is ciphertext || tag, as JCA's: split them for the envelope
    const ctWithTag = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: AAD as BufferSource,
          tagLength: 128,
        },
        await handshakeKey(),
        utf8(payload) as BufferSource,
      ),
    );
    const envelope = JSON.stringify({
      v: 1,
      alg: "AES-256-GCM",
      iv: Base64.encode(iv),
      tag: Base64.encode(ctWithTag.subarray(ctWithTag.length - 16)),
      data: Base64.encode(ctWithTag.subarray(0, ctWithTag.length - 16)),
    });
    return Base64.encode(utf8(envelope));
  },
  async open(token: string): Promise<string> {
    const envelope = JSON.parse(fromUtf8(Base64.decode(token))) as {
      iv: string;
      tag: string;
      data: string;
    };
    const iv = Base64.decode(envelope.iv);
    if (iv.length !== 12) throw new Error(`Unexpected IV length: ${iv.length}`);
    const data = concat(
      Base64.decode(envelope.data),
      Base64.decode(envelope.tag),
    );
    return fromUtf8(
      new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: iv as BufferSource,
            additionalData: AAD as BufferSource,
            tagLength: 128,
          },
          await handshakeKey(),
          data as BufferSource,
        ),
      ),
    );
  },
};

// ── Filters ────────────────────────────────────────────────────────────
class Tag extends Filter.TriState {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(name);
  }
}
class Brand extends Filter.CheckBox {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(name);
  }
}
class TagList extends Filter.Group<Tag> {
  constructor(tags: Tag[]) {
    super("Tags", tags);
  }
}
class BrandList extends Filter.Group<Brand> {
  constructor(brands: Brand[]) {
    super("Brands", brands);
  }
}
class TagInclusionMode extends Filter.Select<string> {
  constructor() {
    super("Included tags mode", ["And", "Or"], 0);
  }
}
class SortFilter extends Filter.Sort {
  constructor(sortables: string[]) {
    super("Sort", sortables, { index: 2, ascending: false });
  }
}

const sortableList: [string, string][] = [
  ["Uploads", "created_at_unix"],
  ["Views", "views"],
  ["Likes", "likes"],
  ["Release", "released_at_unix"],
  ["Alphabetical", "title_sortable"],
];

interface SearchParameters {
  query?: string;
  includedTags?: string[];
  blackListedTags?: string[];
  brands?: string[];
  tagsMode?: string;
  orderBy?: string;
  ordering?: string;
}

function getSearchParameters(filters: FilterList): SearchParameters {
  const p = {
    includedTags: [] as string[],
    blackListedTags: [] as string[],
    brands: [] as string[],
    tagsMode: "AND",
    orderBy: "likes",
    ordering: "desc",
  };
  for (const filter of filters) {
    if (filter instanceof TagList) {
      for (const tag of filter.state) {
        if (tag.isIncluded()) p.includedTags.push(tag.id.toLowerCase());
        else if (tag.isExcluded()) p.blackListedTags.push(tag.id.toLowerCase());
      }
    } else if (filter instanceof TagInclusionMode) {
      p.tagsMode = filter.values[filter.state].toUpperCase();
    } else if (filter instanceof SortFilter) {
      if (filter.state != null) {
        p.orderBy = sortableList[filter.state.index][1];
        p.ordering = filter.state.ascending ? "asc" : "desc";
      }
    } else if (filter instanceof BrandList) {
      for (const brand of filter.state)
        if (brand.state) p.brands.push(brand.id.toLowerCase());
    }
  }
  return p;
}

// ── Helpers ────────────────────────────────────────────────────────────
function getTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.includes(" Ep ")) return trimmed.split(" Ep ")[0].trim();
  // Only strip trailing number if it's a standalone episode number (1-3 digits at the end, preceded by a space)
  const match = EPISODE_SUFFIX_REGEX.exec(trimmed);
  if (!match) return trimmed;
  const beforeNumber = trimmed.slice(0, match.index);
  // Don't strip if the number is part of "Season N", or of a compound like "x 3" or "- 3"
  if (/Season$/i.test(beforeNumber.trimEnd())) return trimmed;
  if (PREFIX_REGEX.test(beforeNumber)) return trimmed;
  return beforeNumber.trim();
}

function formatEpisodeTitle(
  rawName: string | undefined,
  seriesName: string,
  index: number,
  format: string,
): string {
  const fallback = `Episode ${index + 1}`;
  if (rawName == null) return fallback;
  if (format === "full") return rawName;
  const trimmed = rawName.trim();
  const seasonMatch = SEASON_PATTERN_REGEX.exec(trimmed);
  if (seasonMatch) return `Season ${seasonMatch[1]} - ${fallback}`;
  const epMatch = EP_PATTERN_REGEX.exec(trimmed);
  if (epMatch) return `Episode ${epMatch[1]}`;
  const numMatch = TRAILING_NUMBER_REGEX.exec(trimmed);
  if (
    numMatch &&
    trimmed.slice(0, numMatch.index).trim().toLowerCase() ===
      seriesName.toLowerCase()
  )
    return `Episode ${numMatch[1]}`;
  return trimmed;
}

function parseEpisodeNumber(
  rawName: string | undefined,
  seriesName: string,
  fallback: number,
): number {
  if (rawName == null) return fallback;
  const trimmed = rawName.trim();
  if (SEASON_PATTERN_REGEX.test(trimmed)) return fallback;
  const epMatch = EP_PATTERN_REGEX.exec(trimmed);
  if (epMatch) return Number(epMatch[1]);
  const numMatch = TRAILING_NUMBER_REGEX.exec(trimmed);
  if (
    numMatch &&
    trimmed.slice(0, numMatch.index).trim().toLowerCase() ===
      seriesName.toLowerCase()
  )
    return Number(numMatch[1]);
  return fallback;
}

/** Handles both the current `/videos/hentai/{slug}` scheme and legacy `...?id={slug}&hvid=N` URLs. */
function extractSlugFromUrl(url: string): string {
  if (url.includes("id="))
    return url.slice(url.indexOf("id=") + 3).split("&")[0];
  const path = url.split("?")[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

function hitToAnime(item: HitsModel): SAnime {
  const anime = SAnime.create();
  anime.title = getTitle(item.name ?? "");
  anime.thumbnail_url = item.cover_url ?? undefined;
  anime.author = item.brand ?? undefined;
  anime.description = item.description?.replace(HTML_TAG_REGEX, "");
  anime.status = SAnime.UNKNOWN;
  anime.genre = (item.tags ?? []).join(", ");
  anime.initialized = true;
  anime.url = urlWithoutDomain(`https://hanime.tv/videos/hentai/${item.slug}`);
  return anime;
}

const distinctBy = <T>(items: T[], key: (t: T) => string) => {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = key(it);
    return !seen.has(k) && !!seen.add(k);
  });
};

export default class Hanime extends AnimeHttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    return new Headers({
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "content-type": "application/json",
      Origin: "https://hanime.tv",
      Referer: "https://hanime.tv/",
      "sec-ch-ua":
        '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Android"',
    });
  }

  /** Headers for video stream requests (m3u8, segments, AES key). */
  private videoHeaders(): Headers {
    const h = this.headers;
    h.set("Referer", "https://player.hanime.tv/");
    h.set("Origin", "https://player.hanime.tv");
    return h;
  }

  // ── Search API: the whole catalog in one response, cached; pagination and filtering are client-side ──
  private cachedSearchHits: HitsModel[] | null = null;
  private cachedSearchHitsTimestamp = 0;
  private inflight: Promise<HitsModel[]> | null = null;

  private get searchHitsTtlMs() {
    return (
      (Number(
        this.preferences.getString(PREF_CACHE_TTL_KEY, PREF_CACHE_TTL_DEFAULT),
      ) || 10) *
      60 *
      1000
    );
  }

  private fetchSearchHits(): Promise<HitsModel[]> {
    if (
      this.cachedSearchHits &&
      Date.now() - this.cachedSearchHitsTimestamp < this.searchHitsTtlMs
    )
      return Promise.resolve(this.cachedSearchHits);
    // one fetch at a time (the searchCacheMutex upstream)
    return (this.inflight ??= (async () => {
      try {
        const searchHeaders = this.headers;
        for (const [k, v] of Object.entries(
          signatureHeaders(await getSignature()),
        ))
          searchHeaders.set(k, v);
        const text = (
          await this.client.execute(GET(SEARCH_URL, searchHeaders))
        ).text();
        const result = text
          ? ((JSON.parse(text) as SearchResponse).data ?? [])
          : [];
        this.cachedSearchHits = result;
        this.cachedSearchHitsTimestamp = Date.now();
        return result;
      } finally {
        this.inflight = null;
      }
    })());
  }

  private paginateHits(
    hits: HitsModel[],
    page: number,
    o: SearchParameters = {},
  ): MangasPage {
    const {
      query = "",
      includedTags = [],
      blackListedTags = [],
      brands = [],
      tagsMode = "OR",
      orderBy = "likes",
      ordering = "desc",
    } = o;
    const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
    let filtered = hits;
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (hit) =>
          lc(hit.name).includes(q) ||
          (hit.tags ?? []).some((t) => lc(t).includes(q)) ||
          (hit.brand != null && lc(hit.brand).includes(q)),
      );
    }
    if (includedTags.length) {
      const isAndMode = tagsMode.toLowerCase() === "and";
      const has = (hit: HitsModel, tag: string) =>
        (hit.tags ?? []).some((t) => lc(t) === tag);
      filtered = filtered.filter((hit) =>
        isAndMode
          ? includedTags.every((t) => has(hit, t))
          : includedTags.some((t) => has(hit, t)),
      );
    }
    if (blackListedTags.length)
      filtered = filtered.filter(
        (hit) =>
          !blackListedTags.some((tag) =>
            (hit.tags ?? []).some((t) => lc(t) === tag),
          ),
      );
    if (brands.length)
      filtered = filtered.filter(
        (hit) => hit.brand != null && brands.includes(lc(hit.brand)),
      );

    const key: (h: HitsModel) => number | string =
      orderBy === "views"
        ? (h) => h.views ?? 0
        : orderBy === "created_at_unix" || orderBy === "published_at_unix"
          ? (h) => h.created_at_unix ?? 0
          : orderBy === "released_at_unix"
            ? (h) => h.released_at_unix ?? 0
            : orderBy === "title_sortable"
              ? (h) => lc(h.name)
              : (h) => h.likes ?? 0;
    const desc = (a: HitsModel, b: HitsModel) => {
      const x = key(a),
        y = key(b);
      return x < y ? 1 : x > y ? -1 : 0;
    };
    const sorted = [...filtered].sort(
      ordering === "asc" ? (a, b) => -desc(a, b) : desc,
    );

    // Deduplicate by series BEFORE slicing so each series appears only once across pages
    const uniqueSeries = distinctBy(sorted, (h) => getTitle(h.name ?? ""));
    const fromIndex = (page - 1) * PAGE_SIZE;
    const pageItems = uniqueSeries.slice(fromIndex, fromIndex + PAGE_SIZE);
    return new MangasPage(
      pageItems.map(hitToAnime),
      fromIndex + PAGE_SIZE < uniqueSeries.length,
    );
  }

  // ── Popular / Latest / Search ──
  override async fetchPopularManga(page: number) {
    return this.paginateHits(await this.fetchSearchHits(), page, {
      orderBy: "likes",
      ordering: "desc",
    });
  }
  override async fetchLatestUpdates(page: number) {
    return this.paginateHits(await this.fetchSearchHits(), page, {
      orderBy: "created_at_unix",
      ordering: "desc",
    });
  }
  override async getSearchAnime(
    page: number,
    query: string,
    filters: FilterList,
  ) {
    const params = getSearchParameters(filters);
    return this.paginateHits(await this.fetchSearchHits(), page, {
      ...params,
      query,
    });
  }

  protected popularAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected popularAnimeParse(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(): never {
    throw new Error("Not used");
  }
  protected searchAnimeRequest(): never {
    throw new Error("Not used");
  }
  protected searchAnimeParse(): never {
    throw new Error("Not used");
  }
  protected animeDetailsParse(): never {
    throw new Error("Not used");
  }
  protected episodeListParse(): never {
    throw new Error("Not used");
  }

  // ── Anime Details: built from the cached search dataset (the site is JS-rendered) ──
  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const slug = extractSlugFromUrl(anime.url);
    const hit = (await this.fetchSearchHits()).find((it) => it.slug === slug);
    return hit ? hitToAnime(hit) : anime;
  }

  // ── Episode List: videos that share the series title ──
  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const hits = await this.fetchSearchHits();
    const slug = extractSlugFromUrl(anime.url);
    const current = hits.find((it) => it.slug === slug);
    if (!current) {
      const ep = SEpisode.create();
      ep.episode_number = 1;
      ep.name = anime.title;
      ep.url = urlWithoutDomain(`https://hanime.tv/videos/hentai/${slug}`);
      return [ep];
    }
    const seriesName = getTitle(current.name ?? "");
    const titleFormat =
      this.preferences.getString(
        PREF_EP_TITLE_FORMAT_KEY,
        PREF_EP_TITLE_FORMAT_DEFAULT,
      ) ?? PREF_EP_TITLE_FORMAT_DEFAULT;
    const date = (h: HitsModel) => h.created_at_unix ?? h.released_at_unix ?? 0;
    return hits
      .filter((it) => getTitle(it.name ?? "") === seriesName)
      .sort((a, b) => date(b) - date(a))
      .map((hit, idx) => {
        const ep = SEpisode.create();
        ep.episode_number = parseEpisodeNumber(hit.name, seriesName, idx + 1);
        ep.name = formatEpisodeTitle(hit.name, seriesName, idx, titleFormat);
        ep.date_upload = date(hit) * 1000;
        ep.url = urlWithoutDomain(
          `https://hanime.tv/videos/hentai/${hit.slug}`,
        );
        return ep;
      });
  }

  // ── Video List: POST /api/v11/handshake on auth.hanime.tv ──
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(episode.url, this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const slug = extractSlugFromUrl(hoster.hosterUrl);
    const signature = await getSignature();
    const token = await HandshakeCipher.seal(
      JSON.stringify({
        timestamp_unix: Number(signature.time),
        directive: "htv_player_handshake",
        slug,
      }),
    );

    const requestHeaders = this.headers;
    requestHeaders.set("x-signature-version", "web2");
    requestHeaders.set("x-signature", signature.signature);
    requestHeaders.set("x-time", signature.time);
    requestHeaders.set("x-csrf-token", "null");

    const response = await this.client.execute(
      POST(
        `${AUTH_BASE_URL}/api/v11/handshake`,
        requestHeaders,
        JSON.stringify({ token }),
        "application/json",
      ),
    );
    if (!response.isSuccessful)
      throw new Error(`Handshake failed (HTTP ${response.code})`);
    const xToken = response.header("x-token");
    if (!xToken) throw new Error("Handshake response has no x-token");

    const payload = JSON.parse(
      await HandshakeCipher.open(xToken),
    ) as HandshakePayload;
    const playerHeaders = this.videoHeaders();
    const playlistUtils = new PlaylistUtils(this.client, this.headers);
    const lists = await Promise.all(
      (payload.sources ?? [])
        .filter((it) => it.kind === "normal" && it.src)
        .map((stream) => {
          const streamUrl = stream.src!.startsWith("http")
            ? stream.src!
            : this.baseUrl.replace(/\/+$/, "") + stream.src!;
          const name = stream.label ?? `${stream.height ?? "?"}p`;
          // one rendition per source, so the playlist is the video: name it by the source's height
          return playlistUtils
            .extractFromHls(streamUrl, {
              masterHeaders: playerHeaders,
              videoHeaders: playerHeaders,
              videoNameGen: () => name,
            })
            .catch(() => [
              new Video({
                videoUrl: streamUrl,
                videoTitle: name,
                headers: playerHeaders,
              }),
            ]);
        }),
    );
    return lists.flat();
  }

  override sortVideos(videos: Video[]): Video[] {
    const quality = this.preferences.getString(
      PREF_QUALITY_KEY,
      PREF_QUALITY_DEFAULT,
    )!;
    const res = (v: Video) =>
      Number(QUALITY_RESOLUTION_REGEX.exec(v.videoTitle)?.[1] ?? 0);
    // compareBy(contains(quality), resolution).reversed()
    return [...videos]
      .reverse()
      .sort(
        (a, b) =>
          Number(b.videoTitle.includes(quality)) -
            Number(a.videoTitle.includes(quality)) || res(b) - res(a),
      );
  }

  // ── Filters ──
  override getFilterList(): FilterList {
    return FilterList(
      new TagList(TAGS.map((t) => new Tag(t, t))),
      new BrandList(BRANDS.map(([name]) => new Brand(name, name))),
      new SortFilter(sortableList.map((it) => it[0])),
      new TagInclusionMode(),
    );
  }

  // ── Preferences ──
  override setupPreferenceScreen(screen: PreferenceScreen) {
    const add = (
      key: string,
      title: string,
      entries: string[],
      entryValues: string[],
      def: string,
    ) => {
      const p = new ListPreference(screen.context);
      p.key = key;
      p.title = title;
      p.entries = entries;
      p.entryValues = entryValues;
      p.setDefaultValue(def);
      p.summary = "%s";
      screen.addPreference(p);
    };
    add(
      PREF_QUALITY_KEY,
      "Preferred quality",
      QUALITY_LIST,
      QUALITY_LIST,
      PREF_QUALITY_DEFAULT,
    );
    add(
      PREF_CACHE_TTL_KEY,
      "Search cache duration",
      ["1 minute", "5 minutes", "10 minutes", "30 minutes"],
      CACHE_TTL_LIST,
      PREF_CACHE_TTL_DEFAULT,
    );
    add(
      PREF_EP_TITLE_FORMAT_KEY,
      "Episode title format",
      EP_TITLE_FORMAT_ENTRIES,
      EP_TITLE_FORMAT_LIST,
      PREF_EP_TITLE_FORMAT_DEFAULT,
    );
  }
}

// Upstream's Brand(id, name) gets (display name, slug): the id, lower-cased, is what matches a hit's brand, and the
// slug is only the label. Here the display name is both the id and the label.
const BRANDS: [string, string][] = [
  ["37c-Binetsu", "37c-binetsu"],
  ["Adult Source Media", "adult-source-media"],
  ["Ajia-Do", "ajia-do"],
  ["Almond Collective", "almond-collective"],
  ["Alpha Polis", "alpha-polis"],
  ["Ameliatie", "ameliatie"],
  ["Amour", "amour"],
  ["Animac", "animac"],
  ["Antechinus", "antechinus"],
  ["APPP", "appp"],
  ["Arms", "arms"],
  ["Bishop", "bishop"],
  ["Blue Eyes", "blue-eyes"],
  ["BOMB! CUTE! BOMB!", "bomb-cute-bomb"],
  ["Bootleg", "bootleg"],
  ["BreakBottle", "breakbottle"],
  ["BugBug", "bugbug"],
  ["Bunnywalker", "bunnywalker"],
  ["Celeb", "celeb"],
  ["Central Park Media", "central-park-media"],
  ["ChiChinoya", "chichinoya"],
  ["Chocolat", "chocolat"],
  ["ChuChu", "chuchu"],
  ["Circle Tribute", "circle-tribute"],
  ["CoCoans", "cocoans"],
  ["Collaboration Works", "collaboration-works"],
  ["Comet", "comet"],
  ["Comic Media", "comic-media"],
  ["Cosmos", "cosmos"],
  ["Cranberry", "cranberry"],
  ["Crimson", "crimson"],
  ["D3", "d3"],
  ["Daiei", "daiei"],
  ["demodemon", "demodemon"],
  ["Digital Works", "digital-works"],
  ["Discovery", "discovery"],
  ["Dollhouse", "dollhouse"],
  ["EBIMARU-DO", "ebimaru-do"],
  ["Echo", "echo"],
  ["ECOLONUN", "ecolonun"],
  ["Edge", "edge"],
  ["Erozuki", "erozuki"],
  ["evee", "evee"],
  ["FINAL FUCK 7", "final-fuck-7"],
  ["Five Ways", "five-ways"],
  ["Friends Media Station", "friends-media-station"],
  ["Front Line", "front-line"],
  ["fruit", "fruit"],
  ["Godoy", "godoy"],
  ["GOLD BEAR", "gold-bear"],
  ["gomasioken", "gomasioken"],
  ["Green Bunny", "green-bunny"],
  ["Groover", "groover"],
  ["Hoods Entertainment", "hoods-entertainment"],
  ["Hot Bear", "hot-bear"],
  ["Hykobo", "hykobo"],
  ["IRONBELL", "ironbell"],
  ["Ivory Tower", "ivory-tower"],
  ["J.C.", "j-c"],
  ["Jellyfish", "jellyfish"],
  ["Jewel", "jewel"],
  ["Jumondo", "jumondo"],
  ["kate_sai", "kate_sai"],
  ["KENZsoft", "kenzsoft"],
  ["King Bee", "king-bee"],
  ["Kitty Media", "kitty-media"],
  ["Knack", "knack"],
  ["Kuril", "kuril"],
  ["L.", "l"],
  ["Lemon Heart", "lemon-heart"],
  ["Lilix", "lilix"],
  ["Lune Pictures", "lune-pictures"],
  ["Magic Bus", "magic-bus"],
  ["Magin Label", "magin-label"],
  ["Majin Petit", "majin-petit"],
  ["Marigold", "marigold"],
  ["Mary Jane", "mary-jane"],
  ["MediaBank", "mediabank"],
  ["Media Blasters", "media-blasters"],
  ["Metro Notes", "metro-notes"],
  ["Milky", "milky"],
  ["MiMiA Cute", "mimia-cute"],
  ["Moon Rock", "moon-rock"],
  ["Moonstone Cherry", "moonstone-cherry"],
  ["Mousou Senka", "mousou-senka"],
  ["MS Pictures", "ms-pictures"],
  ["Muse", "muse"],
  ["N43", "n43"],
  ["Nihikime no Dozeu", "nihikime-no-dozeu"],
  ["Nikkatsu Video", "nikkatsu-video"],
  ["nur", "nur"],
  ["NuTech Digital", "nutech-digital"],
  ["Obtain Future", "obtain-future"],
  ["Otodeli", "otodeli"],
  ["@ OZ", "oz"],
  ["Pashmina", "pashmina"],
  ["Passione", "passione"],
  ["Peach Pie", "peach-pie"],
  ["Pinkbell", "pinkbell"],
  ["Pink Pineapple", "pink-pineapple"],
  ["Pix", "pix"],
  ["Pixy Soft", "pixy-soft"],
  ["Pocomo Premium", "pocomo-premium"],
  ["PoRO", "poro"],
  ["Project No.9", "project-no-9"],
  ["Pumpkin Pie", "pumpkin-pie"],
  ["Queen Bee", "queen-bee"],
  ["Rabbit Gate", "rabbit-gate"],
  ["sakamotoJ", "sakamotoj"],
  ["Sakura Purin", "sakura-purin"],
  ["SANDWICHWORKS", "sandwichworks"],
  ["Schoolzone", "schoolzone"],
  ["seismic", "seismic"],
  ["SELFISH", "selfish"],
  ["Seven", "seven"],
  ["Shadow Prod. Co.", "shadow-prod-co"],
  ["Shelf", "shelf"],
  ["Shinyusha", "shinyusha"],
  ["ShoSai", "shosai"],
  ["Showten", "showten"],
  ["SoftCell", "softcell"],
  ["Soft on Demand", "soft-on-demand"],
  ["SPEED", "speed"],
  ["STARGATE3D", "stargate3d"],
  ["Studio 9 Maiami", "studio-9-maiami"],
  ["Studio Akai Shohosen", "studio-akai-shohosen"],
  ["Studio Deen", "studio-deen"],
  ["Studio Fantasia", "studio-fantasia"],
  ["Studio FOW", "studio-fow"],
  ["studio GGB", "studio-ggb"],
  ["Studio Houkiboshi", "studio-houkiboshi"],
  ["Studio Zealot", "studio-zealot"],
  ["Suiseisha", "suiseisha"],
  ["Suzuki Mirano", "suzuki-mirano"],
  ["SYLD", "syld"],
  ["TDK Core", "tdk-core"],
  ["t japan", "t-japan"],
  ["TNK", "tnk"],
  ["TOHO", "toho"],
  ["Toranoana", "toranoana"],
  ["T-Rex", "t-rex"],
  ["Triangle", "triangle"],
  ["Trimax", "trimax"],
  ["TYS Work", "tys-work"],
  ["U-Jin", "u-jin"],
  ["Umemaro-3D", "umemaro-3d"],
  ["Union Cho", "union-cho"],
  ["Valkyria", "valkyria"],
  ["Vanilla", "vanilla"],
  ["White Bear", "white-bear"],
  ["X City", "x-city"],
  ["yosino", "yosino"],
  ["Y.O.U.C.", "y-o-u-c"],
  ["ZIZ", "ziz"],
];

const TAGS = [
  "3D",
  "AHEGAO",
  "ANAL",
  "BDSM",
  "BIG BOOBS",
  "BLOW JOB",
  "BONDAGE",
  "BOOB JOB",
  "CENSORED",
  "COMEDY",
  "COSPLAY",
  "CREAMPIE",
  "DARK SKIN",
  "FACIAL",
  "FANTASY",
  "FILMED",
  "FOOT JOB",
  "FUTANARI",
  "GANGBANG",
  "GLASSES",
  "HAND JOB",
  "HAREM",
  "HD",
  "HORROR",
  "INCEST",
  "INFLATION",
  "LACTATION",
  "LOLI",
  "MAID",
  "MASTURBATION",
  "MILF",
  "MIND BREAK",
  "MIND CONTROL",
  "MONSTER",
  "NEKOMIMI",
  "NTR",
  "NURSE",
  "ORGY",
  "PLOT",
  "POV",
  "PREGNANT",
  "PUBLIC SEX",
  "RAPE",
  "REVERSE RAPE",
  "RIMJOB",
  "SCAT",
  "SCHOOL GIRL",
  "SHOTA",
  "SOFTCORE",
  "SWIMSUIT",
  "TEACHER",
  "TENTACLE",
  "THREESOME",
  "TOYS",
  "TRAP",
  "TSUNDERE",
  "UGLY BASTARD",
  "UNCENSORED",
  "VANILLA",
  "VIRGIN",
  "WATERSPORTS",
  "X-RAY",
  "YAOI",
  "YURI",
];
