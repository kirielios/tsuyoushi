// Port of keiyoushi/extensions-source src/en/mangago/Mangago.kt
import {
  DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, SwitchPreferenceCompat, ZoneOffset,
  Canvas, aesCbcDecryptNoPadding, distinctBy, hexBytes, imageSize, md5, toHex, toHttpUrl, urlWithoutDomain, utf8,
  type ClientBuilder, type Chain, type Document, type Element, type PreferenceScreen, type Response,
} from "../../../sdk/index.ts";
import { GenreFilterGroup, SortFilter, StatusFilterGroup, isUriFilter } from "./filters.ts";
import * as SoJsonV4Deobfuscator from "./sojsonv4deobfuscator.ts";

const REMOVE_RAW_PREF = "pref_remove_raw";
const REMOVE_TITLE_VERSION_PREF = "REMOVE_TITLE_VERSION";
const ALT_NAME_PREFIX = "Alternative Names:";

const DATE_FORMAT = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);
const KEY_LOCATION_REGEX = /str\.charAt\(\s*(\d+)\s*\)/g;
const IMG_SRCS_REGEX = /var imgsrcs\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/;
const TOTAL_PAGES_REGEX = /total_pages\s*=\s*(\d+)/;
const HEX_VARIABLE_REGEX = /var\s+(key|iv)\s*=\s*CryptoJS\.enc\.Hex\.parse\("([0-9a-zA-Z]+)"\)/g;
const TITLE_REGEX =
  /^(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|𖤍.+?𖤍|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩)\s*)+|(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|𖤍.+?𖤍|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/\s*Official)\s*)+$/iu;

/** String.toIntOrNull() */
const toIntOrNull = (s: string | null | undefined): number | null => (s != null && /^[+-]?\d+$/.test(s) && Math.abs(Number(s)) <= 2 ** 31 ? Number.parseInt(s, 10) : null);

