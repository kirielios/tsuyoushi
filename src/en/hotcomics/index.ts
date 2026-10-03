// Port of keiyoushi/extensions-source src/en/hotcomics/HotComics.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  firstInstance,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type Request,
} from "../../../sdk/index.ts";

const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

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

const browseList: [string, string][] = [
  ["Home", "en"],
  ["Weekly", "en/weekly"],
  ["New", "en/new"],
  ["Genre: All", "en/genres"],
  ["Genre: Sports", "en/genres/Sports"],
  ["Genre: Historical", "en/genres/Historical"],
  ["Genre: Drama", "en/genres/Drama"],
  ["Genre: BL", "en/genres/BL"],
  ["Genre: Thriller", "en/genres/Thriller"],
  ["Genre: School life", "en/genres/School_life"],
  ["Genre: Comedy", "en/genres/Comedy"],
  ["Genre: GL", "en/genres/GL"],
  ["Genre: Action", "en/genres/Action"],
  ["Genre: Sci-fi", "en/genres/Sci-fi"],
  ["Genre: Horror", "en/genres/Horror"],
  ["Genre: Fantasy", "en/genres/Fantasy"],
  ["Genre: Romance", "en/genres/Romance"],
];

class BrowseFilter extends SelectFilter {
  constructor(list: [string, string][]) {
    super("Browse", list);
  }
}

export default class HotComics extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.addInterceptor((request) => this.addCookie(request, [["hc_vfs", "Y"]]));
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the source's domain on every matching request, which then sends them. */
  private addCookie(request: Request, cookies: [string, string][]): Request {
    const domain = HttpUrl.parse(this.baseUrl).host;
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    }
    return request;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/en`)).asJsoup());
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/en/new`)).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const b = HttpUrl.parse(this.baseUrl).newBuilder();
    if (query.length > 0) {
      b.addEncodedPathSegments("en/search");
      b.addQueryParameter("keyword", query.trim());
    } else {
      const filter = firstInstance(filters, BrowseFilter);
      b.addEncodedPathSegments(filter.selected);
      b.addQueryParameter("page", String(page));
    }
    return this.parseMangaList((await this.client.get(b.build().toString())).asJsoup());
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Doesn't work with Text search"), new Filter.Separator(), new BrowseFilter(browseList));
  }

  private parseMangaList(document: Document): MangasPage {
    const entries = distinctBy(
      document.select("li[itemtype*=ComicSeries]:not(.no-comic) > a").map((element) => {
        const manga = SManga.create();
        manga.url = urlWithoutDomain(element.absUrl("href"));
        manga.thumbnail_url = this.imgAttr(element.selectFirst("div.visual img"));
        manga.title = element.selectFirst("div.main-text > h4.title")!.text();
        return manga;
      }),
      (it) => it.url,
    );
    const hasNextPage = document.selectFirst("div.pagination a.vnext:not(.disabled)") != null;
    return new MangasPage(entries, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(manga, document), this.chapterListParse(document));
  }

  private mangaDetailsParse(manga: SManga, document: Document): SManga {
    manga.title = document.selectFirst("h2.episode-title")!.text();
    const typeBox = document.selectFirst("p.type_box")!;
    manga.author = substringAfterOrUndefined(typeBox.selectFirst("span.writer")?.text(), "ⓒ")?.trim();
    manga.genre = typeBox
      .selectFirst("span.type")
      ?.text()
      .split("/")
      .map((it) => it.trim())
      .join(", ");
    const dateText = typeBox.selectFirst("span.date")?.text();
    manga.status = dateText === "End" || dateText === "Ende" ? SManga.COMPLETED : dateText === undefined ? SManga.UNKNOWN : SManga.ONGOING;

    let description = "";
    const header = document.selectFirst("div.episode-contents header")?.text();
    if (header !== undefined) description += `${header}\n\n`;
    const sub = document.selectFirst("div.title_content > h2:not(.episode-title)")?.text();
    if (sub !== undefined) description += sub;
    manga.description = description.trim();
    return manga;
  }

  private chapterListParse(document: Document): SChapter[] {
    return document
      .select("#tab-chapter a")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(substringBefore(substringAfter(element.attr("onclick"), "popupLogin('"), "'"));
        chapter.name = element.selectFirst(".cell-num")!.text();
        chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".cell-time")?.text());
        return chapter;
      })
      .reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#viewer-img img").map((img, idx) => new Page(idx, "", this.imgAttr(img)));
  }

  private imgAttr(element: Element | null): string | undefined {
    if (!element) return undefined;
    return element.hasAttr("data-src") ? element.absUrl("data-src") : element.absUrl("src");
  }
}

const substringAfterOrUndefined = (s: string | undefined, d: string): string | undefined => (s === undefined ? undefined : substringAfter(s, d));
