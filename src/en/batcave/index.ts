// Port of keiyoushi/extensions-source src/en/batcave/BatCave.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  DateTimeFormatter,
  firstInstanceOrNull,
  parseAs,
  substringAfter,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Response,
} from "../../../sdk/index.ts";
import { dleGuardInterceptor } from "./DleGuardResolver.ts";
import type { ChapterApiResponse, ChapterRequestBody, Chapters, RelatedComic, XFilterItems, XFilters } from "./dto.ts";
import { GenreFilter, PublisherFilter, SortFilter, YearFilter, type UrlPartFilter } from "./filters.ts";

const intRegex = /^\d+/;

/**
 * OkHttp's path segment encoding leaves `[ ] = ,` alone (the site's filter URLs are `y[from]=1990/p=1,2/`), which the
 * SDK's addPathSegment does not; encode like OkHttp and add the segment pre-encoded.
 */
const okSegment = (s: string) => s.replace(/[ "<>^`{}|/\\?#%\x00-\x1f\x7f]|[^\x00-\x7f]+/g, (m) => encodeURIComponent(m));

type UrlBuilder = ReturnType<ReturnType<typeof toHttpUrl>["newBuilder"]>;
const addSegment = (b: UrlBuilder, segment: string) => b.addEncodedPathSegment(okSegment(segment));
const addSegments = (b: UrlBuilder, segments: string) => {
  for (const s of segments.split("/")) addSegment(b, s);
};

export default class BatCave extends KeiSource {
  // Use client to sync cookies with WebView and intercept the DLE Guard redirect.
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(dleGuardInterceptor(this.baseUrl));
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Sec-Fetch-Dest", "document");
    headers.set("Sec-Fetch-Mode", "navigate");
    headers.set("Sec-Fetch-Site", "none");
    headers.set("Sec-Fetch-User", "?1");
    return headers;
  }

  // ============================== Popular ==============================
  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    addSegment(url, "comix");
    if (page > 1) addSegments(url, `page/${page}`);
    addSegment(url, "");

    const body = new URLSearchParams();
    body.append("dlenewssortby", "rating");
    body.append("dledirection", "desc");
    body.append("set_new_sort", "dle_sort_cat_1");
    body.append("set_direction_sort", "dle_direction_cat_1");

    return this.parseSearchMangas(await this.client.post(url.build().toString(), undefined, body));
  }

  // ============================== Latest ===============================
  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (page > 1) {
      addSegments(url, `page/${page}`);
      addSegment(url, "");
    }

    const document = (await this.client.get(url.build().toString())).asJsoup();

    const entries: SManga[] = [];
    for (const element of document.select("#content-load > .latest.grid-item")) {
      const manga = SManga.create();
      const a = element.selectFirst(".latest__title > a")!;
      if (a.ownText().length === 0) continue;
      manga.url = urlWithoutDomain(a.absUrl("href"));
      manga.title = a.ownText();
      manga.thumbnail_url = element.selectFirst(".latest__img img")?.absUrl("src");
      entries.push(manga);
    }

    const hasNextPage = document.selectFirst("li.pagination a[href]") != null;

    return new MangasPage(entries, hasNextPage);
  }

  // ============================== Search ===============================
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.trim()) {
      const url = toHttpUrl(this.baseUrl).newBuilder();
      addSegment(url, "search");
      addSegment(url, query);
      if (page > 1) {
        addSegment(url, "page");
        addSegment(url, String(page));
      }
      addSegment(url, "");
      return this.parseSearchMangas(await this.client.get(url.build().toString()));
    }

    let filtersApplied = false;
    const filterPath = { value: "" };
    for (const filter of [firstInstanceOrNull(filters, YearFilter), firstInstanceOrNull(filters, PublisherFilter), firstInstanceOrNull(filters, GenreFilter)] as (UrlPartFilter | null)[]) {
      if (filter?.addFilterToUrl(filterPath)) filtersApplied = true;
    }

    const url = toHttpUrl(this.baseUrl).newBuilder();
    addSegment(url, "ComicList");

    if (filtersApplied) addSegments(url, filterPath.value);
    else {
      // Send something to force ComicList
      addSegment(url, "y[from]=1926");
      addSegment(url, `y[to]=${new Date().getFullYear()}`);
    }
    if (page > 1) addSegments(url, `page/${page}`);
    addSegment(url, "");

    const sort = firstInstanceOrNull(filters, SortFilter) ?? new SortFilter();

    const body = new URLSearchParams();
    body.append("dlenewssortby", sort.getSort());
    body.append("dledirection", sort.getDirection());
    body.append("set_new_sort", "dle_sort_xfilter");
    body.append("set_direction_sort", "dle_direction_xfilter");

    return this.parseSearchMangas(await this.client.post(url.build().toString(), undefined, body));
  }

  private parseSearchMangas(response: Response): MangasPage {
    const document = response.asJsoup();

    const entries = document.select("#dle-content > .readed").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst(".readed__title > a")!;
      manga.url = urlWithoutDomain(a.absUrl("href"));
      manga.title = a.ownText();
      manga.thumbnail_url = element.selectFirst(".readed__img img")?.absUrl("data-src");
      return manga;
    });
    const hasNextPage = document.selectFirst("div.pagination__pages")?.children().last()?.tagName() === "a";

    return new MangasPage(entries, hasNextPage);
  }

  // ============================== Details ==============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    return this.parseMangaDetails((await this.client.get(url)).asJsoup());
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(doc), this.parseChapterList(doc));
  }

  private parseMangaDetails(doc: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(doc.location());
    manga.title = doc.selectFirst("header.page__header h1")!.text();
    manga.thumbnail_url = doc.selectFirst("div.page__poster img")?.absUrl("src");

    let description = "";
    const publisher = this.getPageListItem(doc, "Publisher");
    if (publisher != null) description += publisher;
    const year = this.getPageListItem(doc, "Year");
    if (year != null) description += ` — ${year}\n`;
    description += "\n";
    description += doc.selectFirst("div.page__text")?.text() ?? "null";
    manga.description = description;

    manga.author = this.getPageListItem(doc, "Writer") ?? undefined;
    manga.artist = this.getPageListItem(doc, "Artist") ?? undefined;

    manga.genre = [...doc.select("div.page__tags a").map((it) => it.text()), "Comic"].join(", ");
    switch (doc.selectFirst(".page__list > li:has(> div:contains(Release type))")?.ownText().trim()) {
      case "Ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "Completed":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }

    const anchor = doc.selectFirst(".page__similar-panel.is-active")?.select(".scroller-2 a.poster");
    if (anchor) {
      const similar: RelatedComic[] = [];
      for (const it of anchor) {
        const rawTitle = it.selectFirst(".poster__title")?.text();
        const title = rawTitle && rawTitle.trim() ? rawTitle : null;
        const rawUrl = it.attr("href");
        const url = rawUrl.trim() ? rawUrl : null;
        const thumb = it.selectFirst("img")?.attr("data-src");
        if (title != null && url != null) similar.push({ name: title, url, thumbnail: thumb });
      }
      manga.memo = { similarComics: similar };
    }
    return manga;
  }

  private parseChapterList(document: Document): SChapter[] {
    const script = document.selectFirst("script:containsData(window.__DATA__)")?.data();
    if (script == null) throw new Error("Chapter data script not found");

    const data = parseAs<Chapters>(substringBeforeLast(substringAfter(script, "window.__DATA__ = "), ";").trim());

    return (data.chapters ?? []).map((chap) => {
      const chapter = SChapter.create();
      chapter.url = `/reader/${data.news_id}/${chap.id}${data.xhash ?? ""}`;
      chapter.name = chap.title;
      chapter.chapter_number = chap.posi;
      chapter.date_upload = this.dateFormat.tryParseDate(chap.date);
      return chapter;
    });
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("d.M.yyyy");

  // ============================== Related ==============================
  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const related = manga.memo.similarComics;

    return (Array.isArray(related) ? (related as RelatedComic[]) : []).map((it) => {
      const m = SManga.create();
      m.title = it.name;
      m.thumbnail_url = `${this.baseUrl}${it.thumbnail}`;
      m.url = urlWithoutDomain(it.url);
      return m;
    });
  }

  // =============================== Pages ===============================
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const rest = substringAfter(chapter.url, "reader/");
    const slash = rest.indexOf("/");
    const newsId = slash < 0 ? rest : rest.slice(0, slash);
    const rawId = slash < 0 ? undefined : rest.slice(slash + 1);
    if (rawId === undefined) throw new Error("Refresh chapter list");
    const id = intRegex.exec(rawId)?.[0] ?? rawId;
    const body: ChapterRequestBody = { news_id: newsId, chapter_id: id };

    const headers = this.headers;
    headers.set("Content-Type", "application/json");
    const response = await this.client.post(`${this.baseUrl}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`, headers, JSON.stringify(body));
    const data = response.parseAs<ChapterApiResponse>().data;
    return (data.images ?? []).map((img, idx) => {
      const imageUrl = img.startsWith("http") ? img.trim() : this.baseUrl + img.trim();
      return new Page(idx, "", imageUrl);
    });
  }

  // ============================== Filters ==============================
  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const doc = (await this.client.get(`${this.baseUrl}/comix/`)).asJsoup();
    const script = doc.selectFirst("script:containsData(window.__XFILTER__)")?.data();
    if (script == null) throw new Error("Filter data not found");

    const rawFilters = substringBeforeLast(substringAfter(script, "window.__XFILTER__ = "), ";").trim();

    return parseAs<XFilters>(rawFilters).filter_items;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as XFilterItems | null;

    const filters: Filter[] = [new Filter.Header("Filters don't work with text search"), new Filter.Separator(), new SortFilter(), new YearFilter()];

    const publishers = (filterData?.p?.values ?? []).map((it): [string, number] => [it.value, it.id]);
    const genres = (filterData?.g?.values ?? []).map((it): [string, number] => [it.value, it.id]);

    if (publishers.length > 0) filters.push(new PublisherFilter(publishers));
    if (genres.length > 0) filters.push(new GenreFilter(genres));
    return FilterList(...filters);
  }

  private getPageListItem(doc: Document, label: string): string | null {
    const li = doc.selectFirst(`.page__list > li:has(> div:contains(${label}))`);
    const a = li?.children().find((it) => it.tagName() === "a");
    const text = a?.text();
    return text && text.trim() ? text : null;
  }
}
