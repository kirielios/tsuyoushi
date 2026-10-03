// Port of keiyoushi/extensions-source src/en/hentaihere/HentaiHere.kt
import { Filter, FilterList, HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstance, substringAfter, substringBefore, urlWithoutDomain, type Document } from "../../../sdk/index.ts";
import { AlphabetFilter, CategoryFilter, SortFilter, StatusFilter, alphabetFilterList, categoryFilterList, sortFilterList, statusFilterList } from "./filters.ts";

const IMAGE_SERVER_URL = "https://hentaicdn.com";

export default class HentaiHere extends KeiSource {
  // Popular
  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.getFilterList());
  }

  // Search
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== HttpUrl.parse(this.baseUrl).host) return null;
    const id = HttpUrl.parse(url.href).pathSegments[1];
    if (id == null) return null;

    const manga = SManga.create();
    manga.url = `/m/${id}`;
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    return this.parseMangaDetails(document, manga);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortFilter = firstInstance(filters, SortFilter);
    const alphabetFilter = firstInstance(filters, AlphabetFilter);
    const statusFilter = firstInstance(filters, StatusFilter);
    const categoryFilter = firstInstance(filters, CategoryFilter);

    const sortIndex = sortFilter.state;
    const sortItem = sortFilterList[sortIndex];
    const sortMin = sortIndex >= 5 ? "newest" : sortItem[0];

    const alphabetIndex = alphabetFilter.state;
    const alphabetItem = alphabetFilterList[alphabetIndex];
    const alphabet = alphabetIndex !== 0 ? `/${alphabetItem[0]}` : "";

    let url: string;
    if (query.length > 0) {
      url = HttpUrl.parse(`${this.baseUrl}/search`).newBuilder().addQueryParameter("s", query).addQueryParameter("sort", sortMin).addQueryParameter("page", String(page)).toString();
    } else if (categoryFilter.state !== 0) {
      const category = categoryFilterList[categoryFilter.state][0];
      url = `${this.baseUrl}/search/${category}/${sortMin}${alphabet}?page=${page}`;
    } else if (statusFilter.state !== 0) {
      const status = statusFilterList[statusFilter.state][0];
      url = `${this.baseUrl}/directory/${status}${alphabet}?page=${page}`;
    } else {
      const sort = sortItem[0];
      url = `${this.baseUrl}/directory/${sort}${alphabet}?page=${page}`;
    }

    return this.parseMangaList((await this.client.get(url)).asJsoup());
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select(".item").map((element) => {
      const a = element.select("a");
      const img = element.select(".pos-rlt img");
      const mutedText = element.select("div:not(.pos-rtl) > .text-muted").text();
      const artistName = substringBefore(substringAfter(mutedText, "by "), ".");

      const manga = SManga.create();
      manga.url = urlWithoutDomain(a.attr("abs:href"));
      manga.title = img.attr("alt");
      manga.author = artistName === "-" || artistName === "Unknown" ? undefined : artistName;
      manga.thumbnail_url = img.attr("src");
      return manga;
    });
    const hasNextPage = document.selectFirst(".pagination > li:last-child:not(.disabled)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/directory/newest?page=${page}`)).asJsoup());
  }

  // Details
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const chapterList = document.select("li.sub-chp > a").map((element) => {
      const chapterName = substringBefore(element.text(), "(").trim();
      const first = substringBefore(chapterName, " ");
      const chapterNumber = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(first) ? Number(first) : -1;

      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("abs:href"));
      chapter.name = chapterName;
      chapter.chapter_number = chapterNumber;
      return chapter;
    });

    return new SMangaUpdate(this.parseMangaDetails(document, manga), chapterList);
  }

  private parseMangaDetails(document: Document, manga: SManga): SManga {
    const categories = [...document.select("#info .text-info:contains(Cat) ~ a")];
    const contents = [...document.select("#info .text-info:contains(Content:) ~ a")];
    const licensed = categories.find((it) => it.text() === "Licensed");

    manga.title = document.select("h4 > a").first()!.ownText();
    manga.author = document
      .select("#info .text-info:contains(Artist:) ~ a")
      .map((it) => it.text())
      .join(", ");
    const summary = document.select("#info > div:has(> .text-info:contains(Brief Summary:))").first()?.ownText();
    manga.description = summary === "Nothing yet!" ? undefined : summary;
    manga.genre = [...categories, ...contents].map((it) => it.text()).join(", ");
    if (licensed == null) {
      const status = document.select("#info .text-info:contains(Status:) ~ a").first()?.text();
      manga.status = status != null ? this.toStatus(status) : SManga.UNKNOWN;
    } else manga.status = SManga.LICENSED;
    manga.thumbnail_url = document.select("#cover img").first()!.attr("src");
    return manga;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const text = (await this.client.get(this.getChapterUrl(chapter))).text();
    const list = JSON.parse(substringBefore(substringAfter(text, "var rff_imageList = "), ";")) as string[];
    return list.map((imagePath, i) => new Page(i, "", `${IMAGE_SERVER_URL}/hentai${imagePath}`));
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return [
      new Filter.Header("Note: Some ignored for text search, category!"),
      new Filter.Header("Note: Ignored when used with status!"),
      new SortFilter(sortFilterList.map((it) => it[1])),
      new Filter.Separator(),
      new Filter.Header("Note: Ignored for text search!"),
      new AlphabetFilter(alphabetFilterList.map((it) => it[1])),
      new Filter.Separator(),
      new Filter.Header("Note: Ignored for text search, category!"),
      new StatusFilter(statusFilterList.map((it) => it[1])),
      new Filter.Separator(),
      new Filter.Header("Note: Ignored for text search!"),
      new CategoryFilter(categoryFilterList.map((it) => it[1])),
    ];
  }

  private toStatus(s: string): number {
    if (s === "Completed") return SManga.COMPLETED;
    if (s === "Ongoing") return SManga.ONGOING;
    return SManga.UNKNOWN;
  }
}
