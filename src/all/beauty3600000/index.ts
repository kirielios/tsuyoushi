// Port of keiyoushi/extensions-source src/all/beauty3600000/Beauty3600000.kt (with Dto.kt)
import {
  ClientBuilder,
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
  HttpClient,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  ZoneOffset,
  firstInstance,
  isBlank,
  parseHtml,
  toHttpUrl,
  toHttpUrlOrNull,
  type Document,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { CategoryFilter, TagFilter } from "./filters.ts";

// --- Dto.kt
interface RenderedDto {
  rendered: string;
}
interface PostDto {
  id: number;
  link: string;
  title: RenderedDto;
  content: RenderedDto;
  date: string;
}
interface TermDto {
  id: number;
  name: string;
  slug: string;
}

const API_BASE = "wp-json/wp/v2";
const PER_PAGE = 100;
const jsonArrayRegex = /\[.*]\s*$/;
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.US);

/** Kotlin's String.toIntOrNull() */
const toIntOrNull = (s: string): number | null => (/^[+-]?\d+$/.test(s) && Math.abs(Number(s)) <= 2147483648 && Number(s) <= 2147483647 ? Number.parseInt(s, 10) : null);
const removeSurrounding = (s: string, d: string) => (s.length >= 2 * d.length && s.startsWith(d) && s.endsWith(d) ? s.slice(d.length, s.length - d.length) : s);
const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s);

