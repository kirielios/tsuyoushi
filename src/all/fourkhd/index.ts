// Port of keiyoushi/extensions-source src/all/fourkhd/FourKHD.kt (+ Dto.kt)
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  ifBlank,
  isBlank,
  parseHtml,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type Element,
  type HttpUrl,
  type Response,
} from "../../../sdk/index.ts";

// --- Dto.kt
interface PostDto {
  id?: number;
  date?: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  jetpack_featured_media_url?: string | null;
  _embedded?: EmbeddedDto | null;
}
interface EmbeddedDto {
  "wp:featuredmedia"?: { source_url?: string }[] | null;
  "wp:term"?: { name?: string }[][] | null;
}

const IMAGE_URL_REGEX = /\.(?:jpe?g|png|webp|gif|avif)(?:$|\?)/i;
const SLUG_PATH_REGEX = /\/([^/]+)\.html(?:\/\d+)?\/?$/;
const CONTENT_PATH_REGEX = /^\/content\//i;
const DEEPLINK_HOSTS = new Set(["zgmz.uuss.uk", "4khd.com"]);
const THUMBNAIL_CDN_HOST = "img.4khd.com";
const PAGE_CDN_HOST = "img.uuss.uk";
const POST_ID_QUERY = "post_id";

/** Kotlin's String.trim(char) */
const trimChar = (s: string, c: string) => s.replace(new RegExp(`^${c}+|${c}+$`, "g"), "");
/** String.toIntOrNull() */
const toIntOrNull = (s: string | null | undefined) => (s != null && /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

export default class FourKHD extends KeiSource {
  private get apiUrl() {
    return toHttpUrl(`${this.baseUrl}/index.php`);
  }
  private readonly pageSize = 20;

  private postsUrl(page: number, orderby: string) {
    return this.apiUrl
      .newBuilder()
      .addQueryParameter("rest_route", "/wp/v2/posts")
      .addQueryParameter("page", String(page))
      .addQueryParameter("per_page", String(this.pageSize))
      .addQueryParameter("_embed", "1")
      .addQueryParameter("orderby", orderby);
  }

  // ========================= Popular =========================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.postsToMangaPage(await this.client.get(this.postsUrl(page, "modified").build().toString()));
  }

  // ========================= Latest =========================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.postsToMangaPage(await this.client.get(this.postsUrl(page, "date").build().toString()));
  }

  // ========================= Search =========================

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const builder = this.postsUrl(page, "date");

    if (!isBlank(query)) builder.addQueryParameter("search", query);

    return this.postsToMangaPage(await this.client.get(builder.build().toString()));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const slug = this.deeplinkSlugFromQuery(url.toString());
    if (slug == null) return null;
    const requestUrl = this.apiUrl.newBuilder().addQueryParameter("rest_route", "/wp/v2/posts").addQueryParameter("slug", slug).addQueryParameter("_embed", "1").build();
    return (await this.postsToMangaPage(await this.client.get(requestUrl.toString()))).mangas[0] ?? null;
  }

  private postsToMangaPage(response: Response): MangasPage {
    const currentPage = toIntOrNull(toHttpUrl(response.url).queryParameter("page")) ?? 1;
    const totalPages = toIntOrNull(response.header("X-WP-TotalPages")) ?? currentPage;

    const posts = this.parsePosts(response);
    const mangas = posts.map((it) => this.postToSManga(it)).filter((it) => it != null);

    return new MangasPage(mangas, currentPage < totalPages);
  }

  // ========================= Details =========================

  override getMangaUrl(manga: SManga): string {
    return this.frontendPostUrl(manga.url);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.postByPathRequestUrl(manga.url, manga.memo).toString());
    const post = this.parseSinglePost(response);
    if (!post) throw new Error("Missing post details from API");

    const id = post.id ?? 0;
    const title = this.titleText(post);
    if (title == null) throw new Error(`Missing title for post id=${id}`);

    const updatedManga = SManga.create();
    const path = this.linkPath(post);
    updatedManga.title = title;
    updatedManga.genre = this.genreText(post) ?? undefined;
    updatedManga.thumbnail_url = this.thumbnailUrl(post) ?? undefined;
    updatedManga.status = SManga.COMPLETED;
    updatedManga.url = urlWithoutDomain(path);
    updatedManga.memo = { post_id: id };

    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(this.linkPath(post));
    chapter.memo = { post_id: post.id ?? 0 };
    chapter.chapter_number = 1;
    chapter.name = "Gallery";
    chapter.date_upload = this.parseDate(post.date);

    return new SMangaUpdate(updatedManga, [chapter]);
  }

  // ========================= Chapters =========================

  override getChapterUrl(chapter: SChapter): string {
    return this.frontendPostUrl(chapter.url);
  }

  // ========================= Pages =========================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.postByPathRequestUrl(chapter.url, chapter.memo).toString());
    const post = this.parseSinglePost(response);
    const apiImageUrls = post ? this.extractImageUrlsFromHtml(post.content?.rendered ?? "") : [];

    return apiImageUrls.map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  private postByPathRequestUrl(path: string, memo: Record<string, unknown> | null = null): HttpUrl {
    const fullUrl = toHttpUrl(this.baseUrl + path);
    const memoId = memo?.post_id;
    const postId = toIntOrNull(fullUrl.queryParameter(POST_ID_QUERY)) ?? (typeof memoId === "number" && Number.isInteger(memoId) ? memoId : null);
    const slug = this.slugFromPath(fullUrl.encodedPath);

    const route = postId != null ? `/wp/v2/posts/${postId}` : "/wp/v2/posts";

    const builder = this.apiUrl.newBuilder().addQueryParameter("rest_route", route).addQueryParameter("_embed", "1");

    if (postId == null) {
      if (!isBlank(slug)) {
        builder.addQueryParameter("slug", slug);
      } else {
        const fallbackQuery = ifBlank(substringAfterLast(trimChar(fullUrl.encodedPath, "/"), "/"), fullUrl.encodedPath);
        if (!isBlank(fallbackQuery)) builder.addQueryParameter("search", fallbackQuery);
      }
    }

    return builder.build();
  }

  private slugFromPath(path: string): string {
    const found = SLUG_PATH_REGEX.exec(path)?.[1];
    if (found != null && !isBlank(found)) return found;

    const lastSegment = substringAfterLast(path.replace(/\/+$/, ""), "/");
    return substringBefore(lastSegment, ".html");
  }

  private parsePosts(response: Response): PostDto[] {
    const element = response.parseAs<unknown>();
    return Array.isArray(element) ? (element as PostDto[]) : [element as PostDto];
  }

  private parseSinglePost(response: Response): PostDto | null {
    return this.parsePosts(response)[0] ?? null;
  }

  private postToSManga(post: PostDto): SManga | null {
    const path = this.linkPath(post);
    if (path === "/") return null;
    const id = post.id ?? 0;
    const title = this.titleText(post);
    if (title == null) throw new Error(`Missing title for post id=${id}`);

    const manga = SManga.create();
    manga.title = title;
    manga.thumbnail_url = this.thumbnailUrl(post) ?? undefined;
    manga.genre = this.genreText(post) ?? undefined;
    manga.status = SManga.COMPLETED;
    manga.url = urlWithoutDomain(path);
    manga.memo = { post_id: id };
    manga.initialized = true;
    return manga;
  }

  private titleText(post: PostDto): string | null {
    return this.htmlToText(post.title?.rendered ?? "");
  }

  private linkPath(post: PostDto): string {
    return ifBlank(toHttpUrlOrNull(post.link ?? "")?.encodedPath ?? "", "/");
  }

  private thumbnailUrl(post: PostDto): string | null {
    const jetpack = post.jetpack_featured_media_url;
    if (jetpack != null) return this.normalizeImageUrl(jetpack, true);
    const embedded = post._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
    if (embedded != null) return this.normalizeImageUrl(embedded, true);
    return this.extractImageUrlsFromHtml(post.content?.rendered ?? "")[0] ?? null;
  }

  private genreText(post: PostDto): string | null {
    const names = [...new Set((post._embedded?.["wp:term"] ?? []).flat().map((it) => it.name ?? "").filter((it) => !isBlank(it)))];
    return ifBlank(names.join(", "), null);
  }

  private frontendPostUrl(path: string): string {
    const fullUrl = toHttpUrl(this.baseUrl + path);
    const normalizedPath = fullUrl.encodedPath;
    if (CONTENT_PATH_REGEX.test(normalizedPath)) return `${this.baseUrl}${substringBefore(normalizedPath, "?")}`;

    const postId = fullUrl.queryParameter(POST_ID_QUERY);
    if (postId != null) return toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("p", postId).build().toString();

    return `${this.baseUrl}/${normalizedPath.replace(/^\/+/, "")}`;
  }

  private deeplinkSlugFromQuery(query: string): string | null {
    if (isBlank(query)) return null;

    const url = toHttpUrlOrNull(query);
    if (!url) return null;
    if (!DEEPLINK_HOSTS.has(url.host.toLowerCase())) return null;

    const segments = url.pathSegments.filter((it) => !isBlank(it));
    if (segments.length < 3 || segments[0] !== "content") return null;

    const last = segments[segments.length - 1];
    const slugSegment = /^\d*$/.test(last) && segments.length >= 4 ? segments[segments.length - 2] : last;

    if (!slugSegment.endsWith(".html")) return null;
    return ifBlank(substringBefore(slugSegment, ".html"), null);
  }

  private extractImageUrlsFromHtml(html: string): string[] {
    if (isBlank(html)) return [];

    const document = parseHtml(this.host.load, html, this.baseUrl);
    const contentRoot = document.selectFirst(".entry-content.wp-block-post-content, .entry-content") ?? document.selectFirst("body")!;
    return this.extractImageUrlsFromElement(contentRoot);
  }

  private extractImageUrlsFromElement(root: Element): string[] {
    const imageSources = root
      .select("img[data-src], img[data-lazy-src], img[src]")
      .map((imageElement) => ["abs:data-src", "abs:data-lazy-src", "abs:src"].map((key) => imageElement.attr(key).trim()).find((it) => this.isImageUrl(it)))
      .filter((it) => it != null)
      .map((it) => this.normalizeImageUrl(it, false))
      .filter((it) => !isBlank(it));

    if (imageSources.length) return distinctBy(imageSources, (it) => this.imageCanonicalKey(it));

    const anchorSources = root
      .select("a[href]")
      .map((it) => it.attr("abs:href").trim())
      .filter((it) => this.isImageUrl(it))
      .map((it) => this.normalizeImageUrl(it, false))
      .filter((it) => !isBlank(it));

    return distinctBy(anchorSources, (it) => this.imageCanonicalKey(it));
  }

  private imageCanonicalKey(url: string): string {
    const parsed = toHttpUrlOrNull(url);
    if (!parsed) return url;
    const u = parsed.toURL();
    u.search = "";
    return u.href;
  }

  private normalizeImageUrl(url: string, forThumbnail = false): string {
    const unescaped = url.replaceAll("\\/", "/").replaceAll("&amp;", "&").trim();

    const parsed = toHttpUrlOrNull(unescaped);
    if (!parsed) return unescaped;
    const host = parsed.host.toLowerCase();

    const isJetpackProxy = host.startsWith("i") && host.endsWith(".wp.com");
    const rawPath = parsed.encodedPath.replace(/^\//, "");

    if (!isJetpackProxy || !rawPath.startsWith("pic.4khd.com/")) return unescaped;

    const targetHost = forThumbnail ? THUMBNAIL_CDN_HOST : PAGE_CDN_HOST;
    const mappedPath = rawPath.replace(/^pic\.4khd\.com\//, "");
    const queryPart = parsed.encodedQuery != null ? `?${parsed.encodedQuery}` : "";

    return `https://${targetHost}/${mappedPath}${queryPart}`;
  }

  private htmlToText(html: string): string {
    return parseHtml(this.host.load, html, "").text().trim();
  }

  private isImageUrl(url: string): boolean {
    return IMAGE_URL_REGEX.test(url);
  }

  private parseDate(dateString: string | null | undefined): number {
    if (isBlank(dateString)) return 0;
    // LocalDateTime.parse(...).atZone(systemDefault): a zone-less ISO date-time is local time in JS too
    const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(dateString) ? new Date(dateString).getTime() : Number.NaN;
    return Number.isNaN(t) ? 0 : t;
  }
}
