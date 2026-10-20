// Port of yuzono/anime-extensions src/all/googledrive/GoogleDrive.kt (and GoogleDriveDto.kt)
//
// Upstream relies on a Google login made in the WebView (its SAPISID cookie signs the batch requests). The host has
// no WebView: without a session in the host's cookie jar Drive refuses every listing, public folders included.
import {
  AnimeHttpSource,
  EditTextPreference,
  Filter,
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
  toHex,
  utf8,
  type Document,
  type FilterList,
  type PreferenceScreen,
  type Request,
  type Response,
  type Video,
} from "../../../sdk/index.ts";
import { GoogleDriveExtractor } from "../../../libs/googledriveextractor/index.ts";
import { defaultGetRequest, IMAGE_MIMETYPE, searchReq, searchReqWithType, type MultiFormPath } from "./reqs.ts";

// ============================== DTOs (GoogleDriveDto.kt) ===============================
interface PostResponse {
  nextPageToken?: string | null;
  items?: { id: string; title: string; mimeType: string; fileSize?: string | null }[] | null;
}
interface LinkData {
  url: string;
  type: string;
  info?: LinkDataInfo | null;
}
interface LinkDataInfo {
  title: string;
  size: string;
}
interface DownloadResponse {
  downloadUrl: string;
}
interface DetailsJson {
  title?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  genre?: string[] | null;
  status?: string | null;
}

const DOMAIN_PREF_KEY = "domain_list";
const DOMAIN_PREF_DEFAULT = "";
const TRIM_ANIME_KEY = "trim_anime_info";
const TRIM_ANIME_DEFAULT = false;
const TRIM_EPISODE_NAME_KEY = "trim_episode_name";
const TRIM_EPISODE_NAME_DEFAULT = true;
const TRIM_EPISODE_INFO_KEY = "trim_episode_info";
const TRIM_EPISODE_INFO_DEFAULT = false;
const SCANLATOR_ORDER_KEY = "scanlator_order";
const SCANLATOR_ORDER_DEFAULT = false;

