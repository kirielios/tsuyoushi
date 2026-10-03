// Port of keiyoushi/extensions-source lib-multisrc/liliana/Liliana.kt (+ Filters.kt, Dto.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isNotBlank,
  parseHtml,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type HttpUrlBuilder,
} from "../../sdk/index.ts";

// ============================== Dto ==============================

interface SearchResponseDto {
  list: { cover: string; name: string; url: string }[];
}

interface PageListResponseDto {
  status?: boolean;
  msg?: string | null;
  html: string;
}

// ============================== Filters ==============================

type Pair = [string, string];

export class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: Pair[],
    private readonly urlParameter: string,
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  addUrlParameter(url: HttpUrlBuilder) {
    url.addQueryParameter(this.urlParameter, this.options[this.state][1]);
  }
}

export class TriStateFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class TriStateGroupFilter extends Filter.Group<TriStateFilter> {
  constructor(
    name: string,
    options: Pair[],
    private readonly includeUrlParameter: string,
    private readonly excludeUrlParameter: string,
  ) {
    super(
      name,
      options.map((it) => new TriStateFilter(it[0], it[1])),
    );
  }
  addUrlParameter(url: HttpUrlBuilder) {
    url.addQueryParameter(
      this.includeUrlParameter,
      this.state
        .filter((it) => it.isIncluded())
        .map((it) => it.id)
        .join(","),
    );
    url.addQueryParameter(
      this.excludeUrlParameter,
      this.state
        .filter((it) => it.isExcluded())
        .map((it) => it.id)
        .join(","),
    );
  }
}

export class GenreFilter extends TriStateGroupFilter {
  constructor(name: string, options: Pair[]) {
    super(name, options, "genres", "notGenres");
  }
}
export class ChapterCountFilter extends SelectFilter {
  constructor(name: string, options: Pair[]) {
    super(name, options, "chapter_count");
  }
}
export class StatusFilter extends SelectFilter {
  constructor(name: string, options: Pair[]) {
    super(name, options, "status");
  }
}
export class GenderFilter extends SelectFilter {
  constructor(name: string, options: Pair[]) {
    super(name, options, "sex");
  }
}
export class SortFilter extends SelectFilter {
  constructor(name: string, options: Pair[]) {
    super(name, options, "sort");
  }
}

export interface FilterData {
  genreName: string;
  genres: Pair[];
  chapterCountName: string;
  chapterCounts: Pair[];
  statusName: string;
  statuses: Pair[];
  genderName: string;
  genders: Pair[];
  sortName: string;
  sorts: Pair[];
}

// ============================== Source ==============================

export abstract class Liliana extends KeiSource {
  protected usesPostSearch = false;

  // ============================== Popular ===============================

  override async getPopularManga(page: number): Promise<MangasPage> {
    return this.popularMangaParse((await this.client.get(`${this.baseUrl}/ranking/week/${page}`)).asJsoup());
  }

  protected popularMangaParse(document: Document): MangasPage {
    const elements = document.select(this.popularMangaSelector());
    const mangas = elements.map((it) => this.popularMangaFromElement(it));
    const selector = this.popularMangaNextPageSelector();
    const hasNextPage = selector != null ? document.selectFirst(selector) != null : false;
    return new MangasPage(mangas, hasNextPage);
  }

