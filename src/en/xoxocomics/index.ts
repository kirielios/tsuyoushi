// Port of keiyoushi/extensions-source src/en/xoxocomics/XoxoComics.kt
import { DateTimeFormatter, Filter, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, urlWithoutDomain, type ClientBuilder, type Element, type FilterList, type Response } from "../../../sdk/index.ts";
import { GenreFilter, StatusFilter, WPComics, type Pair, type UriPartFilter } from "../../../themes/wpcomics/index.ts";

export default class XoxoComics extends WPComics {
  protected override dateFormat = DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.US);

  protected override gmtOffset = null;

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      if (!request.url.endsWith("#imagereq")) return chain.proceed(request);

      const response = await chain.proceed(request);
      // 404 is returned even when the image is found
      return response.code === 404 ? response.withCode(200) : response;
    });
  }

  protected override searchPath = "search-comic";
  override popularPath = "hot-comic";

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = `${this.baseUrl}/comic-update?page=${page}`;
    return this.parseMangaPage(await this.client.get(url), this.latestUpdatesSelector(), (it) => this.latestUpdatesFromElement(it));
  }

  protected override latestUpdatesSelector() {
    return "li.row";
  }

  protected override latestUpdatesFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.select("h3 a");
    manga.title = it.text();
    manga.url = urlWithoutDomain(it.attr("href"));
    manga.thumbnail_url = element.select("img").attr("data-original");
    return manga;
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: string;
    if (query || !filters.length) {
      // Search won't work together with filter
      url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment(this.searchPath).addQueryParameter("keyword", query).addQueryParameter("page", String(page)).build().toString();
    } else {
      const builder = toHttpUrl(this.baseUrl).newBuilder();

      let genreFilter: UriPartFilter | null = null;
      let statusFilter: UriPartFilter | null = null;
      for (const filter of filters) {
        if (filter instanceof GenreFilter) genreFilter = filter;
        else if (filter instanceof StatusFilter) statusFilter = filter;
      }

      // Genre filter must come before status filter
      const genre = genreFilter?.toUriPart();
      if (genre != null) builder.addPathSegment(genre);
      const status = statusFilter?.toUriPart();
      if (status != null) builder.addQueryParameter("status", status);

      builder.addQueryParameter("page", String(page));
      builder.addQueryParameter("sort", "0");
      url = builder.build().toString();
    }

    return this.parseMangaPage(await this.client.get(url), this.searchMangaSelector(), (it) => this.searchMangaFromElement(it));
  }

  protected override async mangaUpdateParse(response: Response, _manga: SManga, _chapters: SChapter[]): Promise<SMangaUpdate> {
    const document = response.asJsoup();
    const updatedManga = this.mangaDetailsParse(document);

    const chapterList: SChapter[] = [];
    let doc = document;
    for (;;) {
      doc.select(this.chapterListSelector()).forEach((it) => chapterList.push(this.chapterFromElement(it)));
      const nextUrl = doc.select("ul.pagination a[rel=next]").first()?.absUrl("href");
      if (nextUrl == null) break;
      doc = (await this.client.get(nextUrl)).asJsoup();
    }

    return new SMangaUpdate(updatedManga, chapterList);
  }

  protected override chapterFromElement(element: Element): SChapter {
    const chapter = super.chapterFromElement(element);
    chapter.date_upload = this.toDate(element.select("div.col-xs-3").text());
    return chapter;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.parsePageList(await this.client.get(this.baseUrl + `${chapter.url}/all`));
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.parseGenres((await this.client.get(`${this.baseUrl}/comic-list`)).asJsoup());
  }

  protected override genresSelector = ".genres h2:contains(Genres) + ul.nav li a";

  protected override getFilterListOf(genres: Pair[]): FilterList {
    return [new Filter.Header("Search query won't use Genre/Status filter"), ...super.getFilterListOf(genres)];
  }

  override imageRequest(page: Page) {
    const req = super.imageRequest(page);
    return { ...req, url: page.imageUrl! + "#imagereq" };
  }
}
