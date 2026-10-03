// Port of keiyoushi/extensions-source src/all/misskon/MissKon.kt
import { DateTimeFormatter, Filter, FilterList, HttpUrl, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstance, urlWithoutDomain, type ClientBuilder, type Document, type Element } from "../../../sdk/index.ts";
import { SourceCategorySelector } from "./filters.ts";

const FULL_DATE_REGEX = /\/(\d{4}\/\d{2}\/\d{2})\//;
const YEAR_MONTH_REGEX = /\/(\d{4}\/\d{2})\//;
const FULL_DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy/MM/dd", Locale.US);

export default class MissKon extends KeiSource {
  private get baseUrlHost() {
    return HttpUrl.parse(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(10, 1000, (it) => it.hostname === this.baseUrlHost);
  }

  private mangaFromElement(element: Element): SManga {
    const titleEL = element.selectFirst(".post-box-title")!;
    const manga = SManga.create();
    manga.title = titleEL.text();
    manga.thumbnail_url = element.selectFirst(".post-thumbnail img")?.absUrl("data-src");
    manga.url = urlWithoutDomain(titleEL.selectFirst("a")!.absUrl("href"));
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    return manga;
  }

  // region popular
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/top3/`)).asJsoup();
    const mangas = document.select("article.item-list").map((it) => this.mangaFromElement(it));
    return new MangasPage(mangas, false);
  }
  // endregion

  // region latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/page/${page}`)).asJsoup();
    const mangas = document.select("article.item-list").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst(".current + a.page") != null;
    return new MangasPage(mangas, hasNextPage);
  }
  // endregion

  // region Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const filter = firstInstance(filters, SourceCategorySelector);
    const category = filter.selectedCategory;
    const url = category != null ? HttpUrl.parse(`${this.baseUrl}${category.url}`) : HttpUrl.parse(`${this.baseUrl}/page/${page}/`).newBuilder().addEncodedQueryParameter("s", query).build();

    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select("article.item-list").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("div.content > div.pagination > span.current + a") != null;
    return new MangasPage(mangas, hasNextPage);
  }
  // endregion

  // region Details
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const updatedManga = this.parseMangaDetails(document);
    const updatedChapters = this.parseChapterList(document, manga.url);
    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private parseMangaDetails(document: Document): SManga {
    const postInnerEl = document.selectFirst("article > .post-inner")!;
    const manga = SManga.create();
    manga.title = postInnerEl.select(".post-title").text();
    manga.genre = postInnerEl
      .select(".post-tag > a")
      .map((it) => it.text())
      .join(", ");
    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    return manga;
  }

  private parseChapterList(document: Document, mangaUrl: string): SChapter[] {
    const imgUrl = document.selectFirst(".entry img")?.absUrl("data-src");
    let dateUploadStr: string | null = null;
    if (imgUrl != null) {
      const full = FULL_DATE_REGEX.exec(imgUrl)?.[1];
      const ym = YEAR_MONTH_REGEX.exec(imgUrl)?.[1];
      dateUploadStr = full ?? (ym != null ? `${ym}/01` : null);
    }
    const dateUpload = FULL_DATE_FORMAT.tryParseDate(dateUploadStr);
    const last = document.select("div.page-link:first-of-type a.post-page-numbers").last()?.text();
    let maxPage = 1;
    if (last != null) {
      if (!/^[+-]?\d+$/.test(last)) throw new Error(`NumberFormatException: For input string: "${last}"`);
      maxPage = Number.parseInt(last, 10);
    }
    const chapters: SChapter[] = [];
    for (let page = maxPage; page >= 1; page--) {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(`${mangaUrl}/${page}`);
      chapter.name = `Page ${page}`;
      chapter.date_upload = dateUpload;
      chapters.push(chapter);
    }
    return chapters;
  }

  /* Related titles */
  override get supportsRelatedMangas(): boolean {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return document.select(".content > .yarpp-related a.yarpp-thumbnail").map((element) => {
      const m = SManga.create();
      m.url = urlWithoutDomain(element.absUrl("href"));
      m.title = element.attr("title");
      m.thumbnail_url = element.selectFirst("img")?.absUrl("data-src");
      return m;
    });
  }
  // endregion

  // region Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.post-inner > div.entry > p > img").map((imgEl, i) => new Page(i, "", imgEl.absUrl("data-src")));
  }
  // endregion

  /* Filters */
  override getFilterList(_data: unknown = null): FilterList {
    return [new Filter.Header("NOTE: Unable to further search in the category!"), new Filter.Separator(), SourceCategorySelector.create()];
  }
}
