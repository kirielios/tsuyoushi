// Port of keiyoushi/extensions-source src/all/mangamillion/MangaMillion.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  decodeProto,
  firstInstanceOrNull,
  toHttpUrl,
  type ClientBuilder,
  type Filter,
  type ProtoSchema,
  type Response,
} from "../../../sdk/index.ts";
import {
  chapterResponseSchema,
  chapterToSChapter,
  detailsResponseSchema,
  detailsToSManga,
  isAvailable,
  searchParameterResponseSchema,
  searchResponseSchema,
  seriesResponseSchema,
  seriesToSManga,
  tokenResponseSchema,
  viewerResponseSchema,
  type ChapterResponse,
  type DetailsResponse,
  type SearchParameter,
  type SearchParameterResponse,
  type SearchResponse,
  type SeriesList,
  type SeriesResponse,
  type TokenResponse,
  type ViewerResponse,
} from "./dto.ts";
import { GenreFilter, HighlightsFilter, RatingFilter, TagIdGroup, ThemeFilter } from "./filters.ts";
import { imageInterceptor } from "./ImageInterceptor.ts";

const TOKEN_PREF_KEY = "access_token";
const SERVICE_LANGUAGES = new Set(["de", "en", "es", "fr", "hi", "id", "it", "ja", "ko-KR", "pt-BR", "ru", "th", "vi", "zh-CN"]);

/** Response.parseAsProto<T>() */
const parseAsProto = <T>(response: Response, schema: ProtoSchema): T => decodeProto<T>(response.bytes(), schema);

/** sortedByDescending over a nullable key: null sorts as the smallest value, so last here. Stable. */
const sortedByDescending = (list: SeriesList[], key: (s: SeriesList) => number | undefined): SeriesList[] =>
  [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    return y - x;
  });

export default class MangaMillion extends KeiSource {
  private get domain() {
    return toHttpUrl(this.baseUrl).host;
  }
  private get apiUrl() {
    return `https://api.${this.domain}/api`;
  }
  private tokenLock: Promise<unknown> = Promise.resolve();
  private get serviceLang(): string {
    return SERVICE_LANGUAGES.has(this.lang) ? this.lang : "en";
  }

  private get token(): string {
    return this.preferences.getString(TOKEN_PREF_KEY, "")!;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(imageInterceptor).addChainInterceptor(async (chain) => {
      const request = chain.request();
      const url = new URL(request.url);
      const segments = url.pathname.split("/");
      if (url.hostname !== `api.${this.domain}` || segments[segments.length - 1] === "register") return chain.proceed(request);

      const usedToken = request.headers.get("Access-Token") ?? "";
      if (usedToken) {
        const response = await chain.proceed(request);
        if (response.code !== 403) return response;
      }

      const newToken = await this.getToken(usedToken);
      const headers = new Headers(request.headers);
      headers.set("Access-Token", newToken);
      return chain.proceed({ ...request, headers });
    });
  }

  protected override configureHeaders(headers: Headers): Headers {
    if (this.token) headers.set("Access-Token", this.token);
    headers.set("Accept", "*/*");
    headers.set("Accept-Language", "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7");
    return headers;
  }

  // tokenMutex.withLock: calls queue on one promise chain
  private getToken(rejected: string): Promise<string> {
    const run = this.tokenLock.then(() => this.getTokenLocked(rejected));
    this.tokenLock = run.catch(() => undefined);
    return run;
  }

  private async getTokenLocked(rejected: string): Promise<string> {
    const current = this.token;
    if (current && current !== rejected) return current;

    const url = toHttpUrl(`${this.apiUrl}/register`).newBuilder().addQueryParameter("service_language", this.serviceLang).build();

    const accessToken = parseAsProto<TokenResponse>(await this.client.post(url.toString(), undefined, new Uint8Array(0)), tokenResponseSchema).token.accessToken;
    this.preferences.edit().putString(TOKEN_PREF_KEY, accessToken).apply();
    return accessToken;
  }

  private mangaListUrl() {
    return toHttpUrl(`${this.apiUrl}/manga_list`).newBuilder().addQueryParameter("service_language", this.serviceLang).addQueryParameter("avif_enable", "true").build();
  }

  override async getPopularManga(_page: number): Promise<MangasPage> {
    const result = parseAsProto<SeriesResponse>(await this.client.get(this.mangaListUrl().toString()), seriesResponseSchema);
    const mangas = sortedByDescending(
      result.allSeries.seriesList.filter((it) => it.languages.includes(this.lang)),
      (it) => it.series.views,
    ).map((it) => seriesToSManga(it.series));
    return new MangasPage(mangas, false);
  }

