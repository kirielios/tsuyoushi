// Port of keiyoushi/extensions-source lib-multisrc/mangabox/MangaBox.kt (+ Dto.kt, MangaBoxLinkedCdnSet.kt,
// imagesize/ImageSize.kt, imagesize/ImageSizeGetter.kt, imagesize/WebpSizeGetter.kt)
import {
  Canvas,
  CheckBoxPreference,
  Filter,
  FilterList,
  GET,
  imageSize,
  KeiSource,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfter,
  toHttpUrl,
  type Chain,
  type ClientBuilder,
  type Document,
  type Element,
  type PreferenceScreen,
  type Request,
} from "../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, getGenreFilters, getSortFilters, getStatusFilters } from "./filters.ts";

// Dto.kt
interface ApiResponse {
  success?: boolean;
  data: { chapters: ApiChapter[] } | null;
}
interface ApiChapter {
  chapter_name: string | null;
  chapter_slug: string | null;
  chapter_num: number | null;
  updated_at: string | null;
}

interface ImageSize {
  w: number;
  h: number;
}

/** imagesize/WebpSizeGetter.kt: the size of a WebP from its first 30 bytes, null when it is not one. */
export function webpSize(b: Uint8Array): ImageSize | null {
  try {
    const ascii = (off: number, s: string) => [...s].every((c, i) => b[off + i] === c.charCodeAt(0));
    if (!(ascii(0, "RIFF") && ascii(8, "WEBP") && ascii(12, "VP8"))) return null;
    if (b.length < 30) throw new RangeError();
    const u16 = (o: number) => b[o] | (b[o + 1] << 8);
    const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
    switch (String.fromCharCode(b[15])) {
      case " ": // VP8 (lossy)
        return { w: u16(26) & 0x3fff, h: u16(28) & 0x3fff };
      case "L": {
        // VP8L (lossless)
        const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
        return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
      }
      case "X": // VP8X (extended)
        return { w: u24(24) + 1, h: u24(27) + 1 };
      default:
        throw new Error("Invalid WebP");
    }
  } catch {
    return null;
  }
}
const WEBP_RANGE = "bytes=0-29";

class MergeImage {
  constructor(
    readonly urls: string[],
    readonly size: ImageSize | null,
  ) {}
  toString(): string {
    if (this.urls.length === 1) return this.urls[0];
    const { w, h } = this.size!;
    const builder = toHttpUrl("https://127.0.0.1/merge").newBuilder().addQueryParameter("w", String(w)).addQueryParameter("h", String(h)).addQueryParameter("length", String(this.urls.length));
    this.urls.forEach((url, i) => builder.addQueryParameter(String(i), url));
    return builder.build().toString();
  }
}

/** MangaBoxLinkedCdnSet: an insertion-ordered set whose working CDN moves to the front. */
class MangaBoxLinkedCdnSet extends Set<string> {
  moveItemToFirst(item: string) {
    if (this.has(item) && this.values().next().value !== item) {
      const rest = [...this].filter((it) => it !== item);
      this.clear();
      [item, ...rest].forEach((it) => this.add(it));
    }
  }
}

const PREF_MERGE_IMAGES = "pref_merge_images";
const URL_PREFIX = "https://";
const cdnsRegex = /cdns\s*=\s*\[([^\]]+)]/;
const backupImageRegex = /backupImage\s*=\s*\[([^\]]+)]/;
const chapterImagesRegex = /chapterImages\s*=\s*\[([^\]]+)]/;
const FILTER_ID_MAP: Record<string, string> = {
  "newest|all": "1",
  "newest|completed": "2",
  "newest|ongoing": "3",
  "latest|all": "4",
  "latest|completed": "5",
  "latest|ongoing": "6",
  "topview|all": "7",
  "topview|completed": "8",
  "topview|ongoing": "9",
};

