// Port of keiyoushi/extensions-source lib-multisrc/natsuid/NatsuId.kt
// https://themesinfo.com/natsu_id-theme-wordpress-c8x1c Wordpress Theme Author "Dzul Qurnain"
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SMangaUpdate,
  str,
  substringAfter,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  urlWithoutDomain,
  parseHtml,
  type DateTimeFormatter,
  type Document,
  type Filter,
  type HttpUrl,
  type Response,
  type SManga,
} from "../../sdk/index.ts";
import { mangaIsNovel, mangaToSManga, type HtmlTools, type Manga, type MangaUrl, type Term } from "./dto.ts";
import { GenreExclusion, GenreFilter, GenreInclusion, ProjectFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

/** OkHttp's MultipartBody (FORM) for string parts. */
function multipartBody(parts: [string, string][]): { contentType: string; body: string } {
  const boundary = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  let body = "";
  for (const [name, value] of parts) body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  body += `--${boundary}--\r\n`;
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}

const descriptionIdRegex = /ID: (\d+)/;

export abstract class NatsuId extends KeiSource {
  protected dateFormat: DateTimeFormatter | null = null;

  protected readonly html: HtmlTools = {
    // Parser.unescapeEntities: textarea content is RCDATA, so only entities are decoded
    unescapeEntities: (s) => parseHtml(this.host.load, `<textarea>${s.replaceAll("</textarea", "&lt;/textarea")}</textarea>`, this.baseUrl).selectFirst("textarea")!.wholeText(),
    parseBodyFragment: (html) => this.parseBodyFragment(html),
  };

  /** Jsoup.parseBodyFragment(html, baseUrl) */
  protected parseBodyFragment(html: string): Document {
    return parseHtml(this.host.load, html, this.baseUrl);
  }

  // Popular + Latest
  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.popular);
  }

  override getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.latest);
  }

  // Search
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    const slug = toHttpUrl(url.href).pathSegments[1];
    if (slug == null) return null;

    const apiUrl = toHttpUrl(`${this.baseUrl}/wp-json/wp/v2/manga`).newBuilder().addQueryParameter("slug[]", slug).addQueryParameter("_embed", null).build();

    const response = await this.client.get(this.embedUrl(apiUrl));
    const manga = this.parseJson<Manga[]>(response)[0];

    if (mangaIsNovel(manga)) throw new Error("Novels are not supported");

    return mangaToSManga(manga, this.html);
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = `${this.baseUrl}/wp-admin/admin-ajax.php?action=advanced_search`;
    const find = <T extends Filter>(cls: abstract new (...args: never[]) => T) => filters.find((it): it is T => it instanceof cls);
    const parts: [string, string][] = [];
    parts.push(["nonce", await this.getNonce()]);
    parts.push(["inclusion", find(GenreInclusion)?.selected ?? "OR"]);
    parts.push(["exclusion", find(GenreExclusion)?.selected ?? "OR"]);
    parts.push(["page", String(page)]);
    const genres = find(GenreFilter);
    parts.push(["genre", JSON.stringify(genres?.included ?? [])]);
    parts.push(["genre_exclude", JSON.stringify(genres?.excluded ?? [])]);
    parts.push(["author", "[]"]);
    parts.push(["artist", "[]"]);
    const isProject = find(ProjectFilter);
    parts.push(["project", isProject?.state === true ? "1" : "0"]);
    parts.push(["type", JSON.stringify(find(TypeFilter)?.checked ?? [])]);
    parts.push(["status", JSON.stringify(find(StatusFilter)?.checked ?? [])]);
    const sort = find(SortFilter);
    if (!sort) throw new Error("No SortFilter in filter list"); // firstInstance<SortFilter>()
    parts.push(["order", sort.isAscending ? "asc" : "desc"]);
    parts.push(["orderby", sort.sort]);
    parts.push(["query", query.trim()]);

    const { contentType, body } = multipartBody(parts);
    const headers = this.headers;
    headers.set("Content-Type", contentType);
    return this.parseSearchManga(await this.client.post(url, headers, body));
  }

  protected async parseSearchManga(response: Response): Promise<MangasPage> {
    const document = this.parseBodyFragment(response.text());
    const slugs = document.select("div > a[href*=/manga/]:has(> img)").map((it) => toHttpUrl(it.absUrl("href")).pathSegments[1]);
    if (!slugs.length) return new MangasPage([], false);

    const b = toHttpUrl(`${this.baseUrl}/wp-json/wp/v2/manga`).newBuilder();
    slugs.forEach((slug) => b.addQueryParameter("slug[]", slug));
    b.addQueryParameter("per_page", `${slugs.length + 1}`);
    b.addQueryParameter("_embed", null);
    const url = b.build();

    const details = new Map(
      this.parseJson<Manga[]>(await this.client.get(this.embedUrl(url)))
        .filter((it) => !mangaIsNovel(it))
        .map((it) => [it.slug, it]),
    );

    const mangas = slugs.flatMap((slug) => {
      const m = details.get(slug);
      return m ? [mangaToSManga(m, this.html)] : [];
    });

    const hasNextPage = document.selectFirst("button:has(svg)") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  private nonce: string | null = null;
  private noncePromise: Promise<string> | null = null;

  /** Guarded by a Mutex upstream: concurrent callers share one request. */
  private getNonce(): Promise<string> {
    if (this.nonce) return Promise.resolve(this.nonce);
    return (this.noncePromise ??= (async () => {
      try {
        const response = await this.client.get(`${this.baseUrl}/wp-admin/admin-ajax.php?type=search_form&action=get_nonce`);
        const value = this.parseBodyFragment(response.text()).selectFirst("input[name=search_nonce]")?.attr("value");
        if (!value || !value.trim()) throw new Error("Unable to get nonce");
        this.nonce = value;
        return value;
      } finally {
        this.noncePromise = null;
      }
    })());
  }

  // Details + Chapters
  // supportRelatedMangasBySearch = true upstream: Komikku-only, the reader has no related-by-search.

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/manga/${this.slugOf(manga)}/`;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let mangaId = this.idOf(manga);
    if (mangaId == null) {
      // Network fallback
      const hxGet = (await this.client.get(this.getMangaUrl(manga))).asJsoup().selectFirst("#gallery-list")!.attr("hx-get");
      mangaId = substringBefore(substringAfter(hxGet, "manga_id="), "&");
    }
    const id = mangaId;

    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(id) : Promise.resolve(manga), fetchChapters ? this.getChapterList(id) : Promise.resolve(chapters)]);
    return new SMangaUpdate(m, c);
  }

  protected async getMangaDetails(mangaId: string): Promise<SManga> {
    const response = await this.client.get(`${this.baseUrl}/wp-json/wp/v2/manga/${mangaId}?_embed`);
    const manga = this.parseJson<Manga>(response);
    return mangaToSManga(manga, this.html);
  }

  protected chapterListUrl(mangaId: string): HttpUrl {
    return toHttpUrl(`${this.baseUrl}/wp-admin/admin-ajax.php`)
      .newBuilder()
      .addQueryParameter("manga_id", mangaId)
      .addQueryParameter("page", `${99 + Math.floor(Math.random() * (9999 - 99))}`) // keep above 3 for loading hidden chapter
      .addQueryParameter("action", "chapter_list")
      .build();
  }

  protected chapterListSelector = "div a:has(time)";
  protected chapterNameSelector = "span";
  protected chapterDateSelector = "time";
  protected chapterDateAttribute = "datetime";

  protected async getChapterList(mangaId: string): Promise<SChapter[]> {
    const response = await this.client.get(this.chapterListUrl(mangaId).toString());
    const document = this.parseBodyFragment(response.text());

    return document.select(this.chapterListSelector).map((it) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(it.absUrl("href"));
      chapter.name = it.selectFirst(this.chapterNameSelector)!.ownText();
      const date = it.selectFirst(this.chapterDateSelector)?.attr(this.chapterDateAttribute);
      chapter.date_upload = date != null ? this.parseDate(date) : 0;
      return chapter;
    });
  }

  // Pages
  protected pageListSelector = "main .relative section > img";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(this.pageListSelector).map((img, idx) => new Page(idx, "", img.absUrl("src")));
  }

  // Filters
  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const url = `${this.baseUrl}/wp-json/wp/v2/genre?per_page=100&page=1&orderby=count&order=desc`;
    return this.parseJson<Term[]>(await this.client.get(url));
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new SortFilter(), new TypeFilter(), new StatusFilter(), new ProjectFilter()];

    if (Array.isArray(data)) {
      filters.push(
        new GenreFilter(
          (data as Term[]).map((it): [string, string] => [it.name, it.slug]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
        ),
        new GenreInclusion(),
        new GenreExclusion(),
      );
    }

    return FilterList(...filters);
  }

  // utils
  private parseDate(s: string): number {
    return this.dateFormat ? this.dateFormat.tryParseDateTime(s) : tryParseInstant(s);
  }

  protected transformJsonResponse(responseBody: string): string {
    return responseBody;
  }

  /** response.parseAs<T>(transform = ::transformJsonResponse) */
  protected parseJson<T>(response: Response): T {
    return JSON.parse(this.transformJsonResponse(response.text())) as T;
  }

  /** OkHttp writes addQueryParameter("_embed", null) as a bare "_embed"; URLSearchParams would write "_embed=". */
  private embedUrl(url: HttpUrl): string {
    return url.toString().replace(/([?&]_embed)=(?=&|$)/, "$1");
  }

  /** Kotlin's SManga.slug() extension. */
  private slugOf(manga: SManga): string {
    return manga.url.startsWith("{") ? (JSON.parse(manga.url) as MangaUrl).slug : toHttpUrl(`${this.baseUrl}${manga.url}`).pathSegments[1];
  }

  /** Kotlin's SManga.id() extension. */
  private idOf(manga: SManga): string | null {
    const memoId = str(manga.memo?.["id"]);
    if (memoId != null) return memoId;
    if (manga.url.startsWith("{")) return String((JSON.parse(manga.url) as MangaUrl).id);
    return (manga.description?.trim() && descriptionIdRegex.exec(manga.description.trim())?.[1]) || null;
  }
}
