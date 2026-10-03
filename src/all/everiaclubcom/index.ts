// Port of keiyoushi/extensions-source src/all/everiaclubcom/EveriaClubCom.kt
import {
  Filter,
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  firstInstance,
  isNotBlank,
  toHttpUrl,
  urlWithoutDomain,
  type Element,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

export default class EveriaClubCom extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.append("Referer", `${this.baseUrl}/`);
    return headers;
  }

  private imgSrc(element: Element): string | undefined {
    if (element.hasAttr("data-original")) return element.attr("data-original");
    if (element.hasAttr("data-lazy-src")) return element.attr("data-lazy-src");
    if (element.hasAttr("data-src")) return element.attr("data-src");
    if (element.hasAttr("src")) return element.attr("src");
    return undefined;
  }

  private mangaFromElement(it: Element): SManga {
    const manga = SManga.create();
    const abs = it.attr("abs:href") || it.absUrl("href");
    manga.url = urlWithoutDomain(abs.startsWith(this.baseUrl) ? abs.substring(this.baseUrl.length) : abs);
    const img = it.selectFirst("img")!;
    manga.thumbnail_url = this.imgSrc(img);
    manga.title = img.attr("title");
    return manga;
  }

  // Latest
  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/?page=${page}`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".mainleft .leftp > a").map((it) => this.mangaFromElement(it));
    const isLastPage = document.selectFirst("li:has(span.current) + li > a");
    return new MangasPage(mangas, isLastPage != null);
  }

  // Popular
  protected popularMangaRequest(_page: number): Request {
    return GET(this.baseUrl, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".mainright li a").map((it) => this.mangaFromElement(it));
    return new MangasPage(mangas, false);
  }

  // Search
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const tagFilter = firstInstance(filters, TagFilter);
    const categoryFilter = firstInstance(filters, CategoryFilter);
    let url;
    if (isNotBlank(tagFilter.state)) {
      url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("tags").addPathSegment(tagFilter.state).addPathSegment(String(page));
    } else if (categoryFilter.state !== 0) {
      url = toHttpUrl(`${this.baseUrl}/${categoryFilter.toUriPart()}?page=${page}`).newBuilder();
    } else if (isNotBlank(query)) {
      url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("search").addPathSegment("").addQueryParameter("keyword", query).addQueryParameter("page", String(page));
    } else {
      url = toHttpUrl(`${this.baseUrl}/?page=${page}`).newBuilder();
    }
    return GET(url.build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.latestUpdatesParse(response);
  }

  // Details
  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.genre = document
      .select("div.end span:contains(Tags:) ~ a > p.tags")
      .map((it) => it.ownText())
      .join(", ");
    manga.status = SManga.COMPLETED;
    return manga;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const chapter = SChapter.create();
    chapter.url = manga.url;
    chapter.name = "Gallery";
    chapter.chapter_number = 1;
    chapter.date_upload = 0;
    return [chapter];
  }

  protected chapterListParse(_response: Response): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const images = document.select(".mainleft img");
    return images.map((image, index) => new Page(index, "", this.imgSrc(image)));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Only one filter will be applied!"), new Filter.Separator(), new TagFilter(), new CategoryFilter());
  }
}

class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly valuePair: [string, string][],
  ) {
    super(displayName, valuePair.map((it) => it[0]));
  }
  toUriPart() {
    return this.valuePair[this.state][1];
  }
}

class CategoryFilter extends UriPartFilter {
  constructor() {
    super("Category", [
      ["Any", ""],
      ["Gravure", "Gravure.html"],
      ["Japan", "Japan.html"],
      ["Korea", "Korea.html"],
      ["Thailand", "Thailand.html"],
      ["Chinese", "Chinese.html"],
      ["Cosplay", "Cosplay.html"],
    ]);
  }
}

class TagFilter extends Filter.Text {
  constructor() {
    super("Tag");
  }
}
