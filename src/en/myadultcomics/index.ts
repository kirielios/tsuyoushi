// Port of keiyoushi/extensions-source src/en/myadultcomics/MyAdultComics.kt (+ Filters.kt)
import {
  Filter,
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  firstInstanceOrNull,
  isNotBlank,
  toHttpUrl,
  urlWithoutDomain,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

class Filters extends Filter.Select<string> {
  constructor() {
    super("Search Type", ["Title", "Parody", "Character", "Tag", "Artist"]);
  }
  selectedValue(): string {
    switch (this.state) {
      case 0:
        return "title";
      case 1:
        return "1";
      case 2:
        return "2";
      case 3:
        return "3";
      case 4:
        return "4";
      default:
        return "title";
    }
  }
}

export default class MyAdultComics extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.append("Referer", `${this.baseUrl}/`);
    return headers;
  }

  // ============================== Popular ==============================

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/index.php?page=${page}`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas: SManga[] = [];
    for (const element of document.select("td.list_container")) {
      const link = element.selectFirst("p.text_container > a");
      if (link == null) continue;
      const href = link.absUrl("href");

      if (href.length === 0 || link.text().length === 0) continue;

      const image = element.selectFirst("img.fon_pic_img");

      const manga = SManga.create();
      manga.url = urlWithoutDomain(href);
      manga.title = link.text();
      manga.thumbnail_url = image?.absUrl("src");
      mangas.push(manga);
    }
    const hasNextPage = document.selectFirst("td.tbl_page a:contains(>>)") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Use the text search field along with the type below."), new Filters());
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const searchType = firstInstanceOrNull(filters, Filters)?.selectedValue() ?? "title";

    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("index.php");

    if (searchType === "title") {
      if (isNotBlank(query)) {
        url.addQueryParameter("name", query);
      }
      url.addQueryParameter("search", "yes");
    } else {
      url.addQueryParameter("search", query);
      url.addQueryParameter("sort", searchType);
    }
    url.addQueryParameter("page", String(page));

    return GET(url.build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Details ==============================

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();

    const manga = SManga.create();
    manga.title = document.selectFirst("h1#TOP")!.text();
    manga.genre = document
      .select("p.text_info_book:contains(Tags:) a")
      .map((it) => it.text())
      .join(", ");
    manga.artist = document
      .select("p.text_info_book:contains(Artists:) a")
      .map((it) => it.text())
      .join(", ");
    manga.author = manga.artist;
    manga.status = SManga.COMPLETED;
    // ponytail: upstream sets update_strategy = ONLY_FETCH_ONCE; the SDK's SManga has no such field.
    return manga;
  }

  // ============================= Chapters ==============================

  protected chapterListParse(response: Response): SChapter[] {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(response.url);
    chapter.name = "Gallery";
    chapter.date_upload = 0;
    return [chapter];
  }

  // =============================== Pages ===============================

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const script = document.selectFirst("script:containsData(let template)")?.data();
    if (script == null) return [];

    const regex = /src=["'](books\/[^"']+)["']/g;
    return [...script.matchAll(regex)].map((m, index) => new Page(index, "", `${this.baseUrl}/${m[1]}`));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
