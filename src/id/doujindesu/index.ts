// Port of keiyoushi/extensions-source src/id/doujindesu/Doujindesu.kt
import {
  ClientBuilder,
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SMangaUpdate,
  firstInstanceOrNull,
  isBlank,
  isNotBlank,
  parseHtml,
  toHttpUrl,
  urlWithoutDomain,
  type HttpUrl,
  type SChapter,
  type SManga,
} from "../../../sdk/index.ts";
import { Decryptor } from "./decryptor.ts";
import { chapterToSChapter, isCompleted, mangaItemToSManga, pagesOf, type JsoupHelpers, type MangaItem, type PageList, type TaxonomyMangas, type TermsResult } from "./dto.ts";
import {
  AuthorGroupSeriesFilter,
  AuthorGroupSeriesValueFilter,
  CategoryNames,
  GenreList,
  OrderBy,
  StatusList,
  authorGroupSeriesOptions,
  categoryNames,
  getGenreList,
  orderBy,
  statusList,
} from "./filters.ts";

const APP_SECRET = "dfdf72051dbfdc7d76889ebd31324e74";
const LIMIT = 24;

/** LinkedHashMap with removeEldestEntry { size > 30 } */
class SlugCache extends Map<string, string> {
  override set(key: string, value: string) {
    super.set(key, value);
    if (this.size > 30) this.delete(this.keys().next().value!);
    return this;
  }
}

