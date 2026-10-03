// Port of keiyoushi/extensions-source src/en/heytoon/HeyToon.kt (+ Filters.kt)
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
  firstInstance,
  firstInstanceOrNull,
  urlWithoutDomain,
} from "../../../sdk/index.ts";

// ---- Filters.kt
const sortBy: [string, string][] = [
  ["Most Recent", "latest"],
  ["Most Viewed", "views"],
];
class SortFilter extends Filter.Select<string> {
  constructor(state = 0) {
    super(
      "Sort",
      sortBy.map((it) => it[0]),
      state,
    );
  }
  get sort() {
    return sortBy[this.state][1];
  }
  static get popular() {
    return FilterList(new SortFilter(1));
  }
  static get latest() {
    return FilterList(new SortFilter(0));
  }
}

const genres = ["All", "Detective", "Spin-Off", "Mommy", "Uncensored", "New", "In-Law", "Cheating", "MILF", "Harem", "College", "Business", "Supernatural", "Thriller", "Adventure", "Romance", "Drama"];
class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genres", genres);
  }
  get selected(): string | undefined {
    return this.state !== 0 ? genres[this.state] : undefined;
  }
}

interface Comic {
  linkComic: string;
  title: string;
  raw_thumb?: string | null;
}

const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

export default class HeyToon extends KeiSource {
  async getPopularManga(page: number): Promise<MangasPage> {
    if (page !== 1) return this.getSearchMangaList(page - 1, "", SortFilter.popular);

    const document = (await this.client.get(this.baseUrl)).asJsoup();

    const entries = document.select("section[class*=slider]:has(h2:matches((?i)popular|trending)) a").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.absUrl("href"));
      manga.title = element.text();
      manga.thumbnail_url = element.selectFirst("img[alt!=badge]")?.absUrl("data-src");
      return manga;
    });

    return new MangasPage(entries, true);
  }

  getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.latest);
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Doesn't work with text search"), new Filter.Separator(), new SortFilter(), new GenreFilter());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.length > 0) return this.querySearch(query);

    const b = HttpUrl.parse(`${this.baseUrl}/en/genres`).newBuilder();
    const genre = firstInstanceOrNull(filters, GenreFilter)?.selected;
    if (genre !== undefined) b.addPathSegment(genre);
    b.addQueryParameter("orderBy", firstInstance(filters, SortFilter).sort);
    if (page > 1) b.addQueryParameter("page", String(page));
    const url = b.build();

    const document = (await this.client.get(url.toString())).asJsoup();

    const entries = document.select("div[class*=comicItem] a").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.absUrl("href"));
      const img = element.selectFirst("img[alt!=badge]")!;
      manga.title = img.attr("title");
      manga.thumbnail_url = img.absUrl("data-src");
      return manga;
    });

    const hasNextPage = document.selectFirst(".wp-pagenavi .nextpostslink") != null;
    return new MangasPage(entries, hasNextPage);
  }

  private async querySearch(query: string): Promise<MangasPage> {
    const url = HttpUrl.parse(`${this.baseUrl}/api/complete-search`).newBuilder().addQueryParameter("keyword", query).build();
    const ajaxHeaders = this.headersBuilder();
    ajaxHeaders.set("X-Requested-With", "XMLHttpRequest");

    const data = (await this.client.get(url.toString(), ajaxHeaders)).parseAs<Comic[]>();
    const entries = data.map((comic) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(comic.linkComic);
      manga.title = comic.title;
      manga.thumbnail_url = comic.raw_thumb ?? undefined;
      return manga;
    });
    return new MangasPage(entries, false);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.title = document.selectFirst("#titleSubWrapper h1.titCon")!.text();
    details.description = document.selectFirst("#modal_detail .cont_area p")?.text();
    details.genre = document.select("#modal_detail a[href*=genres]").eachText().join(", ");
    details.thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content");
    const badges = document.select(".badgeArea span").eachText();
    details.status = badges.includes("Up") ? SManga.ONGOING : badges.includes("Completed") ? SManga.COMPLETED : SManga.UNKNOWN;

    const chapterList = document
      .select(".episodeListConPC a#episodeItemCon")
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(it.absUrl("href"));
        chapter.name = it.selectFirst(".comicInfo p.episodeStitle")!.text();
        chapter.date_upload = dateFormat.tryParseDate(it.selectFirst(".comicInfo .episodeDate")?.text());
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(details, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#comicContent img").map((img, index) => new Page(index, "", img.absUrl("src")));
  }
}
