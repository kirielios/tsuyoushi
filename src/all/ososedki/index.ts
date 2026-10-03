// Port of keiyoushi/extensions-source src/all/ososedki/Ososedki.kt
import {
  HttpUrl,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseAs,
  parseHtml,
  tryParseInstant,
  toHttpUrl,
  toHttpUrlOrNull,
  substringBefore,
  KeiSource,
  type Chain,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList,
  type Response,
} from "../../../sdk/index.ts";

// AlbumsResponseDto.kt
interface AlbumsResponseDto {
  html: string;
  hasMore?: boolean;
}

// Interceptor.kt
async function imageFallbackInterceptor(chain: Chain): Promise<Response> {
  const response = await chain.proceed(chain.request());
  if (response.code !== 404) return response;

  const url = HttpUrl.parse(response.url);
  const segs = url.pathSegments;
  if (segs.length < 3 || segs[0] !== "images" || segs[1] !== "a" || segs[2] !== "1280") return response;

  const newUrl = url.newBuilder().setPathSegment(2, "604").build();
  return chain.proceed({ ...chain.request(), url: newUrl.toString() });
}

const BASE_HOST = "ososedki.com";

const ENTRY_SELECTOR = "article.gallery-item:has(a.gallery-link)";
const ENTRY_LINK_SELECTOR = "a.gallery-link";
const ENTRY_TITLE_SELECTOR = "h3";
const ENTRY_IMAGE_SELECTOR = "img.gallery-img";
const ENTRY_AUTHOR_SELECTOR = "span.badge:not(.bg-dark)";

const TITLE_SELECTOR = "h1";
const AUTHOR_SELECTOR = "a[href^=/model/]";
const COSPLAY_SELECTOR = "a[href^=/cosplay/]";
const FANDOM_SELECTOR = "a[href^=/fandom/]";

const PAGE_SELECTOR = "#photos a[href^=/images/], #photos a[href^=https://ososedki.com/images/]";

const ALBUM_ID_REGEX = /^-?\d+_\d+$/;
const ALBUM_ID_PARTS_REGEX = /^(-?\d+)_(\d+)$/;
const DATE_PUBLISHED_REGEX = /"datePublished":"([^"]+)"/;
const TITLE_SUFFIX_REGEX = /\s*\(\d+\s+leaked\s+photos\)\s+from\s+Onlyfans,\s+Patreon\s+and\s+Fansly\s*$/i;

const SUPPORTED_FILTER_TYPES = new Set(["model", "cosplay", "fandom"]);

const distinct = <T>(a: T[]): T[] => [...new Set(a)];
const takeIfNotBlank = (s: string): string | undefined => (s.trim() ? s : undefined);

