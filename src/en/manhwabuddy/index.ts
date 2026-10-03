// Port of keiyoushi/extensions-source src/en/manhwabuddy/ManhwaBuddy.kt (+ Filters.kt)
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
  firstInstanceOrNull,
  urlWithoutDomain,
} from "../../../sdk/index.ts";

// ---- Filters.kt
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

class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genres", [
      ["Action", "action"],
      ["Romance", "romance"],
      ["Drama", "drama"],
      ["Martial Arts", "martial-arts"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Harem", "harem"],
      ["Historical", "historical"],
      ["Mature", "mature"],
      ["Mystery", "mystery"],
      ["Psychological", "psychological"],
      ["School Life", "school-life"],
      ["Smut", "smut"],
      ["Isekai", "isekai"],
      ["Thriller", "thriller"],
      ["Crime", "crime"],
      ["Sci-Fi", "sci-fi"],
      ["Horror", "horror"],
      ["Mecha", "mecha"],
      ["Medical", "medical"],
      ["Sports", "sports"],
    ]);
  }
}

const dateFormat = DateTimeFormatter.ofPattern("d [MMMM][MMM] yyyy", Locale.ENGLISH);

export default class ManhwaBuddy extends KeiSource {
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const mangas = document.select(".item-move").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
      manga.title = element.selectFirst("h3")!.text();
      manga.thumbnail_url = element.selectFirst("img")?.attr("src");
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/page/${page}`)).asJsoup();
    const hasNextPage = document.selectFirst(".next") != null;
    const mangas = document.select(".latest-list .latest-item").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
      manga.title = element.selectFirst("h4")!.text();
      manga.thumbnail_url = element.selectFirst("img")?.attr("src");
      return manga;
    });
    return new MangasPage(mangas, hasNextPage);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: HttpUrl;
    if (query.length > 0) {
      url = HttpUrl.parse(this.baseUrl).newBuilder().addPathSegment("search").addQueryParameter("s", query).addQueryParameter("page", String(page)).build();
    } else {
      const genre = firstInstanceOrNull(filters, GenreFilter)?.toUriPart() ?? "";
      url = HttpUrl.parse(this.baseUrl).newBuilder().addPathSegment("genre").addPathSegment(genre).addPathSegment("page").addPathSegment(String(page)).build();
    }

    const document = (await this.client.get(url.toString())).asJsoup();
    const hasNextPage = document.selectFirst(".next") != null;
    const mangas = document.select(".latest-list .latest-item").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
      manga.title = element.selectFirst("a")!.attr("title");
      manga.thumbnail_url = element.selectFirst("img")?.attr("src");
      return manga;
    });
    return new MangasPage(mangas, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.url = manga.url;
    details.title = manga.title;
    const info = document.selectFirst(".main-info-right")!;
    details.author = info.selectFirst("li:contains(Author) a")?.text();
    const status = info.selectFirst("li:contains(Status) span")?.text();
    details.status = status === "Ongoing" ? SManga.ONGOING : status === "Complete" ? SManga.COMPLETED : SManga.UNKNOWN;
    details.artist = info.selectFirst("li:contains(Artist) a")?.text();
    details.genre = info.select("li:contains(Genres) a").map((it) => it.text()).join(", ");
    details.description = document.select(".short-desc-content p").map((it) => it.text()).join("\n");

    const chapterList = document.select(".chapter-list a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("abs:href"));
      chapter.name = element.selectFirst(".chapter-name")!.text();
      chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".ct-update")?.text());
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".loading").map((element, i) => new Page(i, "", element.attr("abs:src")));
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Filter does not work with text search, reset it before filter"), new Filter.Separator(), new GenreFilter());
  }
}
