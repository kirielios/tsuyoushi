// Port of keiyoushi/extensions-source src/en/manhwalike/Manhwalike.kt (+ ManhwalikeHelper.kt, Filters.kt)
import { DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneId, toHttpUrl, urlWithoutDomain, type ClientBuilder, type Element, type Response } from "../../../sdk/index.ts";

// --- ManhwalikeHelper.kt
const dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);
const dateZone = ZoneId.of("America/New_York");

function toStatus(s: string | null | undefined): number {
  if (s == null) return SManga.UNKNOWN;
  if (s.toLowerCase().includes("ongoing")) return SManga.ONGOING;
  if (s.toLowerCase().includes("finish")) return SManga.COMPLETED;
  return SManga.UNKNOWN;
}

const toDate = (s: string | null | undefined): number => dateFormat.tryParseDate(s, dateZone);

const toOriginal = (e: Element): string => (e.hasAttr("data-original") ? e.absUrl("data-original") : e.absUrl("src"));

// --- Filters.kt
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

const genre = (name: string, slug = name.toLowerCase().replaceAll(" ", "-")): [string, string] => [name, `manga-genre-${slug}`];

class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      genre("Action"),
      genre("Adaptation"),
      genre("Adult"),
      genre("Adventure"),
      genre("Boy love"),
      genre("Comedy"),
      genre("Comic"),
      genre("Cooking"),
      genre("Crime"),
      genre("Doujinshi"),
      genre("Drama"),
      genre("Ecchi"),
      genre("Fantasy"),
      genre("Full Color"),
      genre("Game"),
      genre("Gender Bender"),
      genre("Harem"),
      genre("Historical"),
      genre("Horror"),
      genre("Isekai"),
      genre("Josei"),
      genre("Magic"),
      genre("Manga"),
      genre("Manhua"),
      genre("Manhwa"),
      genre("Martial Arts"),
      genre("Mature"),
      genre("Mecha"),
      genre("Medical"),
      genre("Mystery"),
      genre("NTR"),
      genre("Oneshot"),
      genre("Psychological"),
      genre("Reincarnation"),
      genre("Romance"),
      genre("School life"),
      genre("Sci-fi"),
      genre("Seinen"),
      genre("Shoujo"),
      genre("Shoujo ai"),
      genre("Shounen"),
      genre("Shounen ai"),
      genre("Slice Of Life"),
      genre("Smut"),
      genre("Soft Yaoi"),
      genre("Soft Yuri"),
      genre("Sports"),
      genre("Super Power"),
      genre("Supernatural"),
      genre("SURVIVAL"),
      genre("Time travel"),
      genre("Tragedy"),
      genre("Villainess"),
      genre("Webtoon"),
      genre("Webtoons"),
      genre("Yaoi"),
    ]);
  }
}

export default class Manhwalike extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2, 1000, (url) => url.hostname === toHttpUrl(this.baseUrl).host);
  }

  private mangaFromVisual(element: Element): SManga {
    const manga = SManga.create();
    const t = element.selectFirst("h3.title a")?.text();
    if (t != null) manga.title = t;
    const href = element.selectFirst("a")?.absUrl("href");
    if (href != null) manga.url = urlWithoutDomain(href);
    const img = element.selectFirst("img");
    manga.thumbnail_url = img ? toOriginal(img) : undefined;
    return manga;
  }

  // popular
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    return new MangasPage(
      document.select("ul.list-hot div.visual").map((e) => this.mangaFromVisual(e)),
      false,
    );
  }

  // latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    return new MangasPage(
      document.select("ul.slick_item div.visual").map((e) => this.mangaFromVisual(e)),
      false,
    );
  }

  // search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let response: Response;
    if (query.length > 0) {
      const requestBody = new URLSearchParams({ keyword: query });
      // buildApiHeaders: Content-Length/Content-Type are set by the transport from the body
      const requestHeaders = new Headers(this.headers);
      requestHeaders.append("Content-Type", "application/x-www-form-urlencoded");
      requestHeaders.append("Accept", "text/html");
      requestHeaders.append("X-Requested-With", "XMLHttpRequest");
      response = await this.client.post(`${this.baseUrl}/search/html/1`, requestHeaders, requestBody);
    } else {
      const url = toHttpUrl(this.baseUrl).newBuilder();
      for (const filter of filters) {
        if (filter instanceof GenreFilter) url.addPathSegment(filter.toUriPart());
      }
      url.addQueryParameter("page", String(page));
      response = await this.client.get(url.build().toString());
    }

    const document = response.asJsoup();
    const mangas = document.select("ul.normal li").isEmpty() ? document.select("ul li").map((e) => this.searchMangaFromElement(e)) : document.select("ul.normal li").map((e) => this.searchMangaFromElement(e));
    const hasNextPage = document.selectFirst("ul.pagination li:last-child a") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const t = element.selectFirst("img")?.attr("alt");
    if (t != null) manga.title = t;
    const img = element.selectFirst("img");
    if (img) manga.thumbnail_url = toOriginal(img);
    const href = element.selectFirst("a")?.absUrl("href");
    if (href != null) manga.url = urlWithoutDomain(href);
    return manga;
  }

  // details + chapters
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    manga.author = document.selectFirst("div.author a")?.text();
    manga.status = toStatus(document.selectFirst("small:contains(Status) + strong")?.text());
    manga.genre = document
      .select("div.categories a")
      .map((it) => it.text())
      .join(", ");
    manga.description = document.selectFirst("div.summary-block p.about")?.text();
    manga.thumbnail_url = document.selectFirst("div.fixed-img img")?.absUrl("src");

    const chapterList = document.select("ul.chapter-list li").map((element) => {
      const chapter = SChapter.create();
      const a = element.selectFirst("a");
      if (a) {
        chapter.url = urlWithoutDomain(a.absUrl("href"));
        chapter.name = a.text();
      }
      chapter.date_upload = toDate(element.selectFirst(".time")?.text());
      return chapter;
    });

    return new SMangaUpdate(manga, chapterList);
  }

  // pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".chapter-content .page-chapter img").map((img, i) => new Page(i, "", img.absUrl("src")));
  }

  // filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator(), new GenreFilter());
  }
}
