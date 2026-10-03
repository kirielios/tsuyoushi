// Port of keiyoushi/extensions-source src/id/komiknextgonline/KomikNextGOnline.kt
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, firstInstanceOrNull, isNotBlank, toHttpUrl, urlWithoutDomain, type Element, type Request, type Response } from "../../../sdk/index.ts";

// Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
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

class CategoryFilter extends UriPartFilter {
  constructor() {
    super("Kategori", [
      ["Semua", ""],
      ["Pendidikan", "pendidikan"],
      ["Persahabatan", "persahabatan"],
      ["Anak Islami", "anak-islami"],
      ["Horor dan Misteri", "horor-dan-misteri"],
    ]);
  }
}

const TITLE_PREFIX_REGEX = /^#\d+\.\s*/;

export default class KomikNextGOnline extends HttpSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

  // ======================== Popular ========================
  protected popularMangaRequest(page: number): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (page > 1) url.addQueryParameter("comics_paged", String(page));
    return GET(url.build(), this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select("#left-content ul#comic-list li.comic").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("a.next.page-numbers") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const m = SManga.create();
    const titleElement = element.selectFirst(".comic-title, .entry-title")!;
    m.title = titleElement.text().replace(TITLE_PREFIX_REGEX, "");
    m.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
    m.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
    return m;
  }

  // ======================== Latest ========================
  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("Unsupported operation");
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("Unsupported operation");
  }

  // ======================== Search ========================
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    let url;
    if (isNotBlank(query)) {
      const b = toHttpUrl(this.baseUrl).newBuilder();
      if (page > 1) {
        b.addPathSegment("page");
        b.addPathSegment(String(page));
      }
      b.addQueryParameter("s", query);
      url = b.build();
    } else {
      const filter = firstInstanceOrNull(filters, UriPartFilter);
      const filterUrl = filter != null && filter.state !== 0 ? toHttpUrl(`${this.baseUrl}/${filter.toUriPart()}`).newBuilder() : toHttpUrl(this.baseUrl).newBuilder();

      if (page > 1) filterUrl.addQueryParameter("comics_paged", String(page));
      url = filterUrl.build();
    }

    return GET(url, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select("#left-content ul#comic-list li.comic, #left-content article.comic").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("a.next.page-numbers") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  // ======================== Details ========================
  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();

    const m = SManga.create();
    m.title = document.selectFirst("h1.entry-title")!.text();
    m.author = document.selectFirst("span.byline")?.text()?.replaceAll("by ", "");
    m.description = document.selectFirst("article.post")?.text();
    m.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: the SDK's SManga has no update strategy
    m.thumbnail_url = document.selectFirst('meta[property="og:image"]')?.attr("abs:content");
    return m;
  }

  // ======================== Chapters ========================
  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();

    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(document.selectFirst('meta[property="og:url"]')!.attr("abs:content"));
    chapter.name = "Chapter 1";
    const posted = document.selectFirst("span.posted-on a")?.text();
    chapter.date_upload = posted != null ? this.dateFormat.tryParseDate(posted.replaceAll("Posted on ", "")) : 0;

    return [chapter];
  }

  // ======================== Pages ========================
  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();

    return document.select("div#spliced-comic img").map((element, i) => new Page(i, "", element.attr("abs:src")));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("Unsupported operation");
  }

  // ============================== Filters ===============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Filter akan diabaikan jika ada pencarian teks"), new CategoryFilter());
  }
}
