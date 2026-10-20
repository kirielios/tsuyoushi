// Port of yuzono/anime-extensions src/all/googledriveindex/GoogleDriveIndex.kt (and GoogleDriveIndexDto.kt)
//
// The server list is the user's own (Google Drive Index sites, e.g. *.workers.dev), set in the extension settings.
import {
  AnimeHttpSource,
  Base64,
  EditTextPreference,
  Filter,
  fromUtf8,
  GET,
  Hoster,
  MangasPage,
  POST,
  SAnime,
  SEpisode,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  SwitchPreferenceCompat,
  Video,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// ============================== DTOs (GoogleDriveIndexDto.kt) ===============================
interface ResponseData {
  nextPageToken?: string | null;
  data: { files: { mimeType: string; id: string; name: string; modifiedTime?: string | null; size?: string | null }[] };
}
interface LinkData {
  type: string;
  url: string;
  info?: string | null;
  fragment?: string | null;
}
interface IdUrl {
  id: string;
  url: string;
  referer: string;
  type: string;
}
interface Details {
  title?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  genre?: string[] | null;
  status?: string | null;
}

const DOMAIN_PREF_KEY = "domain_list";
const DOMAIN_PREF_DEFAULT = "";
const SEARCH_FOLDER_IGNORE_KEY = "ignore_non_folder";
const SEARCH_FOLDER_IGNORE_DEFAULT = true;
const TRIM_EPISODE_NAME_KEY = "trim_episode_name";
const TRIM_EPISODE_NAME_DEFAULT = true;
const TRIM_ANIME_NAME_KEY = "trim_anime_name";
const TRIM_ANIME_NAME_DEFAULT = true;

const URL_REGEX = /^(?<name>\[[^[\];]+\])?(?<url>https(?:[^,#]+))(?<depth>#\d+(?<range>,\d+,\d+)?)?$/;
const SEASON_INFO_REGEX = /(\([\s\w-]+\))(?: ?\[[\s\w-]+\])?$/;

/** keiyoushi.utils.formatBytes */
function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} KB`;
  if (n > 1) return `${n} bytes`;
  if (n === 1) return `${n} byte`;
  return "";
}
const sizeOf = (s: string | null | undefined): string | null => (s != null && /^\d+$/.test(s) ? formatBytes(Number(s)) : null);

/** okhttp3.Credentials.basic (ISO-8859-1) */
const basicCredentials = (username: string, password: string) => `Basic ${Base64.encode(Uint8Array.from(`${username}:${password}`, (c) => c.charCodeAt(0) & 0xff))}`;

/** A URL's user:password moved into an Authorization header: fetch refuses URLs that carry credentials. */
function splitCredentials(url: string): { url: string; authorization?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url };
  }
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  if (!username.trim() || !password.trim()) return { url };
  u.username = "";
  u.password = "";
  return { url: u.href, authorization: basicCredentials(username, password) };
}

const joinUrl = (path1: string, path2: string) => (path1.endsWith("/") ? path1.slice(0, -1) : path1) + "/" + (path2.startsWith("/") ? path2.slice(1) : path2);
const addSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s : s + suffix);
const decrypt = (s: string) => {
  const r = [...s].reverse().join("");
  return fromUtf8(Base64.decode(r.substring(24, s.length - 20)));
};
const removeName = (s: string) => s.replace(/^(\[[^[\];]+\])/, "");
/** java.net.URLEncoder.encode */
const urlEncode = (s: string) => encodeURIComponent(s).replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
const asReferer = (s: string) => {
  const u = new URL(s);
  return urlEncode(`https://${u.host}${u.pathname}`);
};
const hostAndCred = (u: URL) => (u.password.trim() && u.username.trim() ? `${u.username}:${u.password}@${u.host}` : u.host);
const pathSegments = (u: URL) => u.pathname.slice(1).split("/").map(decodeURIComponent);
const encodedFragment = (url: string) => {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(i + 1) : null;
};

function trimInfo(s: string): string {
  let newString = s.replace(/^\[[\w-]+\] ?/, "");
  const regex = /( ?\[[\s\w-]+\]| ?\([\s\w-]+\))(\.mkv|\.mp4|\.avi)?$/;
  while (regex.test(newString)) newString = newString.replace(regex, (_m, _g1, ext?: string) => ext ?? "");
  return newString.trim();
}

class URLFilter extends Filter.Text {
  constructor() {
    super("Url");
  }
}

class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

class ServerFilter extends UriPartFilter {
  constructor(domains: [string, string][]) {
    super("Select server", domains);
  }
}

export default class GoogleDriveIndex extends AnimeHttpSource {
  override get baseUrl(): string {
    return removeName(this.domainList.split(",")[0].trim());
  }

  get supportsLatest() {
    return false;
  }

  private pageToken: string | null = "";

  private get domainList() {
    return this.preferences.getString(DOMAIN_PREF_KEY, DOMAIN_PREF_DEFAULT)!;
  }
  private get ignoreFolder() {
    return this.preferences.getBoolean(SEARCH_FOLDER_IGNORE_KEY, SEARCH_FOLDER_IGNORE_DEFAULT);
  }
  private get trimEpisodeName() {
    return this.preferences.getBoolean(TRIM_EPISODE_NAME_KEY, TRIM_EPISODE_NAME_DEFAULT);
  }
  private get trimAnimeName() {
    return this.preferences.getBoolean(TRIM_ANIME_NAME_KEY, TRIM_ANIME_NAME_DEFAULT);
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((request) => {
      const { url, authorization } = splitCredentials(request.url);
      if (!authorization) return request;
      const headers = new Headers(request.headers);
      headers.set("Authorization", authorization);
      return { ...request, url, headers };
    });
  }

  // ponytail: upstream also sends Host; fetch forbids it and sends the right one anyway
  private formHeaders(url: string, referer?: string) {
    const h = new Headers(this.headers);
    h.append("Accept", "*/*");
    h.append("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    h.append("Origin", `https://${new URL(url).host}`);
    if (referer != null) h.append("Referer", referer);
    h.append("X-Requested-With", "XMLHttpRequest");
    return h;
  }

  private requireServer() {
    if (!this.baseUrl) throw new Error("Enter drive path(s) in extension settings.");
    if (new URL(this.baseUrl).host === "drive.google.com") throw new Error("This extension is only for Google Drive Index sites, not drive.google.com folders.");
  }

  // ============================== Popular ===============================

  protected popularAnimeRequest(page: number): Request {
    this.requireServer();
    if (page === 1) this.pageToken = "";
    const popBody = `password=&page_token=${this.pageToken}&page_index=${page - 1}`;
    return POST(this.baseUrl, this.formHeaders(this.baseUrl, asReferer(this.baseUrl)), popBody, "application/x-www-form-urlencoded");
  }

  protected popularAnimeParse(response: Response): MangasPage {
    return this.parsePage(response, this.baseUrl, null);
  }

  // =============================== Latest ===============================

  protected latestUpdatesAnimeRequest(): Request {
    throw new Error("Not used");
  }
  protected latestUpdatesAnimeParse(): MangasPage {
    throw new Error("Not used");
  }

  // =============================== Search ===============================

  protected searchAnimeParse(): MangasPage {
    throw new Error("Not used");
  }

  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const filterList = filters.length ? filters : this.getFilterList();
    const urlFilter = filterList.find((it) => it instanceof URLFilter) as URLFilter;

    if (urlFilter.state) return this.addSinglePage(urlFilter.state);
    const req = this.searchAnimeRequest(page, query, filters);
    const response = await this.executeSuccess(req);
    return this.parsePage(response, req.url, req.headers.get("Referer"));
  }

  private addSinglePage(inputUrl: string): MangasPage {
    const match = URL_REGEX.exec(inputUrl.trim());
    if (!match) throw new Error("Invalid url");
    const anime = SAnime.create();
    const name = match.groups!.name;
    anime.title = name != null ? substringBeforeLast(substringAfter(name, "["), "]") : "Folder";
    anime.url = JSON.stringify({ type: "multi", url: match.groups!.url, fragment: encodedFragment(removeName(inputUrl.trim())) } satisfies LinkData);
    anime.thumbnail_url = "";
    return new MangasPage([anime], false);
  }

  protected searchAnimeRequest(page: number, query: string, filters: FilterList): Request {
    this.requireServer();

    const filterList = filters.length ? filters : this.getFilterList();
    const serverFilter = filterList.find((it) => it instanceof ServerFilter) as ServerFilter;
    const serverUrl = serverFilter.toUriPart();

    if (page === 1) this.pageToken = "";

    if (!query.trim()) {
      const popBody = `password=&page_token=${this.pageToken}&page_index=${page - 1}`;
      return POST(serverUrl, this.formHeaders(serverUrl, asReferer(serverUrl)), popBody, "application/x-www-form-urlencoded");
    }
    const cleanQuery = query.replaceAll(" ", "+");
    const server = new URL(serverUrl);
    const searchUrl = `https://${hostAndCred(server)}/${pathSegments(server)[0]}search`;
    const popBody = `q=${cleanQuery}&page_token=${this.pageToken}&page_index=${page - 1}`;
    return POST(searchUrl, this.formHeaders(serverUrl, `${searchUrl}?q=${cleanQuery}`), popBody, "application/x-www-form-urlencoded");
  }

  // ============================== FILTERS ===============================

  override getFilterList(): FilterList {
    return [new Filter.Header("Text search will only search inside selected server"), new ServerFilter(this.getDomains()), new Filter.Header("Add single folder"), new URLFilter()];
  }

  private getDomains(): [string, string][] {
    if (!this.domainList.trim()) return [];
    // ponytail: upstream validates the list while it is typed; an entry that is not a URL is left out here
    return this.domainList
      .split(",")
      .map((it) => it.trim())
      .filter((it) => URL_REGEX.test(it))
      .map((it): [string, string] => {
        const name = URL_REGEX.exec(it)!.groups!.name;
        return [name != null ? substringBeforeLast(substringAfter(name, "["), "]") : new URL(removeName(it)).pathname, removeName(it)];
      });
  }

  // =========================== Anime Details ============================

  override getMangaUrl(anime: SAnime): string {
    const parsed = JSON.parse(anime.url) as LinkData;
    return parsed.type === "search" ? (JSON.parse(parsed.url) as IdUrl).url : splitCredentials(parsed.url).url;
  }

  /** The search result's id resolved to its path on the server (id2path). */
  private async resolve(parsed: LinkData): Promise<LinkData> {
    if (parsed.type !== "search") return parsed;
    const idParsed = JSON.parse(parsed.url) as IdUrl;
    const postBody = `id=${idParsed.id}`;
    const slug = (await this.client.execute(POST(idParsed.url + "id2path", this.formHeaders(idParsed.url, urlEncode(idParsed.referer)), postBody, "application/x-www-form-urlencoded"))).text();
    return { type: idParsed.type, url: idParsed.url + slug, info: parsed.info };
  }

  private async listPage(url: string, token: string, pageIndex: number): Promise<ResponseData> {
    const popBody = `password=&page_token=${token}&page_index=${pageIndex}`;
    const response = await this.client.execute(POST(url, this.formHeaders(url, urlEncode(url)), popBody, "application/x-www-form-urlencoded"));
    return JSON.parse(decrypt(response.text())) as ResponseData;
  }

  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const newParsed = await this.resolve(JSON.parse(anime.url) as LinkData);

    if (newParsed.type === "single") return anime;

    let newToken: string | null | undefined = "";
    let newPageIndex = 0;
    while (newToken != null) {
      const parsed = await this.listPage(newParsed.url, newToken, newPageIndex);

      for (const item of parsed.data.files) {
        if (item.mimeType.startsWith("image/") && item.name.toLowerCase().startsWith("cover")) {
          anime.thumbnail_url = splitCredentials(joinUrl(newParsed.url, item.name)).url;
        }

        if (item.name.toLowerCase() === "details.json") {
          const details = (await this.client.execute(GET(joinUrl(newParsed.url, item.name)))).text();
          const detailsParsed = JSON.parse(details) as Details;
          if (detailsParsed.title != null) anime.title = detailsParsed.title;
          if (detailsParsed.author != null) anime.author = detailsParsed.author;
          if (detailsParsed.artist != null) anime.artist = detailsParsed.artist;
          if (detailsParsed.description != null) anime.description = detailsParsed.description;
          if (detailsParsed.genre != null) anime.genre = detailsParsed.genre.join(", ");
          if (detailsParsed.status != null) anime.status = /^[+-]?\d+$/.test(detailsParsed.status) ? Number(detailsParsed.status) : SAnime.UNKNOWN;
        }
      }

      newToken = parsed.nextPageToken;
      newPageIndex += 1;
    }

    return anime;
  }

  protected animeDetailsParse(): SAnime {
    throw new Error("Not used");
  }

  // ============================== Episodes ==============================

  override async getEpisodeList(anime: SAnime): Promise<SEpisode[]> {
    const episodeList: SEpisode[] = [];
    const parsed = JSON.parse(anime.url) as LinkData;
    let counter = 1;
    const maxRecursionDepth = parsed.fragment ? Number(substringBefore(parsed.fragment, ",")) : 2;
    const [start, stop] = parsed.fragment?.includes(",") ? substringAfter(parsed.fragment, ",").split(",").map(Number) : [null, null];

    const newParsed = await this.resolve(parsed);

    if (newParsed.type === "single") {
      const titleName = pathSegments(new URL(newParsed.url)).at(-1)!;
      const episode = SEpisode.create();
      episode.name = this.trimEpisodeName ? trimInfo(titleName) : titleName;
      episode.url = newParsed.url;
      episode.episode_number = 1;
      episode.date_upload = -1;
      episode.scanlator = newParsed.info ?? undefined;
      episodeList.push(episode);
    }

    if (newParsed.type === "multi") {
      const basePathCounter = pathSegments(new URL(newParsed.url)).length;

      const traverseDirectory = async (url: string, recursionDepth = 0): Promise<void> => {
        if (recursionDepth === maxRecursionDepth) return;
        let newToken: string | null | undefined = "";
        let newPageIndex = 0;

        while (newToken != null) {
          const page = await this.listPage(url, newToken, newPageIndex);

          for (const item of page.data.files) {
            if (item.mimeType.endsWith("folder")) {
              await traverseDirectory(addSuffix(joinUrl(url, item.name), "/"), recursionDepth + 1);
            }
            if (item.mimeType.startsWith("video/")) {
              if (start != null && maxRecursionDepth === 1 && counter < start) {
                counter++;
                continue;
              }
              if (stop != null && maxRecursionDepth === 1 && counter > stop) return;

              const epUrl = joinUrl(url, item.name);
              const paths = pathSegments(new URL(epUrl));

              // Get season stuff
              const season = paths.length === basePathCounter ? "" : paths[basePathCounter - 1];
              const seasonMatch = SEASON_INFO_REGEX.exec(season);
              const seasonInfo = seasonMatch ? `${seasonMatch[1]} • ` : "";

              // Get other info
              const extraInfo =
                paths.length > basePathCounter
                  ? "/" +
                    paths
                      .slice(basePathCounter - 1, paths.length - 1)
                      .map(trimInfo)
                      .join("/")
                  : "/";
              const size = sizeOf(item.size);

              const episode = SEpisode.create();
              episode.name = this.trimEpisodeName ? trimInfo(item.name) : item.name;
              episode.url = epUrl;
              episode.scanlator = `${size ?? ""} • ${seasonInfo}${extraInfo}`;
              episode.date_upload = -1;
              episode.episode_number = counter;
              episodeList.push(episode);
              counter++;
            }
          }

          newToken = page.nextPageToken;
          newPageIndex += 1;
        }
      };

      await traverseDirectory(newParsed.url);
    }

    return episodeList.reverse();
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Not used");
  }

  // ============================ Video Links =============================

  override getEpisodeUrl(episode: SEpisode): string {
    return splitCredentials(episode.url).url;
  }

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(episode.url, this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const url = hoster.hosterUrl;

    const doc = (await this.client.execute(GET(`${url}?a=view`))).asJsoup();

    const script = doc.selectFirst("script:containsData(videodomain)")?.data() ?? doc.selectFirst("script:containsData(downloaddomain)")?.data();
    if (script == null || script.includes('"second_domain_for_dl":false')) return [this.video(url)];

    const domainUrl = script.toLowerCase().includes("videodomain")
      ? substringBefore(substringAfter(script, '"videodomain":"'), '"')
      : substringBefore(substringAfter(script, '"downloaddomain":"'), '"');

    const videoUrl = domainUrl.trim() ? domainUrl + new URL(url).pathname : url;
    return [this.video(videoUrl)];
  }

  /** Upstream hands the player the URL with its user:password; here they travel as an Authorization header. */
  private video(url: string): Video {
    const { url: videoUrl, authorization } = splitCredentials(url);
    const headers = new Headers(this.headers);
    if (authorization) headers.set("Authorization", authorization);
    return new Video({ videoUrl, videoTitle: "Video", headers });
  }

  // ============================= Utilities ==============================

  private parsePage(response: Response, url: string, referer: string | null): MangasPage {
    const parsed = JSON.parse(decrypt(response.text())) as ResponseData;
    const animeList: SAnime[] = [];
    const isSearch = url.endsWith(":search");
    const baseFolder = () => URL_REGEX.exec(url)!.groups!.url;

    for (const item of parsed.data.files) {
      if (item.mimeType.endsWith("folder")) {
        const anime = SAnime.create();
        anime.title = this.trimAnimeName ? trimInfo(item.name) : item.name;
        anime.thumbnail_url = "";
        anime.url = isSearch
          ? JSON.stringify({ type: "search", url: JSON.stringify({ id: item.id, url: substringBeforeLast(url, "search"), referer: referer!, type: "multi" } satisfies IdUrl) } satisfies LinkData)
          : JSON.stringify({ type: "multi", url: addSuffix(joinUrl(baseFolder(), item.name), "/"), fragment: encodedFragment(url) } satisfies LinkData);
        animeList.push(anime);
      }
      if (item.mimeType.startsWith("video/") && !(this.ignoreFolder && isSearch)) {
        const anime = SAnime.create();
        anime.title = this.trimAnimeName ? trimInfo(item.name) : item.name;
        anime.thumbnail_url = "";
        anime.url = isSearch
          ? JSON.stringify({
              type: "search",
              url: JSON.stringify({ id: item.id, url: substringBeforeLast(url, "search"), referer: referer!, type: "single" } satisfies IdUrl),
              info: sizeOf(item.size),
            } satisfies LinkData)
          : JSON.stringify({ type: "single", url: joinUrl(baseFolder(), item.name), info: sizeOf(item.size), fragment: encodedFragment(url) } satisfies LinkData);
        animeList.push(anime);
      }
    }

    this.pageToken = parsed.nextPageToken ?? null;

    return new MangasPage(animeList, parsed.nextPageToken != null);
  }

  // ============================== Settings ==============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    // ponytail: upstream validates the URLs while typing and toasts "Restart App to apply changes"; neither exists
    // here, and the list is read on every call so no restart is needed
    const domains = new EditTextPreference(screen.context);
    domains.key = DOMAIN_PREF_KEY;
    domains.title = "Enter drive paths to be shown in extension";
    domains.summary =
      'Enter drive paths to be shown in extension\nEnter as comma separated list. For password protected sites, format as: "https://username:password@example.worker.dev/0:/"';
    domains.setDefaultValue(DOMAIN_PREF_DEFAULT);
    domains.dialogTitle = "Path list";
    screen.addPreference(domains);

    for (const [key, title, def] of [
      [SEARCH_FOLDER_IGNORE_KEY, "Only include folders on search", SEARCH_FOLDER_IGNORE_DEFAULT],
      [TRIM_EPISODE_NAME_KEY, "Trim info from episode name", TRIM_EPISODE_NAME_DEFAULT],
      [TRIM_ANIME_NAME_KEY, "Trim info from anime name", TRIM_ANIME_NAME_DEFAULT],
    ] as const) {
      const p = new SwitchPreferenceCompat(screen.context);
      p.key = key;
      p.title = title;
      p.setDefaultValue(def);
      screen.addPreference(p);
    }
  }
}