export default class Beauty3600000 extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  private clientBuilder!: ClientBuilder;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    this.clientBuilder = builder;
    return builder.connectTimeout(120_000).readTimeout(120_000).rateLimit(1);
  }

  private _searchingClient?: HttpClient;
  private get searchingClient(): HttpClient {
    if (!this._searchingClient) {
      this.client; // builds clientBuilder
      // client.newBuilder().rateLimit(1, 30.seconds): shares the client's limiter, adds the slower one
      const b = new ClientBuilder();
      b.limiters.push(...this.clientBuilder.limiters);
      b.rateLimit(1, 30_000);
      this._searchingClient = new HttpClient(this.host, () => this.headers, b);
    }
    return this._searchingClient;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    return h;
  }

  private parseBodyFragment(html: string): Document {
    return parseHtml(this.host.load, html, "");
  }

  // ========================= Popular =========================

  protected popularMangaRequest(page: number): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment("posts").addQueryParameter("page", String(page)).addQueryParameter("per_page", String(PER_PAGE)).build();
    return GET(url, this.headers);
  }

  protected popularMangaParse(response: Response): Promise<MangasPage> {
    return this.parseMangasPage(response);
  }

  // ========================= Latest =========================

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Search =========================

  // upstream handles URLs in searchMangaRequest, so bypass KeiSource's URL handling
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const request = await this.searchMangaRequest(page, query, filters);
    const searchParams = new URL(request.url).searchParams.get("search");
    // client.newCall(request).execute(): no success check
    const response = await (searchParams != null ? this.searchingClient : this.client).execute(request);
    return this.searchMangaParse(response);
  }

  protected async searchMangaRequest(page: number, query: string, filters: FilterList): Promise<Request> {
    const queryUrl = toHttpUrlOrNull(query);
    if (queryUrl != null && queryUrl.host === toHttpUrlOrNull(this.baseUrl)?.host) {
      const id = queryUrl.queryParameter("p")?.trim() ?? null;
      const slug = id == null ? removeSuffix([...queryUrl.pathSegments].reverse().find((it) => !isBlank(it)) ?? "", ".html") || null : null;
      const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment("posts");
      if (id != null) {
        const n = toIntOrNull(id);
        // Allow copy old entry's `manga.url` to search for old entry for migration which is in format "https://3600000.xyz/?p=/{slug}/"
        if (n != null) url.addQueryParameter("include", String(n));
        else url.addQueryParameter("slug", removeSurrounding(id, "/"));
      } else if (slug != null) {
        url.addQueryParameter("slug", slug);
      }
      return GET(url.build(), this.headers);
    }

    const filterList = filters.length ? filters : this.getFilterList();
    const categoryFilter = firstInstance(filterList, CategoryFilter);
    const tagFilter = firstInstance(filterList, TagFilter);
    let tagSearch: number | null = null;

    if (categoryFilter.state <= 0 && tagFilter.state <= 0) {
      if (isBlank(query)) return this.popularMangaRequest(page);

      const tags = await this.getTag(query.trim()).catch(() => null);
      tagSearch = tags?.find((it) => it.name.toLowerCase() === query.trim().toLowerCase())?.id ?? null;
    }

    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment("posts");
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("per_page", String(PER_PAGE));

    if (!isBlank(query) && tagSearch == null) url.addQueryParameter("search", query.trim());

    if (categoryFilter.state > 0) url.addQueryParameter("categories", categoryFilter.toUriPart());
    else if (tagFilter.state > 0) url.addQueryParameter("tags", tagFilter.toUriPart());
    else if (tagSearch != null) url.addQueryParameter("tags", String(tagSearch));

    return GET(url.build(), this.headers);
  }

  protected searchMangaParse(response: Response): Promise<MangasPage> {
    return this.popularMangaParse(response);
  }

  // ========================= Filters =========================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Only one filter will be applied!"), new Filter.Separator(), new CategoryFilter(), new TagFilter());
  }

  // ========================= Details =========================

  override mangaDetailsRequest(manga: SManga): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegments(API_BASE);
    url.addPathSegment("posts");
    if (toIntOrNull(manga.url) != null) url.addPathSegment(manga.url);
    else url.addQueryParameter("slug", removeSurrounding(manga.url, "/"));
    return GET(url.build(), this.headers);
  }

  protected async mangaDetailsParse(response: Response): Promise<SManga> {
    const post = this.toPost(response);
    const manga = this.postToSManga(post);
    const terms = (await Promise.all(["categories", "tags"].map((term) => this.parallelCatching(() => this.getTerms(post.id, term))))).flat();
    manga.genre = terms.length ? terms.map((it) => it.name).join(", ") : undefined;
    return manga;
  }

  private async getTerms(mangaId: number, term: string): Promise<TermDto[]> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment(term).addQueryParameter("post", String(mangaId)).build();
    return (await this.client.get(url.toString(), this.headers)).parseAs<TermDto[]>();
  }

  private async getTag(slug: string): Promise<TermDto[]> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment("tags").addQueryParameter("slug", slug).build();
    return (await this.client.get(url.toString(), this.headers)).parseAs<TermDto[]>();
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    let mangaId = toIntOrNull(manga.url);
    if (mangaId == null) {
      const details = await this.mangaDetailsParse(await this.executeSuccess(this.mangaDetailsRequest(manga)));
      mangaId = toIntOrNull(details.url);
      if (mangaId == null) return [];
    }
    const tags = (await this.getTerms(mangaId, "tags")).sort((a, b) => Number(a.name.startsWith("[")) - Number(b.name.startsWith("[")));

    return (
      await Promise.all(
        tags.map((tag) =>
          this.parallelCatching(async () => {
            const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment("posts");
            url.addQueryParameter("page", "1");
            url.addQueryParameter("per_page", String(PER_PAGE));
            url.addQueryParameter("tags", String(tag.id));
            return (await this.searchMangaParse(await this.executeSuccess(GET(url.build(), this.headers)))).mangas;
          }),
        ),
      )
    ).flat();
  }

  override getMangaUrl(manga: SManga): string {
    return toIntOrNull(manga.url) != null ? `${this.baseUrl}/?p=${manga.url}` : `${this.baseUrl}${manga.url}`;
  }

  private toPost(response: Response): PostDto {
    const slugParam = new URL(response.url).searchParams.get("slug");
    if (slugParam != null) {
      const body = response.text();
      const value = jsonArrayRegex.exec(body)?.[0];
      const post = value != null ? (JSON.parse(value) as PostDto[])[0] : undefined;
      if (post == null) throw new Error("Post not found");
      return post;
    }
    return response.parseAs<PostDto>();
  }

  private postToSManga(post: PostDto): SManga {
    const manga = SManga.create();
    manga.url = String(post.id);
    const title = this.decodeHtmlEntities(post.title.rendered);
    if (isBlank(title)) throw new Error("Title is mandatory");
    manga.title = title;
    manga.thumbnail_url = this.parseBodyFragment(post.content.rendered).selectFirst("img")?.attr("src");
    manga.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: no such field in our SManga
    return manga;
  }

  /** Parser.unescapeEntities(this, false) */
  private decodeHtmlEntities(s: string): string {
    return this.parseBodyFragment(s).wholeText();
  }

  // ========================= Chapters =========================

  protected override chapterListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const post = this.toPost(response);
    const chapter = SChapter.create();
    chapter.url = String(post.id);
    chapter.name = "Gallery";
    chapter.date_upload = DATE_FORMAT.tryParseDateTime(post.date, ZoneOffset.UTC);
    return [chapter];
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/?p=${chapter.url}`;
  }

  // ========================= Pages =========================

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(toHttpUrl(this.baseUrl).newBuilder().addPathSegments(API_BASE).addPathSegment("posts").addPathSegment(chapter.url).build(), this.headers);
  }

  protected pageListParse(response: Response): Page[] {
    const post = response.parseAs<PostDto>();
    const document = this.parseBodyFragment(post.content.rendered);
    return document.select("img").map((it, i) => new Page(i, "", it.attr("src")));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Helpers =========================

  private async parseMangasPage(response: Response): Promise<MangasPage> {
    const body = response.text();
    const value = jsonArrayRegex.exec(body)?.[0];
    if (value == null) return new MangasPage([], false);
    const posts = JSON.parse(value) as PostDto[];
    const mangas = posts.map((it) => this.postToSManga(it));
    const totalPages = toIntOrNull(response.header("X-WP-TotalPages") ?? "") ?? 0;
    const currentPage = toIntOrNull(new URL(response.url).searchParams.get("page") ?? "") ?? 1;
    return new MangasPage(mangas, currentPage < totalPages);
  }

  /** One leg of parallelCatchingFlatMap: a failure logs and yields an empty list. */
  private async parallelCatching<B>(f: () => Promise<B[]>): Promise<B[]> {
    try {
      return await f();
    } catch (e) {
      console.error(e);
      return [];
    }
  }
}