  override async getLatestUpdates(_page: number): Promise<MangasPage> {
    const result = parseAsProto<SeriesResponse>(await this.client.get(this.mangaListUrl().toString()), seriesResponseSchema);
    const mangas = sortedByDescending(
      result.allSeries.seriesList.filter((it) => it.languages.includes(this.lang)),
      (it) => it.series.uploadTime,
    ).map((it) => seriesToSManga(it.series));
    return new MangasPage(mangas, false);
  }

  override async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const tagIds = filters.filter((it): it is TagIdGroup => it instanceof TagIdGroup).flatMap((it) => it.checkedIds);
    const ratingIds = firstInstanceOrNull(filters, RatingFilter)?.checkedIds ?? [];
    const url = toHttpUrl(`${this.apiUrl}/search`)
      .newBuilder()
      .addQueryParameter("service_language", this.serviceLang)
      .addQueryParameter("avif_enable", "true")
      .addQueryParameter("translated_language", this.lang);
    if (query.trim()) url.addQueryParameter("text", query);
    if (tagIds.length > 0) url.addQueryParameter("tag_id", tagIds.join(","));
    if (ratingIds.length > 0) url.addQueryParameter("rating_id", ratingIds.join(","));

    const result = parseAsProto<SearchResponse>(await this.client.get(url.build().toString()), searchResponseSchema);
    const mangas = result.allSeries.seriesList.filter((it) => it.languages.includes(this.lang)).map((it) => seriesToSManga(it.series));
    return new MangasPage(mangas, false);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const url = toHttpUrl(`${this.apiUrl}/search_parameter`).newBuilder().addQueryParameter("service_language", this.serviceLang).addQueryParameter("avif_enable", "true").build();

    return parseAsProto<SearchParameterResponse>(await this.client.get(url.toString()), searchParameterResponseSchema).searchParameter;
  }

  override getFilterList(data: unknown = null): FilterList {
    const result = data as SearchParameter | null;
    if (!result) return FilterList();

    const filters: Filter[] = [];
    if (result.genres.length > 0) filters.push(new GenreFilter(result.genres));
    if (result.themes.length > 0) filters.push(new ThemeFilter(result.themes));
    if (result.highlights.length > 0) filters.push(new HighlightsFilter(result.highlights));
    if (result.ratings.length > 0) filters.push(new RatingFilter(result.ratings));
    return FilterList(...filters);
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [mangas, chapterList] = await Promise.all([
      (async () => {
        if (!fetchDetails) return manga;
        const url = toHttpUrl(`${this.apiUrl}/title_detail`)
          .newBuilder()
          .addQueryParameter("service_language", this.serviceLang)
          .addQueryParameter("avif_enable", "true")
          .addQueryParameter("original_title_id", manga.url)
          .build();
        return detailsToSManga(parseAsProto<DetailsResponse>(await this.client.get(url.toString()), detailsResponseSchema).detailsEntry.details);
      })(),
      (async () => {
        if (!fetchChapters) return chapters;
        const url = toHttpUrl(`${this.apiUrl}/chapter_list`)
          .newBuilder()
          .addQueryParameter("service_language", this.serviceLang)
          .addQueryParameter("avif_enable", "true")
          .addQueryParameter("original_title_id", manga.url)
          .addQueryParameter("translated_language", this.lang)
          .build();

        const list = parseAsProto<ChapterResponse>(await this.client.get(url.toString()), chapterResponseSchema)
          .chapterEntry.chapterGroups.flatMap((it) => it.chapterList)
          .filter((it) => isAvailable(it))
          .map((it) => chapterToSChapter(it, manga.url));
        return this.fixExtraChapterNumbers(list).reverse();
      })(),
    ]);

    return new SMangaUpdate(mangas, chapterList);
  }

  private fixExtraChapterNumbers(list: SChapter[]): SChapter[] {
    for (let i = 0; i < list.length; i++) {
      const chapter = list[i];
      if (chapter.chapter_number === -1) {
        // rounded: Kotlin adds 0.01F in float precision
        if (i > 0) chapter.chapter_number = Math.round((list[i - 1].chapter_number + 0.01) * 1e6) / 1e6;
        else if (list.length > 1) chapter.chapter_number = Math.round((list[1].chapter_number - 0.01) * 1e6) / 1e6;
        else chapter.chapter_number = 0;
      }
    }
    return list;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = toHttpUrl(`${this.apiUrl}/viewer`)
      .newBuilder()
      .addQueryParameter("service_language", this.serviceLang)
      .addQueryParameter("avif_enable", "true")
      .addQueryParameter("translated_chapter_id", chapter.url)
      .addQueryParameter("quality", "middle")
      .build();

    const viewer = parseAsProto<ViewerResponse>(await this.client.get(url.toString()), viewerResponseSchema).viewer;
    return viewer.pageList.map((page, index) => new Page(index, "", `${page.imageUrl}#${viewer.key}:${viewer.iv}`));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${this.serviceLang}/title/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/${this.serviceLang}/title/${String(chapter.memo.titleId)}/chapter/${chapter.url}`;
  }
}
