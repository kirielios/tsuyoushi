// Port of keiyoushi/extensions-source src/en/mangapill/MangaPill.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type Element } from "../../../sdk/index.ts";
import { GenreList, Status, Type, getGenreList } from "./filters.ts";

export default class MangaPill extends KeiSource {
  // Popular fetches the homepage where the "Trending Mangas" section is
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/`)).asJsoup();
    const mangas = document.select("div:has(h4:contains(Trending)) > .grid > div:not([class])").map((element) => this.latestUpdatesFromElement(element));
    return new MangasPage(mangas, false);
  }

  // Latest fetches the /chapters url
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/chapters`)).asJsoup();
    const mangas = document.select(".grid > div:not([class])").map((element) => this.latestUpdatesFromElement(element));
    return new MangasPage(mangas, false);
  }

  private latestUpdatesFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.thumbnail_url = element.selectFirst("img")!.attr("data-src");
    manga.url = urlWithoutDomain(element.selectFirst("a[href^='/manga/']")!.absUrl("href"));
    manga.title = element.selectFirst("div.line-clamp-2")!.text();
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.title = manga.title;
    details.author = "";
    details.artist = "";
    const genres: string[] = [];
    document.select("a[href*=genre]").forEach((element) => genres.push(element.text()));
    details.genre = genres.join(", ");
    details.status = this.parseStatus(document.select("div.container > div:first-child > div:last-child > div:nth-child(3) > div:nth-child(2) > div").text());
    details.description = document.select("div.container > div:first-child > div:last-child > div:nth-child(2) > p").text();
    details.thumbnail_url = document.select("div.container > div:first-child > div:first-child > img").first()!.attr("data-src");

    const chapterList = document.select("#chapters > div > a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = element.text();
      chapter.date_upload = 0;
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  private parseStatus(element: string): number {
    const s = element.toLowerCase();
    if (s.includes("publishing")) return SManga.ONGOING;
    if (s.includes("finished")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("picture img").map((it, i) => new Page(i, "", it.attr("data-src")));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.append("page", String(page));
    url.searchParams.append("q", query);

    for (const filter of filters) {
      if (filter instanceof GenreList) {
        const genreInclude: string[] = [];
        filter.state.forEach((it) => {
          if (it.state === 1) genreInclude.push(it.id);
        });
        genreInclude.forEach((genre) => url.searchParams.append("genre", genre));
      } else if (filter instanceof Status) url.searchParams.append("status", filter.toUriPart());
      else if (filter instanceof Type) url.searchParams.append("type", filter.toUriPart());
    }

    const document = (await this.client.get(url)).asJsoup();
    const mangas = document.select(".grid > div:not([class])").map((element) => this.latestUpdatesFromElement(element));
    const hasNextPage = document.selectFirst("a.btn.btn-sm") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator(), new Status(), new Type(), new GenreList(getGenreList()));
  }
}
