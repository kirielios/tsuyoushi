// Port of keiyoushi/extensions-source lib-multisrc/goda/GoDa.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfter,
  substringAfterLast,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  type Document,
  type Element,
  type Response,
} from "../../sdk/index.ts";

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);
const removePrefix = (s: string, prefix: string) => (s.startsWith(prefix) ? s.slice(prefix.length) : s);

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export abstract class GoDa extends KeiSource {
  enableGenres = true;

  // Popular + latest
  popularMangaUrl(page: number) {
    return `${this.baseUrl}/hots/page/${page}`;
  }

  override async getPopularManga(page: number) {
    return this.parsePopularMangas(await this.client.get(this.popularMangaUrl(page)));
  }

  latestUpdatesUrl(page: number) {
    return `${this.baseUrl}/newss/page/${page}`;
  }

  override async getLatestUpdates(page: number) {
    return this.parseLatestMangas(await this.client.get(this.latestUpdatesUrl(page)));
  }

  parsePopularMangas(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select(".container > .cardlist .pb-2 a").map((element) => {
      const manga = SManga.create();
      const imgSrc = element.selectFirst("img")!.attr("src");
      manga.url = this.getKey(element.attr("href"));
      manga.title = element.selectFirst("h3")!.ownText();
      manga.thumbnail_url = imgSrc.includes("url=") ? toHttpUrl(imgSrc).queryParameter("url")! : imgSrc;
      return manga;
    });
    const nextPage = this.lang === "zh" ? "下一頁" : "NEXT";
    const hasNextPage = document.selectFirst(`a[aria-label=${nextPage}] button`) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  parseLatestMangas(response: Response) {
    return this.parsePopularMangas(response);
  }

  // Search
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: string;
    if (query) {
      url = toHttpUrl(`${this.baseUrl}/s`).newBuilder().addPathSegment(query).addQueryParameter("page", String(page)).build().toString();
    } else {
      let filterUrl = this.popularMangaUrl(page);
      for (const filter of filters) {
        if (filter instanceof UriPartFilter) filterUrl = this.baseUrl + filter.toUriPart() + `/page/${page}`;
      }
      url = filterUrl;
    }
    return this.parseSearchManga(await this.client.get(url));
  }

  parseSearchManga(response: Response) {
    return this.parsePopularMangas(response);
  }

  // Details + Chapters
  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const mangaId = manga.memo?.id as string | undefined;

    if (fetchChapters && mangaId != null) {
      const [updated, list] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, this.fetchChapterList(mangaId)]);
      return new SMangaUpdate(updated, list);
    }
    const updatedManga = mangaId == null || fetchDetails ? await this.getMangaDetails(manga) : manga;

    const updatedChapters = fetchChapters ? await this.fetchChapterList(updatedManga.memo.id as string) : chapters;
    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  async getMangaDetails(manga: SManga) {
    return this.parseMangaDetails((await this.client.get(this.getMangaUrl(manga))).asJsoup());
  }

  /** Entities.unescape */
  protected unescape(s: string) {
    return this.host.load(s, null, false).text();
  }

  parseMangaDetails(doc: Document): SManga {
    const manga = SManga.create();
    const mangaId = this.getMangaId(doc);
    const document = doc.selectFirst("main")!;
    const titleElement = document.selectFirst("h1")!;
    const elements = titleElement.parent()!.parent()!.children();
    if (elements[4].tagName() !== "p") throw new Error("Check failed.");

    manga.title = titleElement.ownText();
    switch (titleElement.children()[0]?.text()) {
      case "連載中":
      case "Ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "完結":
        manga.status = SManga.COMPLETED;
        break;
      case "停止更新":
        manga.status = SManga.CANCELLED;
        break;
      case "休刊":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    manga.author = this.unescape(
      elements[1]
        .children()
        .slice(1)
        .map((it) => removeSuffix(it.text(), " ,"))
        .join(", "),
    );
    manga.genre = [...elements[2].children().slice(1).map((it) => removeSuffix(it.text(), " ,")), ...elements[3].children().map((it) => removePrefix(it.text(), "#"))].join(", ");
    manga.description = `${elements[4].text()}\n\nID: ${mangaId}`.trim();
    manga.thumbnail_url = document.selectFirst("img.object-cover")!.attr("src");

    manga.memo = { id: mangaId };
    return manga;
  }

  async fetchChapterList(mangaId: string): Promise<SChapter[]> {
    const response = await this.client.get(`${this.baseUrl}/manga/get?mid=${mangaId}&mode=all`);
    const document = response.asJsoup();

    return document
      .select(".chapteritem")
      .reverse()
      .map((element) => {
        const anchor = element.selectFirst("a")!;
        const chapter = SChapter.create();
        chapter.url = this.getKey(anchor.attr("href")) + `#${mangaId}/` + anchor.attr("data-cs");
        chapter.name = anchor.attr("data-ct");
        return chapter;
      });
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/manga/` + substringBeforeLast(chapter.url, "#");
  }

  // Pages
  private chapterPageListUrl(chapter: SChapter) {
    const id = substringAfterLast(chapter.url, "#", "");
    const mangaId = substringBefore(id, "/", "");
    const chapterId = substringAfter(id, "/", "");
    if (!mangaId || !chapterId) throw new Error(this.lang === "zh" ? "请刷新漫画" : "Refresh manga");
    return this.pageListUrl(mangaId, chapterId);
  }

  pageListUrl(mangaId: string, chapterId: string) {
    return `${this.baseUrl}/chapter/getcontent?m=${mangaId}&c=${chapterId}`;
  }

  override async getPageList(chapter: SChapter) {
    return this.parsePageList(await this.client.get(this.chapterPageListUrl(chapter)));
  }

  parsePageList(response: Response): Page[] {
    return response
      .asJsoup()
      .select("#chapcontent > div > img")
      .map((element, index) => new Page(index, "", element.attr("data-src") || element.attr("src")));
  }

  // Filters
  override get supportsFilterFetching() {
    return this.enableGenres;
  }

  parseGenres(document: Document): Record<string, string> {
    const box = document.selectFirst("h2")?.parent()?.parent();
    if (!box) return {};
    const items = box.select("a");
    return Object.fromEntries(items.map((it) => [removePrefix(it.text(), "#"), it.attr("href")]));
  }

  get genresUrl() {
    return this.popularMangaUrl(1);
  }

  override async fetchFilterData(): Promise<unknown> {
    const response = await this.client.get(this.genresUrl);
    return this.parseGenres(response.asJsoup());
  }

  override getFilterList(data: unknown = null): FilterList {
    const list: Filter[] = [];
    const genres = (data as Record<string, string> | null) ?? {};

    if (this.enableGenres && Object.keys(genres).length) {
      list.push(new Filter.Header(this.lang === "zh" ? "分类（搜索文本时无效）" : "Filters are ignored when using text search."));
      list.push(new UriPartFilter(this.lang === "zh" ? "分类" : "Genre", Object.entries(genres)));
    }
    return list;
  }

  // Utils
  getKey(link: string): string {
    return removeSuffix(substringAfter(link, "/manga/"), "/");
  }

  getMangaId(doc: Element) {
    return doc.selectFirst("#mangachapters")!.attr("data-mid");
  }
}
