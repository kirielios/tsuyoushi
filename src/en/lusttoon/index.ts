// Port of keiyoushi/extensions-source src/en/lusttoon/LustToon.kt
import { Filter, KeiSource, MangasPage, Page, SMangaUpdate, distinctBy, extractNextJs, extractNextJsFromDocument, firstInstanceOrNull, hasKeys, substringAfterLast, toHttpUrl, type ClientBuilder, type FilterList, type SChapter, type SManga } from "../../../sdk/index.ts";
import { chapterToSChapter, homeMangas, pagechesImages, searchItemToSManga, searchResponseHasNext, searchResponseMangas, serieToSManga, type HomeDto, type PagechesDto, type SearchItemDto, type SearchResponseDto, type SerieDto } from "./dto.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

const imageUrlRegex = /https?:\/\/media\.lustoon\.com\/file\/[^"\s']+\.(?:jpg|jpeg|png|webp|avif)/gi;

export default class LustToon extends KeiSource {
  private readonly apiUrl = "https://back.lustoon.com";

  protected override configureClient(builder: ClientBuilder) {
    return builder.addInterceptor((request) => {
      const url = new URL(request.url);
      if (url.protocol === "http:") {
        url.protocol = "https:";
        return { ...request, url: url.href };
      }
      return request;
    });
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/filtrar`)
      .newBuilder()
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", "24")
      .addQueryParameter("orderBy", "6")
      .addQueryParameter("sort", "desc")
      .addQueryParameter("gendersId", "")
      .addQueryParameter("origin", "")
      .addQueryParameter("state", "")
      .addQueryParameter("loading", "true")
      .build();

    const resp = (await this.client.get(url.toString())).parseAs<SearchResponseDto>();
    return new MangasPage(searchResponseMangas(resp), searchResponseHasNext(resp));
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    if (page === 1) {
      const rscHeaders = this.headers;
      rscHeaders.append("RSC", "1");
      const response = await this.client.get(this.baseUrl, rscHeaders);
      const home = extractNextJs<HomeDto>(response, (element) => hasKeys("comics")(element) && Array.isArray((element as Record<string, unknown>)["comics"]));
      if (home != null && homeMangas(home).length > 0) {
        return new MangasPage(homeMangas(home), true);
      }
    }

    const url = toHttpUrl(`${this.apiUrl}/filtrar`)
      .newBuilder()
      .addQueryParameter("page", String(page - 1))
      .addQueryParameter("limit", "24")
      .addQueryParameter("orderBy", "3")
      .addQueryParameter("sort", "desc")
      .addQueryParameter("gendersId", "")
      .addQueryParameter("origin", "")
      .addQueryParameter("state", "")
      .addQueryParameter("loading", "true")
      .build();

    const resp = (await this.client.get(url.toString())).parseAs<SearchResponseDto>();
    return new MangasPage(searchResponseMangas(resp), searchResponseHasNext(resp));
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.trim() !== "") {
      const url = toHttpUrl(`${this.apiUrl}/home/buscar`).newBuilder().addQueryParameter("query", query).build();
      const items = (await this.client.get(url.toString())).parseAs<SearchItemDto[]>();
      return new MangasPage(items.filter((it) => it.slug != null).map(searchItemToSManga), false);
    }

    const sortFilter = firstInstanceOrNull(filters, SortFilter);

    const url = toHttpUrl(`${this.apiUrl}/filtrar`)
      .newBuilder()
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", "24")
      .addQueryParameter("loading", "true")
      .addQueryParameter("orderBy", sortFilter?.selected ?? "1")
      .addQueryParameter("sort", sortFilter?.state?.ascending === true ? "asc" : "desc")
      .addQueryParameter("gendersId", firstInstanceOrNull(filters, GenreFilter)?.selected ?? "")
      .addQueryParameter("origin", firstInstanceOrNull(filters, TypeFilter)?.selected ?? "")
      .addQueryParameter("state", firstInstanceOrNull(filters, StatusFilter)?.selected ?? "")
      .build();

    const resp = (await this.client.get(url.toString())).parseAs<SearchResponseDto>();
    return new MangasPage(searchResponseMangas(resp), searchResponseHasNext(resp));
  }

  // =========================== Manga Details ============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    try {
      if (url.hostname !== new URL(this.baseUrl).hostname) return null;
      const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
      const slug = segments[1];
      if (slug === undefined) return null;
      if (segments[0] !== "comic" || slug.trim() === "") return null;

      const manga = { url: `/comic/${slug}`, title: "", status: 0, memo: {} } as SManga;
      return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    } catch {
      return null;
    }
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const rscHeaders = this.headers;
    rscHeaders.append("RSC", "1");
    const response = await this.client.get(this.getMangaUrl(manga), rscHeaders);
    const serie = extractNextJs<SerieDto>(response, hasKeys("slug", "chapters"));
    if (serie == null) throw new Error("Failed to find valid series data");

    const mangaSlug = serie.slug ?? substringAfterLast(manga.url, "/");

    return new SMangaUpdate(
      serieToSManga(serie),
      serie.chapters?.filter((it) => it.slug != null).map((it) => chapterToSChapter(it, mangaSlug)) ?? [],
    );
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.getChapterUrl(chapter));
    const document = response.asJsoup();
    const pageches = extractNextJsFromDocument<PagechesDto>(document, hasKeys("urlImg", "chapterId"));

    const parsed = pageches != null ? pagechesImages(pageches) : [];
    const images = parsed.length > 0 ? parsed : (document.html().match(imageUrlRegex) ?? []).filter((it) => it.includes("/serie/"));

    return distinctBy(
      images.map((it) => it.replace("http://", "https://")),
      (it) => it,
    )
      .filter((it) => !it.includes("brakeout"))
      .map((url, i) => new Page(i, "", url));
  }

  // ============================== Filters ===============================

  override getFilterList(_data: unknown = null): FilterList {
    return [new SortFilter(), new Filter.Separator(), new TypeFilter(), new StatusFilter(), new GenreFilter()];
  }
}
