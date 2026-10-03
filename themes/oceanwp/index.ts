// Port of keiyoushi/extensions-source lib-multisrc/oceanwp/OceanWP.kt (+ Filters.kt)
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, urlWithoutDomain, type Document, type Element } from "../../sdk/index.ts";

abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected() {
    return this.options[this.state][1];
  }
}

export class CategoryFilter extends SelectFilter {
  constructor(options: [string, string][]) {
    super("Category", options);
  }
}
export class TagFilter extends SelectFilter {
  constructor(options: [string, string][]) {
    super("Tag", options);
  }
}

interface FilterData {
  categories: [string, string][];
  tags: [string, string][];
}

export abstract class OceanWP extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // Popular
  override async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(page > 1 ? `${this.baseUrl}/page/${page}/` : this.baseUrl)).asJsoup();
    const mangas = document.select("article.blog-entry").map((element) => this.popularMangaFromElement(element));
    const hasNextPage = document.selectFirst("ul.page-numbers li a.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const link = element.selectFirst("h2.blog-entry-title a")!;
    manga.title = link.text();
    manga.url = urlWithoutDomain(link.absUrl("href"));
    manga.thumbnail_url = element.selectFirst("div.thumbnail img")?.absUrl("src");
    return manga;
  }

  // Latest
  override getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("Unsupported operation");
  }

  // Search
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categoryFilter = filters.find((it) => it instanceof CategoryFilter) as CategoryFilter | undefined;
    const tagFilter = filters.find((it) => it instanceof TagFilter) as TagFilter | undefined;

    let url: string;
    if (query) {
      const b = toHttpUrl(this.baseUrl).newBuilder();
      b.addQueryParameter("s", query);
      if (page > 1) b.addPathSegments(`page/${page}/`);
      url = b.build().toString();
    } else if (categoryFilter != null && categoryFilter.state > 0) {
      url = page > 1 ? `${categoryFilter.selected}page/${page}/` : categoryFilter.selected;
    } else if (tagFilter != null && tagFilter.state > 0) {
      url = page > 1 ? `${tagFilter.selected}page/${page}/` : tagFilter.selected;
    } else {
      const b = toHttpUrl(this.baseUrl).newBuilder();
      if (page > 1) b.addPathSegments(`page/${page}/`);
      url = b.build().toString();
    }

    return this.searchMangaParse((await this.client.get(url)).asJsoup());
  }

  private searchMangaParse(document: Document): MangasPage {
    const mangas = document.select("article").map((element) => this.searchMangaFromElement(element));
    const hasNextPage = document.selectFirst("ul.page-numbers li a.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const link = element.selectFirst("h2.search-entry-title a, h2.blog-entry-title a")!;
    manga.title = link.text();
    manga.url = urlWithoutDomain(link.absUrl("href"));
    manga.thumbnail_url = element.selectFirst("div.thumbnail img")?.absUrl("src");
    return manga;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host || !url.pathname.split("/").some((it) => it)) return null;

    const manga = this.mangaDetailsParse((await this.client.get(url)).asJsoup());
    manga.url = urlWithoutDomain(url.toString());
    return manga;
  }

  // Details
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.mangaDetailsParse((await this.client.get(this.getMangaUrl(manga))).asJsoup()) : manga;
    const chapter = SChapter.create();
    chapter.name = "Chapter 1";
    chapter.url = urlWithoutDomain(manga.url);
    return new SMangaUpdate(details, [chapter]);
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const content = document.selectFirst("div#content") ?? document;
    manga.title = content.selectFirst(".entry-title")!.text();
    manga.description = content.selectFirst("div.entry-content")?.text();
    manga.genre = content
      .select("li.meta-cat a, li.meta-category a")
      .map((it) => it.text())
      .join(", ");
    manga.thumbnail_url = content.selectFirst("div.thumbnail img")?.absUrl("src");
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: SManga has no update strategy here
    manga.status = SManga.COMPLETED;
    return manga;
  }

  // Pages
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.entry-content img").map((img, i) => new Page(i, document.location(), img.absUrl("src")));
  }

  // Filters
  protected hasTagFilter = true;

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const categories = document.select("ul.sub-menu li[class*=menu-item-type-taxonomy] a").map((it) => [it.text(), it.absUrl("href")]);
    const tags = this.hasTagFilter ? document.select("div.tagcloud a").map((it) => [it.text(), it.absUrl("href")]) : [];
    return { categories, tags };
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as FilterData | null;
    if (!filterData) return FilterList();
    const categoryList: [string, string][] = [["Default", ""], ...filterData.categories];
    const tagList: [string, string][] = [["Default", ""], ...filterData.tags];

    const filters: Filter[] = [];
    filters.push(new Filter.Header("Filter tidak bisa dikombinasikan dengan pencarian teks"));

    if (categoryList.length > 1 && tagList.length > 1) {
      filters.push(new Filter.Header("Filter di bawah ini tidak bisa dikombinasikan satu sama lain"));
    }

    filters.push(new Filter.Separator());

    if (categoryList.length > 1) filters.push(new CategoryFilter(categoryList));

    if (tagList.length > 1 && this.hasTagFilter) filters.push(new TagFilter(tagList));

    return filters;
  }
}