export abstract class MangaBox extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.mergeImagesInterceptor(chain)).addChainInterceptor((chain) => this.useAltCdnInterceptor(chain));
  }

  /** Upstream caches it and refreshes it from the preference's change listener; read on use here. */
  private get mergeImages(): boolean {
    return this.preferences.getBoolean(PREF_MERGE_IMAGES, false);
  }

  private get apiChapterListUrl() {
    return `${this.baseUrl}/api/manga/__SLUG__/chapters`;
  }
  private get apiChapterPageUrl() {
    return `${this.baseUrl}/manga/__MANGA__/__CHAPTER__`;
  }

  private readonly cdnSet = new MangaBoxLinkedCdnSet(); // Stores all unique CDNs that the extension can use to retrieve chapter images

  /** Requests tagged MangaBoxFallBackTag upstream (OkHttp request tags; newBuilder() copies them). */
  private readonly fallbackRequests = new WeakSet<Request>();
  private tagFallback(request: Request): Request {
    this.fallbackRequests.add(request);
    return request;
  }

  private static getBaseUrl(url: string): string {
    const u = new URL(url);
    return `${URL_PREFIX}${u.hostname}${u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : ""}`;
  }

  computeMangaSlug(manga: SManga): string {
    return manga.url.slice(manga.url.lastIndexOf("/") + 1);
  }

  getMangaSlug(manga: SManga): string {
    const slug = manga.memo?.slug;
    if (typeof slug === "string") return slug;
    const it = this.computeMangaSlug(manga);
    manga.url = `/manga/${it}`;
    manga.memo = { slug: it };
    return it;
  }

  /** Stitches split images (the 127.0.0.1/merge URLs built by getPageList). */
  protected async mergeImagesInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const url = request.url;
    if (!url.startsWith("https://127.0.0.1/merge?")) return chain.proceed(request);

    const q = toHttpUrl(url);
    const w = parseInt(q.queryParameter("w")!, 10);
    const h = parseInt(q.queryParameter("h")!, 10);
    const canvas = new Canvas(this.host, w, h);
    const length = parseInt(q.queryParameter("length")!, 10);
    let yOffset = 0;
    for (let i = 0; i < length; i++) {
      const imageUrl = q.queryParameter(String(i))!;
      const part = await chain.proceed(this.tagFallback({ ...request, url: imageUrl }));
      const bytes = part.bytes();
      const bitmap = await imageSize(this.host, bytes);
      canvas.drawImage(bytes, 0, 0, bitmap.width, bitmap.height, 0, yOffset);
      yOffset += bitmap.height;
    }
    return new Response(this.host, { status: 200, url, headers: { "content-type": "image/webp" }, body: await canvas.encode("webp", 100) });
  }

  protected async useAltCdnInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    if (!this.fallbackRequests.has(request)) return chain.proceed(request);

    if (this.cdnSet.size === 0) return chain.proceed(request);

    let originalResponse: Response | null;
    try {
      originalResponse = await chain.proceed(request);
    } catch {
      originalResponse = null;
    }

    if (originalResponse?.isSuccessful === true) {
      // Move working cdn to first so it gets priority during iteration
      this.cdnSet.moveItemToFirst(MangaBox.getBaseUrl(request.url));
      return originalResponse;
    }

    const original = toHttpUrl(request.url);
    for (const cdnUrl of [...this.cdnSet]) {
      const newUrl = toHttpUrl(cdnUrl).newBuilder().encodedPath(original.encodedPath).fragment(original.fragment).build();
      // Create a new request with the updated URL
      const newRequest = this.tagFallback({ ...request, url: newUrl.toString() });
      try {
        const tryResponse = await chain.proceed(newRequest);
        if (tryResponse.isSuccessful) {
          // Move working cdn to first so it gets priority during iteration
          this.cdnSet.moveItemToFirst(MangaBox.getBaseUrl(newRequest.url));
          return tryResponse;
        }
      } catch {
        // try the next CDN
      }
    }

    // If all CDNs fail, throw an error
    throw new Error("All CDN attempts failed.");
  }

  // The origin header causes cache misses on Cloudflare, which significantly increases response time
  protected override configureHeaders(headers: Headers): Headers {
    headers.delete("Origin");
    return headers;
  }

  popularUrlPath = "manga-list/hot-manga?page=";

  latestUrlPath = "manga-list/latest-manga?page=";

  simpleQueryPath = "search/story/";

  // ============================== Popular ==============================

  popularMangaSelector() {
    return ":is(div.truyen-list > div.list-truyen-item-wrap, div.comic-list > .list-comic-item-wrap):has(a[data-id])";
  }

  parsePopularManga(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const selector = this.popularMangaNextPageSelector();
    const hasNextPage = selector === "" ? false : document.select(selector).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parsePopularManga(await this.client.get(`${this.baseUrl}/${this.popularUrlPath}${page}`));
  }

  popularMangaFromElement(element: Element): SManga {
    return this.mangaFromElement(element);
  }

  popularMangaNextPageSelector() {
    return "div.group_page, div.group-page a:not([href]) + a:not(:contains(Last))";
  }

  // ============================== Latest ===============================

  latestUpdatesSelector() {
    return this.popularMangaSelector();
  }

  parseLatestUpdates(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(this.latestUpdatesSelector()).map((it) => this.latestUpdatesFromElement(it));
    const selector = this.latestUpdatesNextPageSelector();
    const hasNextPage = selector === "" ? false : document.select(selector).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseLatestUpdates(await this.client.get(`${this.baseUrl}/${this.latestUrlPath}${page}`));
  }

  latestUpdatesFromElement(element: Element): SManga {
    return this.mangaFromElement(element);
  }

  latestUpdatesNextPageSelector() {
    return this.popularMangaNextPageSelector();
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let response: Response;
    if (query.trim()) {
      const url = toHttpUrl(`${this.baseUrl}/${this.simpleQueryPath}`).newBuilder().addPathSegment(this.normalizeSearchQuery(query)).addQueryParameter("page", String(page)).build();
      response = await this.client.get(url.toString());
    } else {
      const url = toHttpUrl(`${this.baseUrl}/genre`).newBuilder();
      let sort: string | null = null;
      let status: string | null = null;
      for (const filter of filters) {
        if (filter instanceof SortFilter) sort = filter.toUriPart();
        else if (filter instanceof StatusFilter) status = filter.toUriPart();
        else if (filter instanceof GenreFilter) {
          const it = filter.toUriPart();
          if (it != null) url.addPathSegment(it);
        }
      }
      const id = sort != null && status != null ? FILTER_ID_MAP[`${sort}|${status}`] : undefined;
      if (id != null) url.addQueryParameter("filter", id);
      url.addQueryParameter("page", String(page));
      response = await this.client.get(url.build().toString());
    }

    const document = response.asJsoup();
    const mangas = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
    const selector = this.searchMangaNextPageSelector();
    const hasNextPage = selector === "" ? false : document.select(selector).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  searchMangaSelector() {
    return ".panel_story_list .story_item, div.list-truyen-item-wrap, div.list-comic-item-wrap";
  }

  searchMangaFromElement(element: Element) {
    return this.mangaFromElement(element);
  }

  searchMangaNextPageSelector() {
    return "a.page_select + a:not(.page_last), a.page-select + a:not(.page-last)";
  }

  private mangaFromElement(element: Element, urlSelector = "h3 a"): SManga {
    const manga = SManga.create();
    const urlElement = element.selectFirst(urlSelector)!;
    manga.url = substringAfter(urlElement.attr("abs:href"), this.baseUrl); // intentionally not using setUrlWithoutDomain
    manga.memo = { slug: this.computeMangaSlug(manga) };
    manga.title = urlElement.text();
    manga.thumbnail_url = element.selectFirst("img")!.attr("abs:src");
    return manga;
  }

  // ============================== Details ==============================

  mangaDetailsMainSelector = "div.manga-info-top, div.panel-story-info";

  thumbnailSelector = "div.manga-info-pic img, span.info-image img";

  descriptionSelector = "div#noidungm, div#panel-story-info-description, div#contentBox";

  altNameSelector = ".story-alternative, tr:has(.info-alternative) h2";

  altName = "Alternative Name: ";

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${this.getMangaSlug(manga)}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    return this.parseMangaDetails((await this.client.get(url)).asJsoup());
  }

  private checkForRedirectMessage(document: Document) {
    if (document.select("body").text().startsWith("REDIRECT :")) throw new Error("Source URL has changed");
  }

  parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    if (/^https?:/i.test(document.location())) {
      manga.url = document.location();
      this.getMangaSlug(manga); // this updates the url and slug
    }

    const infoElement = document.selectFirst(this.mangaDetailsMainSelector);
    if (infoElement != null) {
      manga.title = infoElement.selectFirst("h1, h2")!.text();
      manga.author = infoElement.select("li:contains(author) a, td:containsOwn(author) + td a").eachText().join(", ");
      manga.status = this.parseStatus(infoElement.select("li:contains(status), td:containsOwn(status) + td").text());
      manga.genre =
        infoElement
          .selectFirst("div.manga-info-top li:contains(genres)")
          ?.select("a")
          .map((it) => it.text())
          .join(", ") ?? // kakalot
        infoElement
          .select("td:containsOwn(genres) + td a")
          .map((it) => it.text())
          .join(", "); // nelo
    } else {
      this.checkForRedirectMessage(document);
    }

    manga.description = document
      .selectFirst(this.descriptionSelector)
      ?.ownText()
      .replace(new RegExp(`^${manga.title} summary:\\s`), "")
      .replace(/<\s*br\s*\/?>/g, "\n")
      .replace(/<[^>]*>/g, "");
    manga.thumbnail_url = document.selectFirst(this.thumbnailSelector)!.attr("abs:src");

    // add alternative name to manga description
    const altNameElement = document.selectFirst(this.altNameSelector);
    if (altNameElement != null) {
      const altNameText = altNameElement.ownText();
      if (altNameText !== "") {
        manga.description = !manga.description ? this.altName + altNameText : `${manga.description}\n\n${this.altName}${altNameText}`;
      }
    }
    return manga;
  }

  private parseStatus(status: string | null): number {
    if (status == null) return SManga.UNKNOWN;
    if (status.includes("Ongoing")) return SManga.ONGOING;
    if (status.includes("Completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  // ============================= Chapters ==============================

  async parseChapterList(manga: SManga): Promise<SChapter[]> {
    const slug = this.getMangaSlug(manga);
    const response = await this.client.get(`${this.apiChapterListUrl.replace("__SLUG__", slug)}?limit=-1`);
    let apiResult: ApiResponse;
    try {
      apiResult = response.parseAs<ApiResponse>();
    } catch {
      return [];
    }
    if (!apiResult.success) return [];

    return (apiResult.data?.chapters ?? []).flatMap((apiChapter) => {
      const chapterSlug = apiChapter.chapter_slug;
      if (chapterSlug == null) return [];
      const chapter = SChapter.create();
      chapter.name = apiChapter.chapter_name ?? "Chapter";
      chapter.url = this.apiChapterPageUrl.replace("__MANGA__", slug).replace("__CHAPTER__", chapterSlug);
      chapter.chapter_number = apiChapter.chapter_num ?? 0;
      chapter.scanlator = this.baseUrl.replace("https://", "");
      const t = apiChapter.updated_at != null ? Date.parse(apiChapter.updated_at) : NaN;
      chapter.date_upload = Number.isNaN(t) ? 0 : t;
      return [chapter];
    });
  }

  // =============================== Pages ===============================

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url.startsWith("http") ? chapter.url : super.getChapterUrl(chapter);
  }

  private extractArray(scriptContent: string, regex: RegExp): string[] {
    const match = regex.exec(scriptContent);
    return match
      ? match[1].split(",").map((it) => {
          let s = it.trim();
          if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1); // removeSurrounding("\"")
          s = s.replaceAll("\\/", "/");
          return s.endsWith("/") ? s.slice(0, -1) : s;
        })
      : [];
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.getChapterUrl(chapter));
    const document = response.asJsoup();
    const content = document
      .select("script:containsData(cdns =)")
      .map((it) => it.data())
      .join("\n");
    const cdns = [...this.extractArray(content, cdnsRegex), ...this.extractArray(content, backupImageRegex)];
    const chapterImages = this.extractArray(content, chapterImagesRegex);

    // Add all parsed cdns to set
    cdns.forEach((it) => this.cdnSet.add(it));

    let imageUrls: string[];
    if (chapterImages.length) {
      const httpUrl = toHttpUrl(cdns[0]);
      imageUrls = chapterImages.map((imagePath) =>
        httpUrl
          .newBuilder()
          .encodedPath(`/${imagePath}`.replace("//", "/")) // replace ensures that there's at least one trailing slash prefix
          .build()
          .toString(),
      );
    } else {
      imageUrls = document.select("div.container-chapter-reader > img").map((img) => img.absUrl("src"));
    }

    if (this.mergeImages) {
      const headers = this.headersBuilder();
      headers.set("Range", WEBP_RANGE);
      const sizes = await Promise.all(
        imageUrls.map(async (url) => {
          try {
            const res = await this.client.execute(this.tagFallback(GET(url, headers)), true);
            return webpSize(res.bytes());
          } catch {
            return null;
          }
        }),
      );

      const imageList: MergeImage[] = [];
      imageUrls.forEach((url, i) => {
        const size = sizes[i];
        const prev = imageList.at(-1);
        const prevSize = prev?.size;
        if (
          size != null && // size is known
          prevSize != null && // previous size is known
          size.w === prevSize.w && // widths are equal
          3 * prevSize.w > 2 * prevSize.h + size.h // merged image is not too long
        ) {
          prev!.urls.push(url);
          prevSize.h += size.h;
        } else {
          imageList.push(new MergeImage([url], size));
        }
      });
      return imageList.map((image, i) => new Page(i, document.location(), image.toString()));
    }
    return imageUrls.map((url, i) => new Page(i, document.location(), url));
  }

  override imageRequest(page: Page): Request {
    return GET(page.imageUrl!, this.headers); // Headers are sometimes not added for image requests for some reason
  }

  /** getImage sends imageRequest tagged for the CDN fallback (a request tag upstream). */
  override getImage(page: Page): Promise<Response> {
    return this.client.execute(this.tagFallback(this.imageRequest(page)));
  }

  // ============================== Updates ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([
      fetchDetails ? (async () => (await this.getMangaByUrl(new URL(this.getMangaUrl(manga)))) ?? manga)() : manga,
      fetchChapters ? this.parseChapterList(manga) : chapters,
    ]);
    return new SMangaUpdate(m, c);
  }

  // ============================== Filters ==============================

  // Based on change_alias JS function from Mangakakalot's website
  normalizeSearchQuery(query: string): string {
    let str = query.toLowerCase();
    str = str.replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a");
    str = str.replace(/[èéẹẻẽêềếệểễ]/g, "e");
    str = str.replace(/[ìíịỉĩ]/g, "i");
    str = str.replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o");
    str = str.replace(/[ùúụủũưừứựửữ]/g, "u");
    str = str.replace(/[ỳýỵỷỹ]/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/!|@|%|\^|\*|\(|\)|\+|=|<|>|\?|\/|,|\.|:|;|'| |"|&|#|\[|]|~|-|$|_/g, "_");
    str = str.replace(/_+_/g, "_");
    str = str.replace(/^_+|_+$/g, "");
    return str;
  }

  override getFilterList(): FilterList {
    return FilterList(
      new Filter.Header("NOTE: Ignored if using text search!"),
      new Filter.Separator(),
      new SortFilter(getSortFilters()),
      new StatusFilter(getStatusFilters()),
      new GenreFilter(getGenreFilters()),
    );
  }

  // ============================= Utilities =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new CheckBoxPreference(screen.context);
    pref.key = PREF_MERGE_IMAGES;
    pref.title = "Merge Split Images";
    pref.summary = "Images are sometimes split vertically. This setting enables detecting and merging split images. Note that this isn't 100% accurate.";
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }
}