export default class Doujindesu extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  private readonly decryptor = new Decryptor(() => this.apiUrl);

  private readonly slugCache = new SlugCache();

  private readonly jsoup: JsoupHelpers = {
    // Parser.unescapeEntities: textarea content is RCDATA, so only entities are decoded
    unescapeEntities: (s) => parseHtml(this.host.load, `<textarea>${s.replaceAll("</textarea", "&lt;/textarea")}</textarea>`, this.baseUrl).selectFirst("textarea")!.wholeText(),
    parse: (html) => parseHtml(this.host.load, html, this.baseUrl),
  };

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(this.decryptor.xorInterceptor()).addChainInterceptor((chain) => {
      const request = chain.request();
      if (new URL(request.url).hostname !== toHttpUrl(this.baseUrl).host) {
        const headers = new Headers(request.headers);
        headers.delete("x-app-secret");
        return chain.proceed({ ...request, headers });
      }
      return chain.proceed(request);
    });
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.append("x-app-secret", APP_SECRET);
    return headers;
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchMangaList(this.mangaListUrl(page, "rating"), page);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchMangaList(this.mangaListUrl(page), page);
  }

  private mangaListUrl(page: number, sort = "latest_chapter"): HttpUrl {
    const offset = (page - 1) * LIMIT;
    return toHttpUrl(`${this.apiUrl}/manga`).newBuilder().addQueryParameter("limit", String(LIMIT)).addQueryParameter("offset", String(offset)).addQueryParameter("sort", sort).build();
  }

  private async fetchMangaList(url: HttpUrl, page: number): Promise<MangasPage> {
    const response = await this.client.get(String(url));
    const totalHeader = response.header("x-total-count");
    const total = totalHeader != null && /^[+-]?\d+$/.test(totalHeader) ? parseInt(totalHeader, 10) : null;
    const hasNextPage = total != null ? page * LIMIT < total : true;
    const mangas = response.parseAs<MangaItem[]>();
    return new MangasPage(
      mangas.map((it) => mangaItemToSManga(it, this.baseUrl, this.jsoup)),
      hasNextPage,
    );
  }

  private async fetchTaxonomyList(url: HttpUrl): Promise<MangasPage> {
    const dto = (await this.client.get(String(url))).parseAs<TaxonomyMangas>();
    return new MangasPage(
      dto.mangaList.map((it) => mangaItemToSManga(it, this.baseUrl, this.jsoup)),
      dto.pagination.page < dto.pagination.totalPages,
    );
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    // priority when query exists: usual filter > type filter, otherwise opposite
    const hasQuery = isNotBlank(query);
    const agsFilter = firstInstanceOrNull(filters, AuthorGroupSeriesFilter);
    const agsValue = firstInstanceOrNull(filters, AuthorGroupSeriesValueFilter)?.state?.trim();

    if (!hasQuery && agsFilter != null && agsFilter.state >= 0 && agsFilter.state < agsFilter.values.length) {
      const selected = agsFilter.values[agsFilter.state];
      const type = selected.key;
      const cacheKey = `${type}:${agsValue}`;

      if (isNotBlank(type) && !isBlank(agsValue)) {
        // Search the input and pick a slug if not cached
        let slug = this.slugCache.get(cacheKey);
        if (slug == null) {
          const url = toHttpUrl(`${this.apiUrl}/taxonomy/${type}/`).newBuilder().addQueryParameter("search", agsValue).addQueryParameter("limit", "1").build();
          slug = (await this.client.get(String(url))).parseAs<TermsResult>().terms[0]?.slug;
          if (slug == null) throw new Error(`Gagal menemukan: ${agsValue}`);
        }
        this.slugCache.set(cacheKey, slug);

        const taxonomyUrl = toHttpUrl(`${this.apiUrl}/taxonomy/${type}/${slug}`).newBuilder().addQueryParameter("limit", String(LIMIT)).addQueryParameter("page", String(page)).build();
        return this.fetchTaxonomyList(taxonomyUrl);
      } else if (isBlank(type) && !isBlank(agsValue)) {
        throw new Error("Pilih tipe filter");
      }
    }

    // Usual query search + other filters
    const builder = this.mangaListUrl(page).newBuilder();

    if (hasQuery) builder.addQueryParameter("search", query);

    for (const filter of filters) {
      if (filter instanceof StatusList) {
        const key = filter.values[filter.state]?.key;
        if (isNotBlank(key)) builder.setQueryParameter("status", key);
      } else if (filter instanceof CategoryNames) {
        const key = filter.values[filter.state]?.key;
        if (isNotBlank(key)) builder.setQueryParameter("type", key);
      } else if (filter instanceof OrderBy) {
        const order = filter.values[filter.state];
        if (order) builder.setQueryParameter("sort", isBlank(order.key) ? "latest_chapter" : order.key);
      } else if (filter instanceof GenreList) {
        const selected = filter.state.filter((it) => it.state);
        if (selected.length) {
          builder.addEncodedQueryParameter(
            "genre",
            selected.map((it) => it.id.toLowerCase().replaceAll(" ", "-")).join(","),
          );
        }
      }
    }

    return this.fetchMangaList(builder.build(), page);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${this.getSlug(manga)}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    let slug: string | null | undefined;
    switch (segments[0]) {
      case "manga":
        slug = segments[1];
        break;
      case "reader": {
        const chapterId = segments[1];
        if (chapterId == null) return null;
        slug = (await this.client.get(`${this.apiUrl}/chapters/${chapterId}`)).parseAs<PageList>().manga_slug;
        break;
      }
      default:
        return null;
    }
    if (slug == null) return null;
    const manga = mangaItemToSManga((await this.client.get(`${this.apiUrl}/manga/${slug}`)).parseAs<MangaItem>(), this.baseUrl, this.jsoup);
    manga.url = urlWithoutDomain(this.getMangaUrl(manga));
    manga.initialized = true;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const item = (await this.client.get(`${this.apiUrl}/manga/${this.getSlug(manga)}`)).parseAs<MangaItem>();
    return new SMangaUpdate(
      mangaItemToSManga(item, this.baseUrl, this.jsoup),
      item.chapters.map((chapter, index) => chapterToSChapter(chapter, isCompleted(item) && index === 0)),
    );
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/reader/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pageList = (await this.client.get(`${this.apiUrl}/chapters/${chapter.url}`)).parseAs<PageList>();
    return pagesOf(pageList).map((imgUrl, i) => new Page(i, "", this.jsoup.unescapeEntities(imgUrl)));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Filter Tipe Diabaikan Saat Menggunakan Pencarian"),
      new AuthorGroupSeriesFilter(authorGroupSeriesOptions),
      new AuthorGroupSeriesValueFilter(),
      new Filter.Separator(),
      new StatusList(statusList),
      new CategoryNames(categoryNames),
      new OrderBy(orderBy),
      new GenreList(getGenreList()),
    );
  }

  private getSlug(manga: SManga): string {
    const fullUrl = manga.url.startsWith("http") ? manga.url : `${this.baseUrl}/${manga.url.replace(/^\//, "")}`;
    return toHttpUrl(fullUrl)
      .pathSegments.filter((it) => isNotBlank(it))
      .at(-1)!;
  }
}
