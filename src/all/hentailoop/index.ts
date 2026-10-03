// Port of keiyoushi/extensions-source src/all/hentailoop/HentaiLoop.kt
import {
  FilterList, HttpSource, MangasPage, Page, SManga, SChapter, firstInstance, parseHtml, toHttpUrl, tryParseInstant,
  type Document, type Element, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET, POST } from "../../../sdk/httpsource.ts";
import filtersJson from "./assets/filters.json";
import type { AdvancedSearchResponse, Data, FilterValue, QuerySearchResponse, SchemaGraph, SearchRequest, SourceFilters } from "./dto.ts";
import {
  ArtistFilter, CharacterFilter, CircleFilter, ConventionFilter, GenreFilter, LanguageFilter, MaxPageCount, MinPageCount, ParodyFilter, ReleaseFilter, SortFilter, TagFilter, UncensoredFilter,
  findActiveFilter,
} from "./filters.ts";

export default class HentaiLoop extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Referer", `${this.baseUrl}/`);
    return h;
  }

  private listUrl(sortmanga: string, page: number): string {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegment("manga");
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addPathSegment("");
    url.addQueryParameter("sortmanga", sortmanga);
    return url.build().toString();
  }

  protected popularMangaRequest(page: number): Request {
    return GET(this.listUrl("views", page), this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select("div.manga-card a").map((element) => {
      const manga = SManga.create();
      manga.url = toHttpUrl(element.absUrl("href")).pathSegments[1];
      manga.title = element.selectFirst(".title")!.ownText().trim();
      manga.thumbnail_url = this.imgAttr(element.selectFirst("img.attachment-manga_thumb")) ?? undefined;
      return manga;
    });
    const hasNextPage = document.selectFirst("nav.navigation a.next") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  protected latestUpdatesRequest(page: number): Request {
    return GET(this.listUrl("date", page), this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  override getFilterList(_data: unknown = null): FilterList {
    // this::class.java.getResourceAsStream("/assets/filters.json"), bundled here
    const sourceFilters = filtersJson as SourceFilters;

    return FilterList(
      new SortFilter(),
      new ReleaseFilter(sourceFilters.releases),
      new GenreFilter(sourceFilters.genres),
      new TagFilter(sourceFilters.tags),
      new ParodyFilter(sourceFilters.parodies),
      new ArtistFilter(sourceFilters.artists),
      new CharacterFilter(sourceFilters.characters),
      new CircleFilter(sourceFilters.circles),
      new ConventionFilter(sourceFilters.conventions),
      new LanguageFilter(sourceFilters.languages),
      new MinPageCount(),
      new MaxPageCount(),
      new UncensoredFilter(),
    );
  }

  protected override getMangasByUrl(url: URL): Promise<MangasPage> {
    return this.deepLink(url.href);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) return this.deepLink(query);

    const activeFilter = findActiveFilter(filters);

    // multiple active filters
    if (activeFilter == null) return super.fetchSearchManga(page, query, filters);

    const [directory, slug] = activeFilter;

    // query search is active
    if (query.trim() !== "") {
      // no other filter active
      if (slug == null) return this.quickSearch(query);
      // filters + query search
      return super.fetchSearchManga(page, query, filters);
    }

    // one filter (or default list) active with no query search
    return this.getMangaList(directory, slug, filters, page);
  }

  private async deepLink(url: string): Promise<MangasPage> {
    const httpUrl = toHttpUrl(url);
    if (httpUrl.host === toHttpUrl(this.baseUrl).host && httpUrl.pathSegments[0] === "manga" && httpUrl.pathSegments.length > 1) {
      const tmpManga = SManga.create();
      tmpManga.url = httpUrl.pathSegments[1];

      return new MangasPage([await this.fetchMangaDetails(tmpManga)], false);
    }

    throw new Error("Unsupported Url");
  }

  private async quickSearch(query: string): Promise<MangasPage> {
    const body = new URLSearchParams({ action: "nativeSearch", subAction: "search", query: query.trim() });
    const url = `${this.baseUrl}/wp-admin/admin-ajax.php`;
    const headers = this.headersBuilder();
    headers.set("X-Requested-With", "XMLHttpRequest");

    const response = await this.executeSuccess(POST(url, headers, body));
    const data = response.parseAs<Data<QuerySearchResponse>>();
    const mangas = data.data.posts.map((post) => {
      const manga = SManga.create();
      manga.url = toHttpUrl(post.link).pathSegments[1];
      manga.title = post.title;
      manga.thumbnail_url = post.thumb;
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  private async getMangaList(directory: string, slug: string | null, filters: FilterList, page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegment(directory);
    if (slug != null) url.addPathSegment(slug);
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addPathSegment("");
    url.addQueryParameter("sortmanga", firstInstance(filters, SortFilter).sort);

    return this.popularMangaParse(await this.executeSuccess(GET(url.build().toString(), this.headers)));
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const ids = (list: { id: number }[]) => list.map((it) => String(it.id));
    const tag = firstInstance(filters, TagFilter);
    const parody = firstInstance(filters, ParodyFilter);
    const artist = firstInstance(filters, ArtistFilter);
    const character = firstInstance(filters, CharacterFilter);
    const circle = firstInstance(filters, CircleFilter);
    const convention = firstInstance(filters, ConventionFilter);
    const language = firstInstance(filters, LanguageFilter);
    const pair = (name: string, f: { included: { id: number }[]; excluded: { id: number }[] }): FilterValue[] => [
      { name, filterValues: ids(f.included), operator: "in" },
      { name, filterValues: ids(f.excluded), operator: "ex" },
    ];

    const data: SearchRequest = {
      query: query.trim(),
      filters: [
        { name: "manga-genres", filterValues: ids(firstInstance(filters, GenreFilter).checked), operator: "in" },
        ...pair("post_tag", tag),
        ...pair("manga-parodies", parody),
        ...pair("manga-artists", artist),
        ...pair("manga-characters", character),
        ...pair("manga-circles", circle),
        { name: "manga-collections", filterValues: [], operator: "in" },
        { name: "manga-collections", filterValues: [], operator: "ex" },
        ...pair("manga-conventions", convention),
        ...pair("manga-languages", language),
      ],
      specialFilters: [
        { name: "yearFilter", yearOperator: "in", yearValue: firstInstance(filters, ReleaseFilter).release?.slug ?? "" },
        { name: "pagesFilter", values: { min: firstInstance(filters, MinPageCount).count, max: firstInstance(filters, MaxPageCount).count } },
        { name: "checkboxFilter", values: { purpose: "uncensored-filter", checked: firstInstance(filters, UncensoredFilter).state } },
        { name: "checkboxFilter", values: { purpose: "unread-filter", checked: false } },
      ],
      sorting: firstInstance(filters, SortFilter).sort,
    };

    const body = new URLSearchParams({ action: "advanced_search", subAction: "search_query", request: JSON.stringify(data), offset: String((page - 1) * 10) });

    const headers = this.headersBuilder();
    headers.set("X-Requested-With", "XMLHttpRequest");

    return POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, headers, body);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const data = response.parseAs<Data<AdvancedSearchResponse>>();

    if (!data.success && data.data.message?.toLowerCase().includes("captcha")) {
      throw new Error("Captcha Required! Open advanced search in WebView and solve the captcha");
    }

    const mangas = (data.data.posts ?? []).map((it) => {
      const element = parseHtml(this.host.load, it, this.baseUrl);

      const manga = SManga.create();
      manga.url = toHttpUrl(element.selectFirst("a[href*=/manga/]")!.absUrl("href")).pathSegments[1];
      manga.title = element.selectFirst(".title")!.ownText().trim();
      manga.thumbnail_url = this.imgAttr(element.selectFirst(".thumb img")) ?? undefined;
      return manga;
    });

    return new MangasPage(mangas, data.data.more ?? false);
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(this.getMangaUrl(manga), this.headers);
  }

  override getMangaUrl(manga: SManga): string {
    return toHttpUrl(this.baseUrl).newBuilder().addPathSegment("manga").addPathSegment(manga.url).addPathSegment("").build().toString();
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();

    manga.url = toHttpUrl(response.url).pathSegments[1];
    manga.title = document.selectFirst(".manga-title")!.text();
    manga.author = document.select(".manga-term-content a[href*=/artists/]").eachText().join(", ");
    manga.artist = manga.author;
    manga.status = SManga.COMPLETED;
    manga.thumbnail_url = this.imgAttr(document.selectFirst(".manga-thumb img")) ?? undefined;

    let description = "";
    const subtitle = document.selectFirst(".manga-subtitle")?.text();
    if (subtitle != null) description += `Alternative Name: ${subtitle}\n`;
    const counter = document.selectFirst(".pre-meta .counter")?.text();
    if (counter != null) description += `${counter}\n`;
    const views = document.selectFirst(".pre-meta .manga-views")?.text();
    if (views != null) description += `${views}\n`;
    const updated = document.selectFirst(".pre-meta .manga-updated")?.text();
    if (updated != null) description += `${updated}\n`;
    const likes = document.selectFirst(".rating-buttons span#likes")?.text();
    if (likes != null) description += `Dislikes: ${likes}\n`;
    const dislikes = document.selectFirst(".rating-buttons span#dislikes")?.text();
    if (dislikes != null) description += `Likes: ${dislikes}\n`;
    for (const div of document.select(".manga-term-content:not(:has(> a[href*=/tag]))")) {
      const prev = div.previousElementSibling();
      const name = prev?.hasClass("manga-term-name") ? prev : null;
      if (!name) continue;
      const content = div.selectFirst("a")?.text();
      if (content == null) continue;
      description += `${name.text()}: ${content}\n`;
    }
    manga.description = description;
    manga.genre = [
      ...document.select(".manga-term-content a[href*=/genres/]").map((it) => it.text()),
      ...document.select(".manga-term-content a[href*=/languages/]").map((it) => it.text()),
      ...document.select(".manga-term-content a[href*=/tag/]").map((it) => it.text()),
    ].join(", ");
    return manga;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  protected override relatedMangaListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }

  protected override async relatedMangaListParse(response: Response): Promise<SManga[]> {
    const document = response.asJsoup();

    return document.select(".related-entry a").map((element) => {
      const manga = SManga.create();
      manga.url = toHttpUrl(element.absUrl("href")).pathSegments[1];
      manga.title = element.selectFirst(".related-title")!.ownText().trim();
      manga.thumbnail_url = this.imgAttr(element.selectFirst("img")) ?? undefined;
      return manga;
    });
  }

  protected override chapterListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const json = document.selectFirst('.yoast-schema-graph[type="application/ld+json"]')?.data();
    const date = json ? JSON.parse(json) as SchemaGraph : null;
    const datePublished = date?.["@graph"]?.find((it) => it.datePublished != null)?.datePublished;
    const chapter = SChapter.create();
    chapter.url = toHttpUrl(response.url).pathSegments[1];
    chapter.name = "Chapter";
    // SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ").tryParse(date with the offset colon removed) == the ISO instant
    chapter.date_upload = tryParseInstant(datePublished);
    return [chapter];
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(this.getChapterUrl(chapter), this.headers);
  }

  override getChapterUrl(chapter: SChapter): string {
    return toHttpUrl(this.baseUrl).newBuilder().addPathSegment("manga").addPathSegment(chapter.url).addPathSegment("read").addPathSegment("").build().toString();
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();

    this.countViews(document);

    return document.select(".gallery-item > dt > img").map((img, index) => new Page(index, "", this.imgAttr(img) ?? undefined));
  }

  private countViews(document: Document) {
    const postId = document
      .selectFirst("body[class*=postid-]")
      ?.className()
      .split(/\s+/)
      .find((it) => it.startsWith("postid-"))
      ?.replace(/^.*?postid-/, "");
    if (!postId) return;

    const body = new URLSearchParams({ action: "addview", postID: postId });

    const headers = this.headersBuilder();
    headers.set("X-Requested-With", "XMLHttpRequest");

    this.client.enqueue(POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, headers, body));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  private imgAttr(el: Element | null): string | null {
    if (el == null) return null;
    if (el.hasAttr("data-src") && el.attr("data-src").trim() !== "") return el.absUrl("data-src");
    if (el.hasAttr("src") && el.attr("src").trim() !== "") return el.absUrl("src");
    return null;
  }
}
