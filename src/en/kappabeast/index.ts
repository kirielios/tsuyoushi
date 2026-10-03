// Port of keiyoushi/extensions-source src/en/kappabeast/KappaBeast.kt
import { Filter, FilterList, HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, parseHtml, type ClientBuilder } from "../../../sdk/index.ts";
import { hasNextPage, toSChapters, toSManga, type ChapterPageResponse, type SearchResponse } from "./dto.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

export default class KappaBeast extends KeiSource {
  private get domain() {
    return HttpUrl.parse(this.baseUrl).host;
  }
  private get cdnUrl() {
    return `https://strapi.${this.domain}`;
  }
  private get apiUrl() {
    return `${this.cdnUrl}/api`;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchMangas(page, "", "", "", "", "");
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchMangas(page, "", "", "", "", "updatedAt:desc");
  }

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genre = firstInstanceOrNull(filters, GenreFilter)?.value ?? "";
    const status = firstInstanceOrNull(filters, StatusFilter)?.value ?? "";
    const type = firstInstanceOrNull(filters, TypeFilter)?.value ?? "";
    const sort = firstInstanceOrNull(filters, SortFilter)?.value ?? "";
    return this.fetchMangas(page, query, genre, status, type, sort);
  }

  private async fetchMangas(page: number, query: string, genre: string, status: string, type: string, sort: string): Promise<MangasPage> {
    const url = HttpUrl.parse(`${this.apiUrl}/mangas`).newBuilder();
    const addParam = (param: string, value: string) => {
      if (value.trim() !== "") url.addQueryParameter(param, value);
    };
    if (query.trim() !== "") url.addQueryParameter("filters[title][$containsi]", query);

    url.addQueryParameter("pagination[page]", String(page));
    url.addQueryParameter("pagination[pageSize]", "20");
    url.addQueryParameter("populate[media][populate]", "*");
    url.addQueryParameter("populate[category][fields][0]", "name");

    addParam("filters[category][name][$eq]", genre);
    addParam("filters[manga_status][$eq]", status);
    addParam("filters[type][$eq]", type);
    addParam("sort[0]", sort);

    const result = (await this.client.get(url.build().toString())).parseAs<SearchResponse>();
    return new MangasPage(
      result.data.map((it) => toSManga(it, this.cdnUrl)),
      hasNextPage(result.meta.pagination),
    );
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [new Filter.Header("Note: Search and active filters are applied together"), new GenreFilter(), new StatusFilter(), new TypeFilter(), new SortFilter()];
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = HttpUrl.parse(`${this.baseUrl}/${manga.url}`).pathSegments[0];

    const url = HttpUrl.parse(`${this.apiUrl}/mangas`)
      .newBuilder()
      .addQueryParameter("filters[slug][$eq]", slug)
      .addQueryParameter("populate[media][populate]", "*")
      .addQueryParameter("populate[category][fields][0]", "name")
      .addQueryParameter("populate[chapters][fields][0]", "number")
      .addQueryParameter("populate[chapters][fields][1]", "title")
      .addQueryParameter("populate[chapters][fields][2]", "createdAt")
      .addQueryParameter("populate[chapters][sort][0]", "number:desc")
      .addQueryParameter("pagination[pageSize]", "1")
      .build();

    const data = (await this.client.get(url.toString())).parseAs<SearchResponse>().data[0];
    return new SMangaUpdate(toSManga(data, this.cdnUrl), toSChapters(data));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const u = HttpUrl.parse(url.href);
    if (u.host !== HttpUrl.parse(this.baseUrl).host || u.pathSegments[0] !== "series") return null;
    const slug = u.pathSegments[1];
    if (slug == null || slug.trim() === "") return null;
    const api = HttpUrl.parse(`${this.apiUrl}/mangas`)
      .newBuilder()
      .addQueryParameter("filters[slug][$eq]", slug)
      .addQueryParameter("populate[media][populate]", "*")
      .addQueryParameter("populate[category][fields][0]", "name")
      .addQueryParameter("pagination[pageSize]", "1")
      .build();

    const data = (await this.client.get(api.toString())).parseAs<SearchResponse>().data[0];
    if (data == null) return null;
    const manga = toSManga(data, this.cdnUrl);
    manga.initialized = true;
    return manga;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/reader/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const parts = HttpUrl.parse(`${this.baseUrl}/${chapter.url}`);
    const documentId = parts.fragment!;
    const chapterNum = parts.pathSegments[1];
    const url = HttpUrl.parse(`${this.apiUrl}/chapters`)
      .newBuilder()
      .addQueryParameter("filters[manga][documentId][$eq]", documentId)
      .addQueryParameter("filters[number][$eq]", chapterNum)
      .addQueryParameter("pagination[pageSize]", "1")
      .build();

    const html = (await this.client.get(url.toString())).parseAs<ChapterPageResponse>().data[0]?.htmlContent;
    if (html == null) return [];
    // Jsoup.parseBodyFragment(html, baseUrl)
    return parseHtml(this.host.load, html, this.baseUrl)
      .select("div.separator > a")
      .map((element, i) => new Page(i, "", HttpUrl.parse(element.absUrl("href")).newBuilder().setPathSegment(4, "s0").build().toString()));
  }
}
