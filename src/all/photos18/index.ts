// Port of keiyoushi/extensions-source src/all/photos18/Photos18.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  type Document,
  type HttpUrlBuilder,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

const ZH_HANT = "ZH_HANT";

type Pair = [string, string];

export default class Photos18 extends KeiSource {
  // ponytail: upstream sets followRedirects(false); ClientBuilder has no such switch and the host follows redirects.
  private get baseUrlWithLang() {
    return this.useTrad ? this.baseUrl : `${this.baseUrl}/zh-hans`;
  }
  private stripLang(s: string) {
    return s.startsWith("/zh-hans") ? s.substring("/zh-hans".length) : s;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrlWithLang}/sort/views?page=${page}`)).asJsoup());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrlWithLang}/?page=${page}`)).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrlWithLang).newBuilder().addQueryParameter("q", query).addQueryParameter("page", String(page));

    for (const filter of filters) {
      if (filter instanceof QueryFilter) filter.addQueryTo(url);
    }

    return this.parseMangaList((await this.client.get(url.build().toString())).asJsoup());
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document
      .selectFirst("#videos")!
      .children()
      .map((it) => {
        const cardBody = it.selectFirst(".card-body")!;
        const link = cardBody.selectFirst("a")!;
        const manga = SManga.create();
        manga.url = this.stripLang(link.attr("href"));
        manga.title = link.ownText();
        manga.thumbnail_url = this.baseUrl + it.selectFirst("img")!.attr("src");
        manga.genre = cardBody.selectFirst("label")!.ownText();
        manga.status = SManga.COMPLETED;
        manga.initialized = true;
        return manga;
      });
    const next = document.selectFirst(".next");
    const isLastPage = next == null || next.hasClass("disabled");
    return new MangasPage(mangas, !isLastPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const chapter = SChapter.create();
    chapter.url = manga.url;
    chapter.name = "Gallery";
    chapter.chapter_number = 0;
    return new SMangaUpdate(manga, [chapter]);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const images = document.selectFirst("#content")!.select("img");
    return images.map((image, index) => new Page(index, "", image.attr("src")));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<Pair[]> {
    const document = (await this.client.get(`${this.baseUrlWithLang}/`)).asJsoup();
    const items = document.selectFirst("#w2")!.children();
    const list: Pair[] = [["All", ""]];
    for (const it of items) {
      const value = substringBefore(it.text(), " (");
      const queryValue = substringAfterLast(it.selectFirst("a")!.attr("href"), "/");
      list.push([value, queryValue]);
    }
    return list;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new SortFilter()];
    if (data != null) filters.push(new CategoryFilter(data as Pair[]));
    return FilterList(...filters);
  }

  private get useTrad() {
    return this.preferences.getBoolean(ZH_HANT, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = ZH_HANT;
    pref.title = "Use Traditional Chinese";
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }
}

class QueryFilter extends Filter.Select<string> {
  constructor(
    name: string,
    values: string[],
    private readonly queryName: string,
    private readonly queryValues: string[],
    state = 0,
  ) {
    super(name, values, state);
  }
  addQueryTo(builder: HttpUrlBuilder) {
    return builder.addQueryParameter(this.queryName, this.queryValues[this.state]);
  }
}

class SortFilter extends QueryFilter {
  constructor() {
    super("Sort by", ["Latest", "Popular", "Trend", "Recommended", "Best"], "sort", ["created", "hits", "views", "score", "likes"], 2);
  }
}

class CategoryFilter extends QueryFilter {
  constructor(categories: Pair[]) {
    super("Category", categories.map((it) => it[0]), "category_id", categories.map((it) => it[1]));
  }
}