const DRIVE_FOLDER_REGEX =
  /^(?<name>\[[^[\];]+\])?https?:\/\/(?:docs|drive)\.google\.com\/drive(?:\/[^/]+)*?\/folders\/(?<id>[\w-]{28,})(?:\?[^;#]+)?(?<depth>#\d+(?<range>,\d+,\d+)?)?$/;
const KEY_REGEX = /"(\w{39})"/;
const VERSION_REGEX = /"([^"]+web-frontend[^"]+)"/;
const JSON_REGEX = /\s*(\{(.+)\})\s*/s;
const BOUNDARY = "=====vc17a3rwnndj=====";
const ITEM_NUMBER_REGEX = / - (?:S\d+E)?(\d+)\b/;

/** keiyoushi.utils.formatBytes */
function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} KB`;
  if (n > 1) return `${n} bytes`;
  if (n === 1) return `${n} byte`;
  return "";
}
const fileSizeOf = (s: string | null | undefined) => {
  const n = s != null && /^\d+$/.test(s) ? Number(s) : null;
  return n != null ? formatBytes(n) : "";
};

function trimInfo(s: string): string {
  let newString = s.replace(/^\[\w+\] ?/, "");
  const regex = /( ?\[[\s\w-]+\]| ?\([\s\w-]+\))(\.mkv|\.mp4|\.avi)?$/;
  while (regex.test(newString)) newString = newString.replace(regex, (_m, _g1, ext?: string) => ext ?? "");
  return newString.trim();
}

const parseJsonIn = <T>(response: Response): T => JSON.parse(JSON_REGEX.exec(response.text())![1]) as T;

async function sha1Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-1", utf8(s))));
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
    super("Select drive path", domains);
  }
}

export default class GoogleDrive extends AnimeHttpSource {
  get supportsLatest() {
    return false;
  }

  private get domainList() {
    return this.preferences.getString(DOMAIN_PREF_KEY, DOMAIN_PREF_DEFAULT)!;
  }
  private get trimAnimeInfo() {
    return this.preferences.getBoolean(TRIM_ANIME_KEY, TRIM_ANIME_DEFAULT);
  }
  private get trimEpisodeName() {
    return this.preferences.getBoolean(TRIM_EPISODE_NAME_KEY, TRIM_EPISODE_NAME_DEFAULT);
  }
  private get trimEpisodeInfo() {
    return this.preferences.getBoolean(TRIM_EPISODE_INFO_KEY, TRIM_EPISODE_INFO_DEFAULT);
  }
  private get scanlatorOrder() {
    return this.preferences.getBoolean(SCANLATOR_ORDER_KEY, SCANLATOR_ORDER_DEFAULT);
  }

  // Hack to manipulate what gets opened in webview
  private get baseUrlInternal(): string | undefined {
    return this.domainList.split(";")[0];
  }

  // ponytail: upstream also sends Connection, Host and a Cookie header built from the jar; fetch forbids the first two
  // and the client's cookie jar adds the cookies itself
  private get getHeaders() {
    const h = new Headers(this.headers);
    h.append("Accept", "*/*");
    return h;
  }

  private nextPageToken: string | null = "";

  // ============================== Popular ===============================

  override async fetchPopularManga(page: number): Promise<MangasPage> {
    return this.parsePage(this.popularAnimeRequest(page), page);
  }

  protected popularAnimeRequest(_page: number): Request {
    const baseUrlInternal = this.baseUrlInternal;
    if (!baseUrlInternal) throw new Error("Enter drive path(s) in extension settings.");
    const match = DRIVE_FOLDER_REGEX.exec(baseUrlInternal.trim());
    if (!match) throw new Error("Invalid drive url");
    const folderId = match.groups!.id;
    const recurDepth = match.groups!.depth ?? "";
    return GET(`https://drive.google.com/drive/folders/${folderId}${recurDepth}`, this.getHeaders);
  }

  protected popularAnimeParse(): MangasPage {
    throw new Error("Not used");
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
    if (!query) return this.parsePage(req, page);
    const parentId = substringBefore(req.url, "#").split("/").at(-1)!;
    const cleanQuery = encodeURIComponent(query).replace(/%20/g, "+"); // URLEncoder.encode
    return this.parsePage(req, page, searchReq(parentId, cleanQuery));
  }

  protected searchAnimeRequest(_page: number, _query: string, filters: FilterList): Request {
    if (!this.baseUrlInternal) throw new Error("Enter drive path(s) in extension settings.");

    const filterList = filters.length ? filters : this.getFilterList();
    const serverFilter = filterList.find((it) => it instanceof ServerFilter) as ServerFilter;
    const serverUrl = serverFilter.toUriPart();

    const match = DRIVE_FOLDER_REGEX.exec(serverUrl)!;
    const folderId = match.groups!.id;
    const recurDepth = match.groups!.depth ?? "";
    return GET(`https://drive.google.com/drive/folders/${folderId}${recurDepth}`, this.getHeaders);
  }

  // ============================== FILTERS ===============================

  override getFilterList(): FilterList {
    return [new ServerFilter(this.getDomains()), new Filter.Separator(), new Filter.Header("Add single folder"), new URLFilter()];
  }

  private getDomains(): [string, string][] {
    if (!this.domainList.trim()) return [];
    // ponytail: upstream validates the list while it is typed; an entry that is not a drive folder is left out here
    return this.domainList
      .split(";")
      .map((it) => it.trim())
      .filter((it) => DRIVE_FOLDER_REGEX.test(it))
      .map((it): [string, string] => {
        const name = DRIVE_FOLDER_REGEX.exec(it)!.groups!.name;
        return [name != null ? substringBeforeLast(substringAfter(name, "["), "]") : new URL(it).pathname, it];
      });
  }

  // =========================== Anime Details ============================

  override animeDetailsRequest(anime: SAnime): Request {
    const parsed = JSON.parse(anime.url) as LinkData;
    return GET(parsed.url, this.getHeaders);
  }

  override getMangaUrl(anime: SAnime): string {
    return (JSON.parse(anime.url) as LinkData).url;
  }

  override async getAnimeDetails(anime: SAnime): Promise<SAnime> {
    const parsed = JSON.parse(anime.url) as LinkData;
    if (parsed.type === "single") return anime;

    const folderId = DRIVE_FOLDER_REGEX.exec(parsed.url)!.groups!.id;

    let driveDocument: Document;
    try {
      driveDocument = (await this.client.execute(GET(parsed.url, this.getHeaders))).asJsoup();
    } catch {
      return anime;
    }

    // Get cover

    const coverResponse = parseJsonIn<PostResponse>(
      await this.client.execute(await this.createPost(driveDocument, folderId, this.nextPageToken, searchReqWithType(folderId, "cover", IMAGE_MIMETYPE))),
    );
    const cover = coverResponse.items?.[0];
    if (cover) anime.thumbnail_url = `https://drive.google.com/uc?id=${cover.id}`;

    // Get details

    const detailsResponse = parseJsonIn<PostResponse>(
      await this.client.execute(await this.createPost(driveDocument, folderId, this.nextPageToken, searchReqWithType(folderId, "details.json", ""))),
    );
    const details = detailsResponse.items?.[0];
    if (details) {
      const newPostHeaders = new Headers(this.getHeaders);
      newPostHeaders.append("Content-Type", "application/x-www-form-urlencoded;charset=utf-8");
      newPostHeaders.append("Origin", "https://drive.google.com");
      newPostHeaders.append("Referer", "https://drive.google.com/");
      newPostHeaders.append("X-Drive-First-Party", "DriveWebUi");
      newPostHeaders.append("X-Json-Requested", "true");

      const newPostUrl = `https://drive.usercontent.google.com/uc?id=${details.id}&authuser=0&export=download`;
      const newResponse = parseJsonIn<DownloadResponse>(await this.client.execute(POST(newPostUrl, newPostHeaders, "")));

      const downloadHeaders = new Headers(this.headers);
      downloadHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");

      const t = (await this.client.execute(GET(newResponse.downloadUrl, downloadHeaders))).parseAs<DetailsJson>();
      if (t.title != null) anime.title = t.title;
      if (t.author != null) anime.author = t.author;
      if (t.artist != null) anime.artist = t.artist;
      if (t.description != null) anime.description = t.description;
      if (t.genre != null) anime.genre = t.genre.join(", ");
      if (t.status != null) anime.status = /^[+-]?\d+$/.test(t.status) ? Number(t.status) : SAnime.UNKNOWN;
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

    if (parsed.type === "single") {
      const episode = SEpisode.create();
      episode.name = "Video";
      episode.scanlator = parsed.info!.size;
      episode.url = parsed.url;
      episode.episode_number = 1;
      episode.date_upload = -1;
      return [episode];
    }

    const match = DRIVE_FOLDER_REGEX.exec(parsed.url)!;
    const depth = match.groups!.depth;
    const maxRecursionDepth = depth != null ? Number(substringBefore(substringAfter(depth, "#"), ",")) : 2;
    const range = match.groups!.range;
    const [start, stop] = range != null ? substringAfter(range, ",").split(",").map(Number) : [null, null];

    const traverseFolder = async (folderUrl: string, path: string, recursionDepth = 0): Promise<void> => {
      if (recursionDepth === maxRecursionDepth) return;

      const folderId = DRIVE_FOLDER_REGEX.exec(folderUrl)!.groups!.id;

      let driveDocument: Document;
      try {
        driveDocument = (await this.client.execute(GET(folderUrl, this.getHeaders))).asJsoup();
      } catch {
        throw new Error("Unable to get items, check webview");
      }

      if (driveDocument.selectFirst("title:contains(Error 404 \\(Not found\\))") != null) return;

      let pageToken: string | null | undefined = "";
      let counter = 1;

      while (pageToken != null) {
        const response = await this.client.execute(await this.createPost(driveDocument, folderId, pageToken));
        const parsedPage = parseJsonIn<PostResponse>(response);

        if (parsedPage.items == null) throw new Error("Failed to load items, please log in through webview");
        for (const [index, it] of parsedPage.items.entries()) {
          if (it.mimeType.startsWith("video")) {
            const size = fileSizeOf(it.fileSize);
            const pathName = this.trimEpisodeInfo ? trimInfo(path) : path;

            if (start != null && maxRecursionDepth === 1 && counter < start) {
              counter++;
              continue;
            }
            if (stop != null && maxRecursionDepth === 1 && counter > stop) return;

            const episode = SEpisode.create();
            episode.name = this.trimEpisodeName ? trimInfo(it.title) : it.title;
            episode.url = `https://drive.google.com/uc?id=${it.id}`;
            const n = ITEM_NUMBER_REGEX.exec(trimInfo(it.title))?.[1];
            episode.episode_number = n != null && !Number.isNaN(Number(n)) ? Number(n) : index + 1;
            episode.date_upload = -1;
            episode.scanlator = this.scanlatorOrder ? `/${pathName} • ${size}` : `${size} • /${pathName}`;
            episodeList.push(episode);
            counter++;
          }
          if (it.mimeType.endsWith(".folder")) {
            await traverseFolder(`https://drive.google.com/drive/folders/${it.id}`, path ? `${path}/${it.title}` : it.title, recursionDepth + 1);
          }
        }

        pageToken = parsedPage.nextPageToken;
      }
    };

    await traverseFolder(parsed.url, "");

    return episodeList.reverse();
  }

  protected episodeListParse(): SEpisode[] {
    throw new Error("Not used");
  }

  // ============================ Video Links =============================

  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(episode.url, this.name)];
  }

  override getEpisodeUrl(episode: SEpisode): string {
    return episode.url;
  }

  override getVideoList(hoster: Hoster): Promise<Video[]> {
    return new GoogleDriveExtractor(this.client, this.headers).videosFromUrl(substringAfter(hoster.hosterUrl, "?id="));
  }

  // ============================= Utilities ==============================

  private addSinglePage(folderUrl: string): MangasPage {
    const match = DRIVE_FOLDER_REGEX.exec(folderUrl.trim());
    if (!match) throw new Error("Invalid drive url");
    const recurDepth = match.groups!.depth ?? "";

    const anime = SAnime.create();
    const name = match.groups!.name;
    anime.title = name != null ? substringBeforeLast(substringAfter(name, "["), "]") : "Folder";
    anime.url = JSON.stringify({ url: `https://drive.google.com/drive/folders/${match.groups!.id}${recurDepth}`, type: "multi" } satisfies LinkData);
    anime.thumbnail_url = "";
    return new MangasPage([anime], false);
  }

  private async createPost(document: Document, folderId: string, pageToken: string | null, getMultiFormPath: MultiFormPath = defaultGetRequest): Promise<Request> {
    const keyScript = document
      .select("script")
      .find((script) => KEY_REGEX.test(script.data()))
      ?.data();
    if (keyScript == null) throw new Error("Failed to load items, please log in through webview");
    const key = KEY_REGEX.exec(keyScript)?.[1] ?? "";

    const versionScript = keyScript;
    const driveVersion = VERSION_REGEX.exec(versionScript)?.[1] ?? "";
    const sapisid = this.client.cookieJar.loadForRequest("https://drive.google.com").find((it) => it.name === "SAPISID" || it.name === "__Secure-3PAPISID")?.value ?? "";

    const requestUrl = getMultiFormPath(folderId, pageToken ?? "", key);
    const body = [
      `--${BOUNDARY}`,
      "content-type: application/http",
      "content-transfer-encoding: binary",
      "",
      `GET ${requestUrl}`,
      `X-Goog-Drive-Client-Version: ${driveVersion}`,
      // without a Google login (no SAPISID cookie) Drive answers 401 here, public folders included (checked live)
      `authorization: ${await generateSapisidhashHeader(sapisid)}`,
      "x-goog-authuser: 0",
      "",
      `--${BOUNDARY}--`,
    ].join("\n");

    const postUrl = `https://clients6.google.com/batch/drive/v2internal?$ct=multipart/mixed; boundary="${BOUNDARY}"&key=${key}`;

    const postHeaders = new Headers(this.headers);
    postHeaders.append("Origin", "https://drive.google.com");

    // OkHttp sends the body's multipart/mixed type over the text/plain header; Drive's web UI sends text/plain with
    // the real type in `$ct`, which also keeps the request simple for a browser
    return POST(postUrl, postHeaders, body, "text/plain; charset=UTF-8");
  }

  private async parsePage(request: Request, page: number, genMultiFormReq?: MultiFormPath): Promise<MangasPage> {
    const animeList: SAnime[] = [];

    const hash = request.url.indexOf("#");
    const recurDepth = hash >= 0 ? request.url.slice(hash) : "";

    const folderId = DRIVE_FOLDER_REGEX.exec(request.url)!.groups!.id;

    let driveDocument: Document;
    try {
      driveDocument = (await this.client.execute(request)).asJsoup();
    } catch {
      throw new Error("Unable to get items, check webview");
    }

    if (driveDocument.selectFirst("title:contains(Error 404 \\(Not found\\))") != null) return new MangasPage([], false);

    if (page === 1) this.nextPageToken = "";
    const post = await this.createPost(driveDocument, folderId, this.nextPageToken, genMultiFormReq);
    const parsed = parseJsonIn<PostResponse>(await this.client.execute(post));

    if (parsed.items == null) throw new Error("Failed to load items, please log in through webview");
    for (const it of parsed.items) {
      if (it.mimeType.startsWith("video")) {
        const anime = SAnime.create();
        anime.title = this.trimAnimeInfo ? trimInfo(it.title) : it.title;
        anime.url = JSON.stringify({
          url: `https://drive.google.com/uc?id=${it.id}`,
          type: "single",
          info: { title: it.title, size: fileSizeOf(it.fileSize) },
        } satisfies LinkData);
        anime.thumbnail_url = "";
        animeList.push(anime);
      }
      if (it.mimeType.endsWith(".folder")) {
        const anime = SAnime.create();
        anime.title = this.trimAnimeInfo ? trimInfo(it.title) : it.title;
        anime.url = JSON.stringify({ url: `https://drive.google.com/drive/folders/${it.id}${recurDepth}`, type: "multi" } satisfies LinkData);
        anime.thumbnail_url = "";
        animeList.push(anime);
      }
    }

    this.nextPageToken = parsed.nextPageToken ?? null;

    return new MangasPage(animeList, this.nextPageToken != null);
  }

  // ============================== Settings ==============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    // ponytail: upstream validates each path while typing and toasts "Restart App to apply changes"; neither exists
    // here, and the list is read on every call so no restart is needed
    const domains = new EditTextPreference(screen.context);
    domains.key = DOMAIN_PREF_KEY;
    domains.title = "Enter drive paths to be shown in extension";
    domains.summary = "Enter links of drive folders to be shown in extension\nEnter as a semicolon `;` separated list";
    domains.setDefaultValue(DOMAIN_PREF_DEFAULT);
    domains.dialogTitle = "Path list";
    screen.addPreference(domains);

    for (const [key, title, def] of [
      [TRIM_ANIME_KEY, "Trim info from anime titles", TRIM_ANIME_DEFAULT],
      [TRIM_EPISODE_NAME_KEY, "Trim info from episode name", TRIM_EPISODE_NAME_DEFAULT],
      [TRIM_EPISODE_INFO_KEY, "Trim info from episode info", TRIM_EPISODE_INFO_DEFAULT],
      [SCANLATOR_ORDER_KEY, "Switch order of file path and size", SCANLATOR_ORDER_DEFAULT],
    ] as const) {
      const p = new SwitchPreferenceCompat(screen.context);
      p.key = key;
      p.title = title;
      p.setDefaultValue(def);
      screen.addPreference(p);
    }
  }
}

// https://github.com/yt-dlp/yt-dlp/blob/8f0be90ecb3b8d862397177bb226f17b245ef933/yt_dlp/extractor/youtube.py#L573
async function generateSapisidhashHeader(SAPISID: string, origin = "https://drive.google.com"): Promise<string> {
  const timeNow = Math.floor(Date.now() / 1000);
  // SAPISIDHASH algorithm from https://stackoverflow.com/a/32065323
  const sapisidhash = await sha1Hex(`${timeNow} ${SAPISID} ${origin}`);
  return `SAPISIDHASH ${timeNow}_${sapisidhash}`;
}
