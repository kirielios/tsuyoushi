// Port of keiyoushi/extensions-source src/en/vyvymanga/VyvyManga.kt (+ Filters.kt)
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneOffset, md5, toHex, toHttpUrl, urlWithoutDomain, utf8, type Response } from "../../../sdk/index.ts";
import { AuthorFilter, AuthorSearchType, Genre, GenreFilter, SearchDescription, SearchType, SortFilter, SortType, StatusFilter, type GenreData } from "./filters.ts";

export default class VyvyManga extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyy", Locale.US);
  private readonly relativeDateRegex = /(\d+)/;

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = `${this.baseUrl}/search${page !== 1 ? `?page=${page}` : ""}`;
    return this.parseMangasPage(await this.client.get(url));
  }

  private parseMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".comic-item").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      manga.title = element.selectFirst(".comic-title")!.text();
      manga.thumbnail_url = element.selectFirst(".comic-image img.image.lozad")?.absUrl("data-src");
      return manga;
    });
    const hasNextPage = document.selectFirst("[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = `${this.baseUrl}/search?sort=updated_at${page !== 1 ? `&page=${page}` : ""}`;
    return this.parseMangasPage(await this.client.get(url));
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("q", query).addQueryParameter("page", String(page));

    for (const filter of filters) {
      if (filter instanceof SearchType) url.addQueryParameter("search_po", filter.selected);
      else if (filter instanceof SearchDescription) {
        if (filter.state) url.addQueryParameter("check_search_desc", "1");
      } else if (filter instanceof AuthorSearchType) url.addQueryParameter("author_po", filter.selected);
      else if (filter instanceof AuthorFilter) url.addQueryParameter("author", filter.state);
      else if (filter instanceof StatusFilter) url.addQueryParameter("completed", filter.selected);
      else if (filter instanceof SortFilter) url.addQueryParameter("sort", filter.selected);
      else if (filter instanceof SortType) url.addQueryParameter("sort_type", filter.selected);
      else if (filter instanceof GenreFilter) {
        for (const it of filter.state) {
          if (!it.isIgnored()) url.addQueryParameter(it.isIncluded() ? "genre[]" : "exclude_genre[]", it.id);
        }
      }
    }

    return this.parseMangasPage(await this.client.get(url.build().toString()));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== toHttpUrl(this.baseUrl).host || segments.length < 2) return null;

    const mangaUrl = `/manga/${segments[1]}`;
    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  // Updates
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const details = SManga.create();
    details.title = document.selectFirst("h1")!.text();
    details.artist = document.selectFirst(".pre-title:contains(Artist) ~ a")?.text();
    details.author = document.selectFirst(".pre-title:contains(Author) ~ a")?.text();
    details.description = document.selectFirst(".summary > .content")?.text();
    details.genre = document.select(".pre-title:contains(Genres) ~ a").map((it) => it.text()).join(", ");
    switch (document.selectFirst(".pre-title:contains(Status) ~ span:not(.space)")?.text()) {
      case "Ongoing":
        details.status = SManga.ONGOING;
        break;
      case "Completed":
        details.status = SManga.COMPLETED;
        break;
      default:
        details.status = SManga.UNKNOWN;
    }
    details.thumbnail_url = document.selectFirst(".img-manga img")?.absUrl("src");

    const updatedChapters = document.select(".list-group > a").map((element) => {
      const chapter = SChapter.create();
      // selectFirst("> p"): a direct child
      const chapterDate = this.parseChapterDate(element.children().find((it) => it.tagName() === "p")?.text());
      const title = element.selectFirst("span")!.text();
      // Avoid the dynamic URLs
      chapter.url = toHex(md5(utf8(`${chapterDate}:${title}`))).slice(-10);
      chapter.name = title;
      chapter.date_upload = chapterDate;
      chapter.memo = { chapterUrl: element.absUrl("href") };
      return chapter;
    });

    return new SMangaUpdate(details, updatedChapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    const memo = chapter.memo["chapterUrl"];
    if (typeof memo === "string") return memo;
    return chapter.url.startsWith("http") ? chapter.url : this.baseUrl + chapter.url;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    let url = chapter.memo["chapterUrl"] as string | undefined;
    if (typeof url !== "string") {
      if (!chapter.url.startsWith("http")) throw new Error("Refresh to reload chapters");
      url = chapter.url;
    }

    const document = (await this.client.get(url)).asJsoup();
    return document.select("img.d-block").map((element, index) => new Page(index, "", element.absUrl("data-src")));
  }

  // Date parsing
  private parseChapterDate(date: string | null | undefined): number {
    if (date == null) return 0;
    return date.endsWith("ago") ? this.parseRelativeDate(date) : this.dateFormat.tryParseDate(date, ZoneOffset.UTC);
  }

  private parseRelativeDate(date: string): number {
    const m = this.relativeDateRegex.exec(date)?.[0];
    if (m === undefined) return 0;
    const number = Number.parseInt(m, 10);
    const now = Date.now();

    if (date.includes("day")) return now - number * 86_400_000;
    if (date.includes("hour")) return now - number * 3_600_000;
    if (date.includes("minute")) return now - number * 60_000;
    if (date.includes("second")) return now - number * 1000;
    return 0;
  }

  // Filters
  override get supportsFilterFetching(): boolean {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/search`)).asJsoup();

    return document.select(".check-genre div div:has(.checkbox-genre)").map((it): GenreData => ({
      name: it.select("label").text(),
      id: it.select(".checkbox-genre").attr("data-value"),
    }));
  }

  getFilterList(data: unknown = null): FilterList {
    const genres = (data as GenreData[] | null)?.map((it) => new Genre(it.name, it.id)) ?? [];

    const filterList = [new SearchType(), new SearchDescription(), new AuthorSearchType(), new AuthorFilter(), new StatusFilter(), new SortFilter(), new SortType()] as FilterList;
    if (genres.length > 0) filterList.push(new GenreFilter(genres));
    return filterList;
  }
}
