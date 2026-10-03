// Port of keiyoushi/extensions-source src/en/mangafreak/Mangafreak.kt (+ Filters.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneOffset,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type FilterList as FilterListType,
} from "../../../sdk/index.ts";

// --- Filters.kt
class Genre extends Filter.TriState {}
class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}
const getGenreList = () =>
  [
    "Act", "Adult", "Adventure", "Ancients", "Animated", "Comedy", "Demons", "Drama", "Ecchi", "Fantasy", "Gender Bender", "Harem",
    "Horror", "Josei", "Magic", "Martial Arts", "Mature", "Mecha", "Military", "Mystery", "One Shot", "Psychological", "Romance",
    "School Life", "Sci Fi", "Seinen", "Shoujo", "Shoujoai", "Shounen", "Shounenai", "Slice Of Life", "Smut", "Sports", "Super Power",
    "Supernatural", "Tragedy", "Vampire", "Yaoi", "Yuri",
  ].map((n) => new Genre(n));

class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}
class TypeFilter extends UriPartFilter {
  constructor() {
    super("Manga Type", [
      ["Both", "0"],
      ["Manga", "2"],
      ["Manhwa", "1"],
    ]);
  }
}
class StatusFilter extends UriPartFilter {
  constructor() {
    super("Manga Status", [
      ["Both", "0"],
      ["Completed", "1"],
      ["Ongoing", "2"],
    ]);
  }
}

// --- Mangafreak.kt
export default class Mangafreak extends KeiSource {
  private readonly floatLetterPattern = /(\d+)(\.\d+|[a-i]+\b)?/;

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy/M/d", Locale.ROOT);

  protected override configureClient(builder: ClientBuilder) {
    return builder.connectTimeout(60_000).readTimeout(60_000);
  }

  private mangaFromElement(element: Element, urlSelector: string): SManga {
    const manga = SManga.create();
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    const a = element.selectFirst(urlSelector)!;
    manga.title = a.text();
    manga.url = urlWithoutDomain(a.absUrl("href"));
    return manga;
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/Genre/All/${page}`)).asJsoup();
    const mangas = document.select("div.ranking_item").map((it) => this.mangaFromElement(it, "a"));
    const hasNextPage = document.select("a.next_p").length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = page === 1 ? this.baseUrl : `${this.baseUrl}/Latest_Releases/${page}`;
    const document = (await this.client.get(url)).asJsoup();
    const mangas = document.select("div.latest_item, div.latest_releases_item").map((element) => {
      const manga = SManga.create();
      const src = element.selectFirst("img")?.absUrl("src");
      manga.thumbnail_url = src == null ? undefined : this.miniToFull(src);

      const a = element.hasClass("latest_item") ? element.selectFirst("a.name")! : element.selectFirst("a")!;
      manga.title = a.text();
      manga.url = urlWithoutDomain(a.absUrl("href"));
      return manga;
    });
    const hasNextPage = document.select("a.next_p").length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  private miniToFull(it: string): string {
    const url = toHttpUrlOrNull(it);
    const segments = url?.toURL().pathname.split("/").slice(1);
    if (url != null && segments && segments[0] === "mini_images" && segments.length >= 2) {
      const slug = segments[1];
      return url.newBuilder().encodedPath("/").addPathSegment("manga_images").addPathSegment(`${slug}.jpg`).build().toString();
    }
    return it;
  }

  // ============================== Search ===============================

  async getSearchMangaList(_page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl)!.newBuilder();

    if (query.trim()) url.addPathSegments(`Find/${query}`);

    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        const genres = filter.state
          .map((it) => {
            switch (it.state) {
              case Filter.TriState.STATE_IGNORE:
                return "0";
              case Filter.TriState.STATE_INCLUDE:
                return "1";
              case Filter.TriState.STATE_EXCLUDE:
                return "2";
              default:
                return "0";
            }
          })
          .join("");
        url.addPathSegments(`Genre/${genres}`);
      } else if (filter instanceof StatusFilter) url.addPathSegments(`Status/${filter.toUriPart()}`);
      else if (filter instanceof TypeFilter) url.addPathSegments(`Type/${filter.toUriPart()}`);
    }

    const document = (await this.client.get(url.build().toString())).asJsoup();
    const mangas = document.select("div.manga_search_item , div.mangaka_search_item").map((it) => this.mangaFromElement(it, "h3 a, h5 a"));
    return new MangasPage(mangas, false);
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.thumbnail_url = document.selectFirst("div.manga_series_image img")?.absUrl("src");
    details.title = document.select("div.manga_series_data h5").text();
    switch (document.select("div.manga_series_data > div:eq(2)").text().toLowerCase()) {
      case "on-going":
      case "ongoing":
        details.status = SManga.ONGOING;
        break;
      case "completed":
        details.status = SManga.COMPLETED;
        break;
      default:
        details.status = SManga.UNKNOWN;
    }
    details.author = document.select("div.manga_series_data > div:eq(3)").text();
    details.artist = document.select("div.manga_series_data > div:eq(4)").text();
    details.genre = document.select("div.series_sub_genre_list a").map((it) => it.text()).join(", ");
    details.description = document.select("div.manga_series_description p").text();

    const chapterList = document
      .select("div.manga_series_list tr:has(a)")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.name = element.select("td:eq(0)").text();

        const match = this.floatLetterPattern.exec(chapter.name);
        if (match == null) {
          chapter.chapter_number = -1;
        } else {
          const g2 = match[2] ?? "";
          if (g2.length === 0 || g2[0] === ".") {
            chapter.chapter_number = Number.parseFloat(match[0]);
          } else {
            let p2 = "0.";
            for (const x of g2) p2 += x.charCodeAt(0) - "a".charCodeAt(0) + 1;
            chapter.chapter_number = Number.parseFloat(match[1]) + Number.parseFloat(p2);
          }
        }

        chapter.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
        chapter.date_upload = this.dateFormat.tryParseDate(element.select("td:eq(1)").text(), ZoneOffset.UTC);
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(details, chapterList);
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("img#gohere[src]").map((element, index) => new Page(index, "", element.absUrl("src")));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new Filter.Header("Filters do not work if search bar is empty"), new GenreFilter(getGenreList()), new TypeFilter(), new StatusFilter());
  }
}