export default class Mangago extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor((chain) => this.imageDescrambler(chain))
      .addInterceptor((request) => this.addCookie(request, [["_m_superu", "1"]])) // keiyoushi's addCookie
      .rateLimit(1, 1000, (it) => it.hostname === new URL(this.baseUrl).hostname);
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the base URL's host on every matching request. */
  private addCookie<T extends { url: string }>(request: T, cookies: [string, string][]): T {
    const domain = new URL(this.baseUrl).hostname;
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    }
    return request;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/genre/all/${page}/?f=1&o=1&sortby=view&e=`);
    return this.parseMangasPage(response);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/genre/all/${page}/?f=1&o=1&sortby=update_date&e=`);
    return this.parseMangasPage(response);
  }

  private parseMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document
      .select(".updatesli, .pic_list > li")
      .map((it) => this.mangaFromElement(it))
      .filter((it): it is SManga => it != null);
    const hasNextPage = document.selectFirst(".current+li > a") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga | null {
    const link = element.selectFirst(".thm-effect");
    if (!link) return null;
    const title = link.attr("title");
    if (!title.trim()) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(link.absUrl("href"));
    manga.title = title;
    const img = link.selectFirst("img");
    manga.thumbnail_url = img ? this.imgAttr(img) : undefined;
    return manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: URL;
    if (query.trim()) {
      url = new URL(`${this.baseUrl}/r/l_search`);
      url.searchParams.append("name", query);
      url.searchParams.append("page", String(page));
    } else {
      const genres: string[] = [];
      const excludedGenres: string[] = [];
      // query parameters are collected on a scratch URL so that the path segments can be added afterwards, as upstream's builder does
      const params = new URL(`${this.baseUrl}/genre/`);

      for (const filter of filters) {
        if (isUriFilter(filter)) filter.addToUrl(params);
        else if (filter instanceof GenreFilterGroup) {
          for (const genre of filter.state) {
            if (genre.state === Filter.TriState.STATE_EXCLUDE) excludedGenres.push(genre.name);
            else if (genre.state === Filter.TriState.STATE_INCLUDE) genres.push(genre.name);
          }
        }
      }

      const segment = genres.length === 0 ? "all" : genres.map(encodeURIComponent).join(",");
      url = new URL(`${this.baseUrl}/genre/${segment}/${page}`);
      params.searchParams.forEach((v, k) => url.searchParams.append(k, v));
      url.searchParams.append("e", excludedGenres.join(","));
    }

    return this.parseMangasPage(await this.client.get(url));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || segments[0] !== "read-manga" || !segments[1]) return null;

    const mangaUrl = `/read-manga/${segments[1]}/`;
    const manga = SManga.create();
    manga.url = mangaUrl;
    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    const h1 = document.selectFirst(".w-title h1")?.text();
    if (h1 != null) manga.title = this.removeTitleVersion ? h1.replace(TITLE_REGEX, "") : h1;

    const info = document.selectFirst("#information");
    if (info) {
      manga.thumbnail_url = info.selectFirst("img")?.attr("abs:src");
      const summary = info.selectFirst(".manga_summary")?.text();
      manga.description = summary && summary.toLowerCase() !== "not found..." ? summary : undefined;

      for (const element of info.select(".manga_info li, .manga_right tr")) {
        const label = element.selectFirst("b, label")?.text() ?? "";
        switch (label.toLowerCase()) {
          case "alternative:": {
            let raw = element.text();
            if (raw.startsWith(label)) raw = raw.slice(label.length);
            raw = raw.trim();
            const altNames = (raw.includes("/") || raw.includes(";") ? raw.split(/[/;]/) : raw.split(","))
              .map((it) => it.trim())
              .filter((it) => it.length > 0 && it.toLowerCase() !== "none");
            if (altNames.length > 0) {
              let d = manga.description ?? "";
              if (d.length > 0) d += "\n\n";
              d += `${ALT_NAME_PREFIX}\n${altNames.map((it) => `- ${it}`).join("\n")}`;
              manga.description = d;
            }
            break;
          }
          case "status:": {
            const s = element.selectFirst("span")?.text().toLowerCase();
            manga.status = s === "ongoing" ? SManga.ONGOING : s === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;
            break;
          }
          case "author(s):":
          case "author:":
            manga.author = element.select("a").map((it) => it.text()).join(", ");
            break;
          case "genre(s):":
            manga.genre = element.select("a").map((it) => it.text()).join(", ");
            break;
        }
      }
    }
    return manga;
  }

  private parseChapterList(document: Document): SChapter[] {
    const chapters: SChapter[] = [];
    for (const element of document.select(":is(table#raws_table, table#chapter_table) > tbody > tr, table.uk-table > tbody > tr")) {
      const link = element.selectFirst("a.chico");
      if (!link) continue;
      if (link.attr("href").includes("/raw/") && this.removeRaws) continue;
      const name = link.text();
      if (!name) continue;
      const date = DATE_FORMAT.tryParseDate(element.select("td:last-child").text(), ZoneOffset.UTC);
      const scanlator = element.selectFirst("td.no a, td.uk-table-shrink a")?.text() || undefined;
      const chapterUrl = link.absUrl("href");

      const chapter = SChapter.create();
      chapter.url = this.stableChapterId(date, name, scanlator);
      chapter.name = name;
      chapter.date_upload = date;
      chapter.scanlator = scanlator ?? "Unknown";
      chapter.memo = { chapterUrl };
      chapters.push(chapter);
    }
    return chapters;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const sameAuthor = document
      .select("div.also_like:has(h4:contains(Other manga by the same author)) + .pic_list .updatesli")
      .map((it) => this.mangaFromElement(it))
      .filter((it): it is SManga => it != null);
    const alsoLiked: SManga[] = [];
    for (const element of document.select(".also-like li")) {
      const link = element.selectFirst('h4 a[href*="/read-manga/"][title]');
      if (!link) continue;
      const title = link.attr("title").trim() ? link.attr("title") : link.text();
      if (!title) continue;

      const m = SManga.create();
      m.url = urlWithoutDomain(link.absUrl("href"));
      m.title = title;
      const img = element.selectFirst("img");
      m.thumbnail_url = img ? this.imgAttr(img) : undefined;
      alsoLiked.push(m);
    }
    return distinctBy([...sameAuthor, ...alsoLiked], (it) => it.url);
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.readerUrl(chapter);
  }

  // Mutex + LruCache(10) upstream: calls are serialised through a promise chain, the cache drops its oldest entry past 10
  private pageBatchLock: Promise<unknown> = Promise.resolve();
  private readonly pageBatchCache = new Map<string, Map<number, string>>();

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.readerUrl(chapter))).asJsoup();
    const availableImages = await this.getChapterImageUrls(document);
    const script = document.selectFirst("script:containsData(total_pages)")?.data();
    const totalPages = script != null ? toIntOrNull(TOTAL_PAGES_REGEX.exec(script)?.[1]) : null;
    if (totalPages == null) return [];
    const curl = document.selectFirst("input#curl")?.attr("value");
    const urlTemplate = curl?.includes("{page}") ? curl : null;
    if (urlTemplate == null) return [];
    const readerPrefix = this.getReaderPrefix(document, urlTemplate);
    const batchSize = availableImages.filter((it) => it.length > 0).length;
    if (batchSize <= 0) return [];

    return Array.from({ length: totalPages }, (_, index) => {
      const imageUrl = availableImages[index] ?? "";
      if (imageUrl.length > 0) return new Page(index, "", imageUrl);
      const pageNumber = index + 1;
      const batchStart = Math.floor((pageNumber - 1) / batchSize) * batchSize + 1;
      const rest = urlTemplate.replace(/^\//, "").replace("{page}", String(batchStart));
      const batchUrl = new URL(rest, `${readerPrefix.replace(/\/+$/, "")}/`).href;
      return new Page(index, `${batchUrl}#${index}`);
    });
  }

  override async getImageUrl(page: Page): Promise<string> {
    const pageUrl = new URL(page.url);
    const index = toIntOrNull(pageUrl.hash.replace(/^#/, ""));
    if (index == null) throw new Error("Missing page index");
    pageUrl.hash = "";
    const batchUrl = pageUrl.href;

    const run = async () => {
      let batch = this.pageBatchCache.get(batchUrl);
      if (!batch) {
        const document = (await this.client.get(batchUrl)).asJsoup();
        batch = new Map();
        (await this.getChapterImageUrls(document)).forEach((imageUrl, imageIndex) => {
          if (imageUrl.length > 0) batch!.set(imageIndex, imageUrl);
        });
        this.pageBatchCache.set(batchUrl, batch);
        if (this.pageBatchCache.size > 10) this.pageBatchCache.delete(this.pageBatchCache.keys().next().value!);
      }

      const imageUrl = batch.get(index);
      if (imageUrl === undefined) throw new Error(`Unable to find image for page ${index + 1}`);
      batch.delete(index);
      if (batch.size === 0) this.pageBatchCache.delete(batchUrl);
      return imageUrl;
    };
    const result = this.pageBatchLock.then(run, run);
    this.pageBatchLock = result.catch(() => undefined);
    return result;
  }

  private readerUrl(chapter: SChapter): string {
    const url = chapter.memo.chapterUrl as string | undefined;
    if (url == null) throw new Error("Refresh chapter list");
    return url;
  }

  override imageRequest(page: Page) {
    const url = new URL(page.imageUrl!);
    // OkHttp's HttpUrl.host is the IDNA host, so a "_" survives; new URL keeps it too
    if (url.hostname.includes("_")) url.protocol = "http:";
    return { url: url.href, headers: this.headers };
  }

  private async imageDescrambler(chain: Chain): Promise<Response> {
    const request = chain.request();
    const response = await chain.proceed(request);
    const hash = new URL(request.url).hash.replace(/^#/, "");
    if (!hash.includes("desckey=")) return response;
    const fragment = hash;
    const key = fragment.substring(fragment.indexOf("desckey=") + "desckey=".length).split("&")[0];
    const amp = fragment.indexOf("&cols=");
    const cols = toIntOrNull(amp === -1 ? fragment : fragment.substring(amp + "&cols=".length));
    if (cols == null) return response;
    const body = await this.unscrambleImage(response.bytes(), key, cols);

    return response.withBody(body);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/genre/all/`)).asJsoup();
    return [...new Set(document.select("#genre_panel .genre_select_div[_id]").map((it) => it.attr("_id")).filter((it) => it.length > 0))];
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as string[] | null) ?? [];
    const list: Filter[] = [new Filter.Header("Ignored if using text search"), new SortFilter(), new StatusFilterGroup()];
    if (genres.length > 0) list.push(new GenreFilterGroup(genres));
    return FilterList(...list);
  }

  private async getChapterImageUrls(document: Document): Promise<string[]> {
    const imgsrcs = document.selectFirst("script:containsData(imgsrcs)")?.data();
    const encryptedText = imgsrcs != null ? IMG_SRCS_REGEX.exec(imgsrcs)?.[1] : undefined;
    if (encryptedText == null) return [];
    const encryptedImages = Uint8Array.from(atob(encryptedText.replace(/[\r\n\s]/g, "")), (c) => c.charCodeAt(0));

    const chapterJsUrl = document.selectFirst("script[src*=chapter.js]")?.absUrl("src");
    if (!chapterJsUrl) return [];
    const chapterJs = SoJsonV4Deobfuscator.decode((await this.client.get(chapterJsUrl)).text());
    const key = hexBytes(this.findHexEncodedVariable(chapterJs, "key"));
    const iv = hexBytes(this.findHexEncodedVariable(chapterJs, "iv"));

    // AES/CBC/ZEROBYTEPADDING: no padding check, trailing zero bytes are dropped
    const decrypted = await aesCbcDecryptNoPadding(key, iv, encryptedImages);
    let end = decrypted.length;
    while (end > 0 && decrypted[end - 1] === 0) end--;
    let imageList = new TextDecoder().decode(decrypted.subarray(0, end));
    imageList = this.unscrambleImageList(imageList, chapterJs);

    return imageList.split(",").map((imageUrl) => {
      if (imageUrl.includes("cspiclink")) {
        // SECURITY: upstream evaluates a slice of the site's chapter.js in QuickJS (getDescramblingKey) to get the
        // per-image descrambling key. Executing code served by a website is not ported.
        throw new Error("Mangago: descrambling keys need the site's JavaScript to be executed (QuickJS upstream), which the reader does not do");
      }
      return imageUrl;
    });
  }

  private findHexEncodedVariable(input: string, variable: string): string {
    for (const m of input.matchAll(HEX_VARIABLE_REGEX)) if (m[1] === variable) return m[2];
    return "";
  }

  private unscramble(text: string, keys: number[]): string {
    const result = [...text];
    for (const key of [...keys].reverse()) {
      for (let index = result.length - 1; index >= key; index--) {
        if (index % 2 !== 0) {
          const previous = result[index - key];
          result[index - key] = result[index];
          result[index] = previous;
        }
      }
    }
    return result.join("");
  }

  private unscrambleImageList(imageList: string, js: string): string {
    let result = imageList;
    try {
      const keyLocations = [...new Set([...js.matchAll(KEY_LOCATION_REGEX)].map((it) => Number.parseInt(it[1], 10)))];
      const keys = keyLocations.map((it) => {
        const ch = result[it];
        if (ch === undefined) throw new RangeError("StringIndexOutOfBoundsException");
        if (!/^\d$/.test(ch)) throw new SyntaxError("NumberFormatException");
        return Number.parseInt(ch, 10);
      });
      keyLocations.forEach((location, index) => {
        const at = location - index;
        result = result.slice(0, at) + result.slice(at + 1);
      });
      result = this.unscramble(result, keys);
    } catch (e) {
      // The image list is already unscrambled.
      if (!(e instanceof SyntaxError)) throw e;
    }
    return result;
  }

  private async unscrambleImage(image: Uint8Array, key: string, cols: number): Promise<Uint8Array> {
    const { width, height } = await imageSize(this.host, image);
    const canvas = new Canvas(this.host, width, height);
    const unitWidth = Math.floor(width / cols);
    const unitHeight = Math.floor(height / cols);
    const keyArray = key.split("a");

    for (let index = 0; index < cols * cols; index++) {
      const keyValue = toIntOrNull(keyArray[index] === "" ? "0" : keyArray[index]);
      if (keyValue == null) throw new Error(`For input string: "${keyArray[index]}"`);
      const destinationRow = Math.floor(keyValue / cols);
      const sourceRow = Math.floor(index / cols);
      const sourceX = (index - sourceRow * cols) * unitWidth;
      const sourceY = sourceRow * unitHeight;
      const destinationX = (keyValue - destinationRow * cols) * unitWidth;
      const destinationY = destinationRow * unitHeight;
      canvas.drawImage(image, sourceX, sourceY, unitWidth, unitHeight, destinationX, destinationY);
    }

    return canvas.encode("jpeg", 90);
  }

  private imgAttr(el: Element): string {
    if (el.hasAttr("data-cfsrc")) return el.absUrl("data-cfsrc");
    if (el.hasAttr("data-src")) return el.absUrl("data-src");
    if (el.hasAttr("data-lazy-src")) return el.absUrl("data-lazy-src");
    if (el.hasAttr("srcset")) return el.absUrl("srcset").split(" ")[0];
    return el.absUrl("src");
  }

  private getReaderPrefix(document: Document, urlTemplate: string): string {
    const location = toHttpUrl(document.location());
    const locSegments = location.pathSegments;
    const templateSegment = urlTemplate.replace(/^\//, "").split("/")[0];
    const baseHost = new URL(this.baseUrl).hostname;
    const isBaseHost = location.host === baseHost || location.host === baseHost.replace(/^www\./, "");

    if (isBaseHost && locSegments.length > 3 && locSegments[0] === "read-manga" && locSegments[2] === templateSegment) {
      return `${this.baseUrl}/read-manga/${locSegments[1]}`;
    }
    if (!isBaseHost && locSegments[0] === templateSegment) {
      const u = location.toURL();
      return `${u.protocol}//${u.host}/`;
    }
    throw new Error("Unexpected chapter URL structure");
  }

  private stableChapterId(date: number, name: string, scanlator?: string): string {
    return toHex(md5(utf8(`${date}:${name}:${scanlator ?? ""}`))).slice(-10);
  }

  private get removeRaws() {
    return this.preferences.getBoolean(REMOVE_RAW_PREF, true);
  }
  private get removeTitleVersion() {
    return this.preferences.getBoolean(REMOVE_TITLE_VERSION_PREF, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const raw = new SwitchPreferenceCompat(screen.context);
    raw.key = REMOVE_RAW_PREF;
    raw.title = "Hide RAW chapters";
    raw.setDefaultValue(true);
    screen.addPreference(raw);

    const version = new SwitchPreferenceCompat(screen.context);
    version.key = REMOVE_TITLE_VERSION_PREF;
    version.title = "Remove version information from entry titles";
    version.summary =
      "This removes version tags like '(Official)' or '(Yaoi)' from entry titles " +
      "and helps identify duplicate entries in your library. " +
      "To update existing entries, enable 'update library manga title' in advanced settings of app";
    version.setDefaultValue(false);
    screen.addPreference(version);
  }
}