export default class Ososedki extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(imageFallbackInterceptor);
  }

  // ========================= Popular =========================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getAlbums(page, "top", "1");
  }

  // ========================= Latest =========================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getAlbums(page);
  }

  // ========================= Search =========================

  protected override async getMangasByUrl(url: URL, page: number): Promise<MangasPage> {
    if (!this.isSupportedHost(url.hostname)) return new MangasPage([], false);

    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const albumId = this.toAlbumIdOrNull(segments);
    if (albumId != null) {
      const manga = SManga.create();
      manga.url = albumId;
      const updated = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
      return new MangasPage([updated], false);
    }

    const typeAndValue = this.toTypeAndValueOrNull(segments);
    if (!typeAndValue) return new MangasPage([], false);

    return this.getAlbums(page, typeAndValue[0], typeAndValue[1]);
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) return this.getPopularManga(page);

    return this.getAlbums(page, "search", trimmedQuery);
  }

  // ========================= Details =========================

  override getMangaUrl(manga: SManga): string {
    return this.buildPhotoUrl(manga.url).toString();
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.buildPhotoUrl(manga.url).toString())).asJsoup();
    const albumId = manga.url;

    const modelTags = this.extractTags(document, AUTHOR_SELECTOR);
    const cosplayTags = this.extractTags(document, COSPLAY_SELECTOR);
    const fandomTags = this.extractTags(document, FANDOM_SELECTOR);

    let parsedTitle = [modelTags[0], cosplayTags[0], fandomTags[0]].filter((it) => it !== undefined).join(" - ");
    if (!parsedTitle.trim()) {
      parsedTitle = (document.selectFirst(TITLE_SELECTOR)?.text().trim().replace(TITLE_SUFFIX_REGEX, "").trim()) ?? "";
    }

    if (!parsedTitle.trim()) throw new Error(`Title is missing for album id: ${albumId}`);

    const updatedManga = SManga.create();
    updatedManga.url = albumId;
    updatedManga.title = parsedTitle;
    updatedManga.thumbnail_url = this.getCoverFromAlbumId(albumId) ?? this.imgSrc(document.selectFirst(ENTRY_IMAGE_SELECTOR)) ?? document.selectFirst("meta[property=og:image]")?.attr("content");
    updatedManga.author = takeIfNotBlank(modelTags.join(", "));
    updatedManga.artist = takeIfNotBlank(cosplayTags.join(", "));
    updatedManga.genre = takeIfNotBlank(distinct([...modelTags, ...cosplayTags, ...fandomTags]).join(", "));
    updatedManga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK

    const chapter = SChapter.create();
    chapter.url = albumId;
    chapter.name = "Gallery";
    chapter.chapter_number = 0;
    chapter.date_upload = this.parseUploadDate(document);

    return new SMangaUpdate(updatedManga, [chapter]);
  }

  // ========================= Chapters =========================

  override getChapterUrl(chapter: SChapter): string {
    return this.buildPhotoUrl(chapter.url).toString();
  }

  // ========================= Pages =========================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.buildPhotoUrl(chapter.url).toString())).asJsoup();

    const imageUrls = distinct(document.select(PAGE_SELECTOR).map((it) => it.absUrl("href")).filter((s) => s.trim()));
    // sortedBy is stable, like Array.prototype.sort
    imageUrls.sort((a, b) => this.extractPageNumber(a) - this.extractPageNumber(b));

    return imageUrls.map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  private async getAlbums(page: number, type?: string, value?: string): Promise<MangasPage> {
    const builder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("api").addPathSegment("albums").addQueryParameter("page", String(page));
    if (type?.trim() && value?.trim()) {
      builder.addQueryParameter("type", type);
      builder.addQueryParameter("value", value);
    }
    const url = builder.build();

    const data = parseAs<AlbumsResponseDto>((await this.client.get(url.toString())).text());
    // Jsoup.parseBodyFragment(html, baseUrl)
    const document = parseHtml(this.host.load, data.html, this.baseUrl);

    const mangas = document.select(ENTRY_SELECTOR).map((it) => this.toSManga(it));

    return new MangasPage(mangas, data.hasMore ?? false);
  }

  private toSManga(element: Element): SManga {
    const albumUrl = toHttpUrlOrNull(element.selectFirst(ENTRY_LINK_SELECTOR)?.absUrl("href"));
    if (!albumUrl) throw new Error("Unable to parse album URL from listing element");

    const albumId = this.toAlbumIdOrNull(albumUrl.pathSegments);
    if (albumId == null) throw new Error(`Unable to parse album id from URL: ${albumUrl}`);

    let parsedTitle = element.selectFirst(ENTRY_TITLE_SELECTOR)?.text().trim() ?? "";
    if (!parsedTitle.trim()) {
      const alt = element.selectFirst(ENTRY_IMAGE_SELECTOR)?.attr("alt");
      parsedTitle = alt === undefined ? "" : substringBefore(alt, " nude.").trim();
    }

    if (!parsedTitle.trim()) throw new Error(`Title is missing for album id: ${albumId}`);

    const manga = SManga.create();
    manga.url = albumId;
    manga.title = parsedTitle;
    manga.thumbnail_url = this.imgSrc(element.selectFirst(ENTRY_IMAGE_SELECTOR));
    manga.author = takeIfNotBlank(element.selectFirst(ENTRY_AUTHOR_SELECTOR)?.text().trim() ?? "");
    manga.status = SManga.COMPLETED;
    return manga;
  }

  private imgSrc(el: Element | null): string | undefined {
    if (!el) return undefined;
    if (el.hasAttr("data-src")) return el.absUrl("data-src");
    if (el.hasAttr("src")) return el.absUrl("src");
    return undefined;
  }

  private extractTags(document: Document, selector: string): string[] {
    return distinct(
      document
        .select(selector)
        .eachText()
        .map((it) => it.trim())
        .filter((s) => s),
    );
  }

  private getCoverFromAlbumId(albumId: string): string | undefined {
    const match = ALBUM_ID_PARTS_REGEX.exec(albumId);
    if (!match) return undefined;
    const [, ownerId, postId] = match;

    return toHttpUrl(this.baseUrl).newBuilder().addPathSegment("images").addPathSegment("albums").addPathSegment(ownerId).addPathSegment(`${postId}.webp`).build().toString();
  }

  private parseUploadDate(document: Document): number {
    const jsonLd = document
      .select("script[type=application/ld+json]")
      .map((it) => it.data())
      .find((it) => DATE_PUBLISHED_REGEX.test(it));
    if (jsonLd === undefined) return 0;

    return tryParseInstant(DATE_PUBLISHED_REGEX.exec(jsonLd)?.[1]);
  }

  private buildPhotoUrl(albumId: string): HttpUrl {
    return toHttpUrl(this.baseUrl).newBuilder().addPathSegment("photos").addPathSegment(albumId).build();
  }

  private isSupportedHost(host: string): boolean {
    return host.toLowerCase() === BASE_HOST || host.toLowerCase() === `www.${BASE_HOST}`;
  }

  private extractPageNumber(url: string): number {
    const last = toHttpUrlOrNull(url)?.pathSegments.at(-1);
    if (last === undefined) return Number.MAX_SAFE_INTEGER;
    const n = substringBefore(last, ".");
    return /^[+-]?\d+$/.test(n) ? Number.parseInt(n, 10) : Number.MAX_SAFE_INTEGER;
  }

  private toAlbumIdOrNull(segments: string[]): string | null {
    const normalized = segments.map((it) => it.trim());
    const photosIndex = normalized.indexOf("photos");
    if (photosIndex === -1 || photosIndex + 1 >= normalized.length) return null;

    const albumId = normalized[photosIndex + 1];
    return ALBUM_ID_REGEX.test(albumId) ? albumId : null;
  }

  private toTypeAndValueOrNull(segments: string[]): [string, string] | null {
    const normalized = segments.map((it) => it.trim());
    if (normalized.length < 2) return null;

    const type = normalized[0];
    if (!SUPPORTED_FILTER_TYPES.has(type)) return null;

    const value = normalized[1].replaceAll("+", " ").trim();
    return value ? [type, value] : null;
  }
}
