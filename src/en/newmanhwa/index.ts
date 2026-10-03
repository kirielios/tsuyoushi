// Port of keiyoushi/extensions-source src/en/newmanhwa/NewManhwa.kt
import { FilterList, HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfterLast, tryParseInstant, urlWithoutDomain, type Document } from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, getGenreList } from "./filters.ts";

const MIRROR_HOSTS = "saymanhwa.com";
const GENRE_REGEX = /"genre":\s*\[(.*?)\]/;
const TITLE_RANK_REGEX = /^#\d+\s+/;
const TAGS_MARKER_REGEX = /\s*\bTags\b\s*/;

export default class NewManhwa extends KeiSource {
  override get supportsFilterFetching(): boolean {
    return true;
  }

  // ========================= Popular =========================
  async getPopularManga(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/popular?page=${page}`);
    return this.parseMangaList(response.asJsoup());
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select("article.series-card").map((element) => {
      const manga = SManga.create();
      const coverLink = element.selectFirst("a.series-card-cover")!;
      manga.url = urlWithoutDomain(coverLink.absUrl("href"));
      manga.title = this.removeTitleRank(element.selectFirst("div.series-card-body h2 a")!.text());
      const img = coverLink.selectFirst("img");
      if (img != null) {
        const dataSrc = img.absUrl("data-src");
        manga.thumbnail_url = dataSrc === "" ? img.absUrl("src") : dataSrc;
      }
      return manga;
    });
    const hasNextPage = document.selectFirst("a:contains(Next):not(.disabled)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ========================= Latest =========================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/latest?page=${page}`);
    return this.parseMangaList(response.asJsoup());
  }

  // ========================= Search =========================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const searchUrl = this.buildSearchMangaUrl(page, query, filters);
    const response = await this.client.get(searchUrl.toString());
    const document = response.asJsoup();

    if (document.selectFirst("aside.series-left") != null) {
      const manga = this.parseMangaDetails(document);
      manga.url = HttpUrl.parse(response.url).encodedPath;
      return new MangasPage([manga], false);
    }

    return this.parseMangaList(document);
  }

  private buildSearchMangaUrl(page: number, query: string, filters: FilterList): HttpUrl {
    const b = HttpUrl.parse(this.baseUrl).newBuilder();
    b.addPathSegment("series");
    b.addQueryParameter("q", query);
    for (const filter of filters) {
      if (filter instanceof StatusFilter) {
        // To Do: Completed uses en/completed but ongoing and hiatus isn't currently supported by the source.
        // Completed also doesn't work with Search queries as of now but wroks with genre baseurl/en/completed?q=&genre=comic
        if (filter.state > 0) b.addQueryParameter("status", filter.values[filter.state]);
      } else if (filter instanceof GenreFilter) {
        if (filter.state > 0) b.addQueryParameter("genre", filter.values[filter.state].value);
      } else if (filter instanceof SortFilter) {
        const sortValue = ["updated", "popular", "chapters", "newest", "az", "za"][filter.state] ?? "updated";
        b.addQueryParameter("sort", sortValue);
      }
    }
    if (page > 1) b.addQueryParameter("page", String(page));
    return b.build();
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== HttpUrl.parse(this.baseUrl).host && url.hostname !== MIRROR_HOSTS) return null;

    const newUrl = new URL(this.baseUrl);
    newUrl.pathname = url.pathname;
    newUrl.search = url.search;

    const response = await this.client.get(newUrl);

    const manga = this.parseMangaDetails(response.asJsoup());
    manga.url = urlWithoutDomain(newUrl.pathname);
    return manga;
  }

  // ========================= Details =========================
  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1")!.text();
    const desc = document.selectFirst("div.series-v72-description")?.text();
    if (desc != null) {
      const m = TAGS_MARKER_REGEX.exec(desc);
      manga.description = (m ? desc.slice(0, m.index) : desc).trim();
    }
    manga.author = this.metaValue(document, "Author");
    manga.artist = this.metaValue(document, "Artist");
    switch (this.metaValue(document, "Status")?.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    manga.thumbnail_url = document.selectFirst("aside.series-left .cover-card img")?.absUrl("src");

    const sidebarGenres = document.select("div.series-v72-genres a").eachText();
    if (sidebarGenres.length > 0) manga.genre = sidebarGenres.join(", ");
    else {
      // Fallback for pages where the sidebar genre list is missing/empty.
      const jsonLd = [...document.select("script[type=application/ld+json]")].find((it) => it.data().includes('"@type":"ComicSeries"'))?.data();

      if (jsonLd != null) {
        const genresString = GENRE_REGEX.exec(jsonLd)?.[1];
        if (genresString != null)
          manga.genre = genresString
            .replaceAll('"', "")
            .split(",")
            .map((g) => g.trim())
            .join(", ");
      }
    }
    return manga;
  }

  private metaValue(document: Document, label: string): string | undefined {
    return [...document.select("aside.series-v72-sidebar .series-v72-meta span")]
      .find((it) => it.text().toLowerCase() === label.toLowerCase())
      ?.parent()
      ?.selectFirst("strong")
      ?.text();
  }

  // ========================= Chapters =========================
  private parseChapterList(document: Document): SChapter[] {
    return document.select("div.series-v72-chapter-list a.series-v72-chapter-row").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = element.selectFirst(".series-chapter-number-text")!.text();
      const datetime = element.selectFirst("time.series-chapter-date")?.attr("datetime");
      chapter.date_upload = datetime != null ? tryParseInstant(datetime) : 0;
      return chapter;
    });
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.baseUrl + manga.url);
    const document = response.asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  // ========================= Pages =========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.baseUrl + chapter.url);
    return this.parsePageList(response.asJsoup());
  }

  private parsePageList(document: Document): Page[] {
    return document.select("div.reader-pages img").map((element, i) => {
      const dataSrc = element.absUrl("data-src");
      return new Page(i, "", dataSrc === "" ? element.absUrl("src") : dataSrc);
    });
  }

  // ========================= Filters =========================

  override async fetchFilterData(): Promise<unknown> {
    const response = await this.client.get(`${this.baseUrl}/en/genres`);
    const document = response.asJsoup();

    const genres = document.select("a.panel.genre-card").map((el) => ({
      name: el.selectFirst("strong")!.text(),
      slug: substringAfterLast(el.absUrl("href"), "/"),
    }));

    return { genres };
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = getGenreList(data);

    const list: FilterList = [new StatusFilter(), new SortFilter()];
    if (genres.length > 0) list.push(new GenreFilter(genres));
    return list;
  }

  // ========================= Helpers =========================
  private removeTitleRank(s: string): string {
    return s.replace(TITLE_RANK_REGEX, "").trim();
  }
}