  protected popularMangaSelector(): string {
    return "div#main div.grid > div";
  }

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const img = element.selectFirst("img");
    manga.thumbnail_url = img ? this.imgAttr(img) : undefined;
    const a = element.selectFirst(".text-center a")!;
    manga.title = a.text();
    manga.url = urlWithoutDomain(a.attr("abs:href"));
    return manga;
  }

  protected popularMangaNextPageSelector(): string | null {
    return ".blog-pager > span.pagecurrent + span";
  }

  // =============================== Latest ===============================

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.popularMangaParse((await this.client.get(`${this.baseUrl}/all-manga/${page}/?sort=last_update&status=0`)).asJsoup());
  }

  // =============================== Search ===============================

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (isNotBlank(query) && this.usesPostSearch) {
      return this.postSearch(query);
    }

    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (isNotBlank(query)) {
      url.addPathSegment("search");
      url.addQueryParameter("keyword", query);
    } else {
      url.addPathSegment("filter");
      for (const it of filters) {
        if (it instanceof SelectFilter || it instanceof TriStateGroupFilter) it.addUrlParameter(url);
      }
    }
    url.addPathSegment(String(page));
    url.addPathSegment("");

    return this.popularMangaParse((await this.client.get(url.build().toString())).asJsoup());
  }

  private async postSearch(query: string): Promise<MangasPage> {
    const formBody = new URLSearchParams({ search: query });

    const formHeaders = this.headersBuilder();
    formHeaders.append("Accept", "application/json, text/javascript, */*; q=0.01");
    // Host header omitted: fetch sets it and forbids overriding it
    formHeaders.append("X-Requested-With", "XMLHttpRequest");

    const mangaList = (await this.client.post(`${this.baseUrl}/ajax/search`, formHeaders, formBody)).parseAs<SearchResponseDto>().list.map((manga) => {
      const m = SManga.create();
      m.url = urlWithoutDomain(manga.url);
      m.title = manga.name;
      m.thumbnail_url = this.baseUrl + manga.cover;
      return m;
    });

    return new MangasPage(mangaList, false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || segments[0] !== "manga" || segments.length < 2) return null;

    const mangaUrl = `/manga/${segments[1]}`;
    const manga = this.mangaDetailsParse((await this.client.get(this.baseUrl + mangaUrl)).asJsoup());
    manga.url = mangaUrl;
    return manga;
  }

  // =============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.parseFilters((await this.client.get(`${this.baseUrl}/filter`)).asJsoup());
  }

  protected parseFilters(document: Document): FilterData {
    const getSelectName = (selectorClass: string) => document.selectFirst(`.select-div > label.${selectorClass}`)?.text() ?? "";
    const getSelectData = (selectorId: string): Pair[] => document.select(`#${selectorId} > option`).map((it) => [it.text(), it.attr("value")]);
    return {
      genreName: document.selectFirst("div.advanced-genres > h3")?.text() ?? "",
      genres: document.select("div.advanced-genres > div > .advance-item").map((it) => [it.text(), it.selectFirst("span")!.attr("data-genre")]),
      chapterCountName: getSelectName("select-count"),
      chapterCounts: getSelectData("select-count"),
      statusName: getSelectName("select-status"),
      statuses: getSelectData("select-status"),
      genderName: getSelectName("select-gender"),
      genders: getSelectData("select-gender"),
      sortName: getSelectName("select-sort"),
      sorts: getSelectData("select-sort"),
    };
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as FilterData | null;
    if (!filterData) return FilterList();
    const filters: Filter[] = [new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator()];

    if (filterData.genres.length) filters.push(new GenreFilter(filterData.genreName, filterData.genres));
    if (filterData.chapterCounts.length) filters.push(new ChapterCountFilter(filterData.chapterCountName, filterData.chapterCounts));
    if (filterData.statuses.length) filters.push(new StatusFilter(filterData.statusName, filterData.statuses));
    if (filterData.genders.length) filters.push(new GenderFilter(filterData.genderName, filterData.genders));
    if (filterData.sorts.length) filters.push(new SortFilter(filterData.sortName, filterData.sorts));

    return filters;
  }

  // =========================== Manga Details ============================

  // details and chapters come from the same page
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(
      this.mangaDetailsParse(document),
      document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it)),
    );
  }

  protected mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.description = document.selectFirst("div#syn-target")?.text();
    const img = document.selectFirst(".a1 > figure img");
    manga.thumbnail_url = img ? this.imgAttr(img) : undefined;
    manga.title = document.selectFirst(".a2 header h1")!.text();
    manga.genre = document
      .select(".a2 div > a[rel='tag'].label")
      .map((it) => it.text())
      .join(", ");
    const author = document.selectFirst("div.y6x11p i.fas.fa-user + span.dt")?.text();
    manga.author = author?.toLowerCase() === "updating" ? undefined : author;
    manga.status = this.parseStatus(document.selectFirst("div.y6x11p i.fas.fa-rss + span.dt"));
    return manga;
  }

  private parseStatus(element: Element | null): number {
    switch (element?.text()?.toLowerCase()) {
      case "ongoing":
      case "đang tiến hành":
      case "進行中":
        return SManga.ONGOING;
      case "completed":
      case "hoàn thành":
      case "完了":
        return SManga.COMPLETED;
      case "on-hold":
      case "tạm ngưng":
      case "保留":
        return SManga.ON_HIATUS;
      case "canceled":
      case "đã huỷ":
      case "キャンセル":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ============================== Chapters ==============================

  protected chapterListSelector() {
    return "ul > li.chapter";
  }

  protected chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const time = element.selectFirst("time[datetime]");
    if (time) {
      const t = Number(time.attr("datetime"));
      chapter.date_upload = time.attr("datetime") && Number.isInteger(t) ? t * 1000 : 0;
    }
    const a = element.selectFirst("a")!;
    chapter.name = a.text();
    chapter.url = urlWithoutDomain(a.attr("abs:href"));
    return chapter;
  }

  // =============================== Pages ================================

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const document = (await this.client.get(chapterUrl)).asJsoup();
    // script:containsData(const CHAPTER_ID)
    const script = document
      .select("script")
      .find((it) => it.data().includes("const CHAPTER_ID"))
      ?.data();
    if (script == null) throw new Error("Failed to get chapter id");

    const chapterId = substringBefore(substringAfter(script, "const CHAPTER_ID = "), ";");

    const pageHeaders = this.headersBuilder();
    pageHeaders.append("Accept", "application/json, text/javascript, */*; q=0.01");
    pageHeaders.set("Referer", chapterUrl);
    pageHeaders.append("X-Requested-With", "XMLHttpRequest");

    const data = (await this.client.get(`${this.baseUrl}/ajax/image/list/chap/${chapterId}`, pageHeaders)).parseAs<PageListResponseDto>();

    if (!data.status) throw new Error(data.msg ?? "Unknown error");

    return this.pageListParse(parseHtml(this.host.load, data.html, chapterUrl));
  }

  protected pageListParse(document: Document): Page[] {
    if (document.selectFirst("div.separator[data-index]") == null) {
      return document
        .select("div.separator")
        .map((page) => page.selectFirst("a")?.attr("abs:href"))
        .filter((url): url is string => url != null && this.isPageImageUrl(url))
        .map((url, i) => new Page(i, "", url));
    }
    return document
      .select("div.separator[data-index]")
      .flatMap((page) => {
        const url = page.selectFirst("a")?.attr("abs:href");
        if (url == null || !this.isPageImageUrl(url)) return [];
        return [new Page(parseInt(page.attr("data-index"), 10), "", url)];
      })
      .sort((a, b) => a.index - b.index);
  }

  private isPageImageUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const path = substringBefore(substringBefore(lowerUrl, "?"), "#");
    return !path.endsWith(".svg") && !lowerUrl.includes("loading_comments");
  }

  override imageRequest(page: Page) {
    const req = super.imageRequest(page);
    const headers = new Headers(req.headers);
    headers.set("Accept", "image/avif,image/webp,*/*");
    headers.delete("Referer");
    headers.delete("Origin");
    return { url: req.url, headers };
  }

  // ============================= Utilities ==============================

  // From mangathemesia
  private imgAttr(element: Element): string {
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    return element.attr("abs:src");
  }
}
