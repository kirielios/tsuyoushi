// Port of keiyoushi/extensions-source src/en/hentaikun/HentaiKun.kt (+ Filters.kt)
import {
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  DateTimeFormatter,
  Locale,
  firstInstanceOrNull,
  isBlank,
  parseAs,
  parseHtml,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
} from "../../../sdk/index.ts";

// ---- Filters.kt
class UriPartFilter extends Filter.Select<string> {
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
class SearchTypeFilter extends UriPartFilter {
  constructor() {
    super("Search by", [
      ["Title", "title"],
      ["Artist", "artist"],
      ["Category", "category"],
      ["Translator", "translator"],
    ]);
  }
}

const chapterNumberRegex = /(\d+(?:\.\d+)?)/;
const dateFormat = DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ROOT);
const closest = (el: Element, tag: string): Element | null => {
  for (let e: Element | null = el; e; e = e.parent()) if (e.is(tag)) return e;
  return null;
};

export default class HentaiKun extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    // addNetworkInterceptor upstream: the request already carries the jar's cookies (see sdk HttpClient)
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const pathSegments = HttpUrl.parse(request.url).pathSegments;
      if (pathSegments[0] !== "manga" || pathSegments.length < 4) return chain.proceed(request);

      // Reading type:
      // - One page (1)
      // - All page (2)
      const chapterKey = `${pathSegments[2]}/${pathSegments[3]}`;
      const cookies = [...(request.headers.get("Cookie")?.split("; ").filter((it) => !it.startsWith(`${chapterKey}=`)) ?? []), `${chapterKey}=2`];

      const headers = new Headers(request.headers);
      headers.set("Cookie", cookies.join("; "));
      return chain.proceed({ ...request, headers });
    });
  }

  // =============================== Popular ================================
  async getPopularManga(page: number): Promise<MangasPage> {
    const pageStr = page > 1 ? `${page}/` : "";
    const document = (await this.client.get(`${this.baseUrl}/manga/manga-list/most-viewed/${pageStr}`)).asJsoup();
    return new MangasPage(this.parseTableListing(document), document.selectFirst("ul.pagination li[aria-label=Next]") != null);
  }

  // =============================== Latest =================================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const pageStr = page > 1 ? `${page}/` : "";
    const document = (await this.client.get(`${this.baseUrl}/manga/manga-list/last-updated/${pageStr}`)).asJsoup();
    return new MangasPage(this.parseTableListing(document), document.selectFirst("ul.pagination li[aria-label=Next]") != null);
  }

  // =============================== Search =================================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const pageStr = page > 1 ? `${page}/` : "";
    const searchType = firstInstanceOrNull(filters, SearchTypeFilter)?.toUriPart() ?? "title";

    if (isBlank(query)) return this.getPopularManga(page);
    const document = (await this.client.get(`${this.baseUrl}/manga/search/${searchType}/${query.trim()}/${pageStr}`)).asJsoup();
    const hasNextPage = document.selectFirst("ul.pagination li[aria-label=Next]") != null;

    const mangas = document.selectFirst("table.table-striped") != null ? this.parseTableListing(document) : this.parseGalleryListing(document);
    return new MangasPage(mangas, hasNextPage);
  }

  // ========================= Manga Details ================================
  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    const title = document.selectFirst("div.single_title h1")?.text();
    if (title === undefined) throw new Error("Title not found");
    manga.title = title;

    manga.thumbnail_url = document.selectFirst("meta[property='og:image']")?.absUrl("content");

    manga.author = document.select("h2:has(strong:contains(Artist)) a").map((it) => it.text()).join(", ") || undefined;

    const category = document.selectFirst("h2:has(strong:contains(Category)) a")?.text();
    const tags = document.select("div.desc a[href*='/tag/'] span.label-danger").map((it) => it.text());
    manga.genre = [...(category != null ? [category] : []), ...tags].join(", ") || undefined;

    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE has no counterpart in our SManga
    manga.initialized = true;
    return manga;
  }

  // ========================= Chapter List =================================
  private parseChapterList(document: Document): SChapter[] {
    return document.select("table a.readchap").map((anchor) => {
      const chapter = SChapter.create();
      chapter.name = anchor.text() || "Chapter";
      chapter.url = urlWithoutDomain(anchor.absUrl("href"));
      const row = closest(anchor, "tr");
      const dateText = row?.selectFirst("td:last-child h6")?.text();
      chapter.date_upload = dateFormat.tryParseDate(dateText);
      const m = chapterNumberRegex.exec(chapter.name);
      const n = m ? Number.parseFloat(m[1]) : Number.NaN;
      chapter.chapter_number = Number.isNaN(n) ? 1 : n;
      return chapter;
    });
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  // ========================= Page List ====================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();

    const script = document.select("script").find((it) => it.data().includes("var jsondata="));
    if (!script) throw new Error("Could not find any images for this chapter.");
    const jsonData = substringBefore(substringAfter(script.data(), "var jsondata="), ";");

    return parseAs<string[]>(jsonData).map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // ========================= Filters =====================================
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SearchTypeFilter());
  }

  // ========================= Helpers =====================================
  private parseTableListing(document: Document): SManga[] {
    const out: SManga[] = [];
    for (const row of document.select("table.table-striped tr:not(.danger)")) {
      const anchor = row.selectFirst("td:first-child a");
      if (!anchor) continue;
      const manga = SManga.create();
      manga.title = anchor.text();
      manga.url = urlWithoutDomain(anchor.absUrl("href"));
      manga.thumbnail_url = parseHtml(this.host.load, anchor.attr("title"), this.baseUrl).selectFirst("img")?.absUrl("src");
      out.push(manga);
    }
    return out;
  }

  private parseGalleryListing(document: Document): SManga[] {
    const out: SManga[] = [];
    for (const div of document.select("div.thumbnail[id^='galary-']")) {
      const overlayAnchor = div.selectFirst("div.overlay a");
      if (!overlayAnchor) continue;
      const manga = SManga.create();
      manga.title = overlayAnchor.text();
      manga.url = urlWithoutDomain(overlayAnchor.absUrl("href"));
      manga.thumbnail_url = div.selectFirst("img.img-responsive")?.absUrl("src");
      out.push(manga);
    }
    return out;
  }
}
