// Port of keiyoushi/extensions-source src/all/lunaranime/LunarAnime.kt
import { MangasPage, Page, SMangaUpdate, KeiSource, substringAfterLast, substringBefore, toHttpUrl, type ClientBuilder, type Filter, type FilterList, type SChapter, type SManga } from "../../../sdk/index.ts";
import { LunarDecryptor } from "./decryptor.ts";
import {
  chapterToSChapter,
  mangaToSManga,
  type LunarChapterListResponse,
  type LunarMangaResponse,
  type LunarPageListDecrypted,
  type LunarPageListResponse,
  type LunarPasswordInfoResponse,
  type LunarRecentResponse,
  type LunarSearchResponse,
} from "./dto.ts";
import { GenreFilter, LanguageFilter, StatusFilter, TypeFilter, YearFilter } from "./filters.ts";
import { LunarSerenity } from "./serenity.ts";

const API_URL = "https://api.lunarx.to";
const CDN_URL = "https://vault.lunarx.to";

export default class LunarAnime extends KeiSource {
  private get internalLang(): string {
    return this.lang === "pt-BR" ? "pt-br" : this.lang;
  }

  private readonly apiurlHost = toHttpUrl(API_URL).host;
  private readonly cdnurlHost = toHttpUrl(CDN_URL).host;

  private readonly serenity = new LunarSerenity(API_URL);

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor(this.serenity.interceptor())
      .addInterceptor((request) => {
        if (request.url.includes(this.cdnurlHost)) {
          const headers = new Headers(request.headers);
          headers.set("Referer", `${this.baseUrl}/`);
          return { ...request, headers };
        }
        return request;
      })
      .rateLimit(2, 1000, (it) => it.hostname === this.apiurlHost || it.hostname === this.cdnurlHost);
  }

  private readonly crypto = new LunarDecryptor(this.serenity);

  // ============================== Popular ===============================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", []);
  }

  // =============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(API_URL).newBuilder().addPathSegments("api/manga/recent").addQueryParameter("page", String(page)).addQueryParameter("limit", "30");
    if (this.lang !== "all") url.addQueryParameter("language", this.internalLang);

    const result = (await this.client.get(url.build().toString())).parseAs<LunarRecentResponse>();
    return new MangasPage((result.our_mangas ?? []).map(mangaToSManga), (result.page ?? 0) * (result.limit ?? 0) < (result.total_count ?? 0));
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(API_URL).newBuilder().addPathSegments("api/manga/search").addQueryParameter("page", String(page)).addQueryParameter("limit", "30");
    if (query.trim()) url.addQueryParameter("query", query);
    if (this.lang !== "all") url.addQueryParameter("language", this.internalLang);

    for (const filter of filters) {
      if (filter instanceof StatusFilter || filter instanceof TypeFilter || filter instanceof LanguageFilter) {
        const value = filter.toValue();
        if (value != null) url.addQueryParameter(filter instanceof StatusFilter ? "status" : filter instanceof TypeFilter ? "country" : "language", value);
      } else if (filter instanceof YearFilter) {
        const year = filter.state;
        if (year.trim() && /^[+-]?\d+$/.test(year)) url.addQueryParameter("year", year);
      } else if (filter instanceof GenreFilter) {
        const genres = filter.toGenres();
        if (genres.length) url.addQueryParameter("genres", genres.join(","));
      }
    }
    url.addQueryParameter("sort", "relevance");

    const result = (await this.client.get(url.build().toString())).parseAs<LunarSearchResponse>();
    return new MangasPage((result.manga ?? []).map(mangaToSManga), (result.page ?? 0) < (result.total_pages ?? 0));
  }

  // =========================== Manga Details ============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = toHttpUrl(url.href).pathSegments.filter((it) => it.length);
    if (segments.length < 2 || segments[0] !== "manga") return null;
    return this.fetchMangaDetails(segments[1]);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringAfterLast(manga.url, "/");
    return new SMangaUpdate(fetchDetails ? await this.fetchMangaDetails(slug) : manga, fetchChapters ? await this.fetchChapterList(slug) : chapters);
  }

  private async fetchMangaDetails(slug: string): Promise<SManga> {
    const url = toHttpUrl(API_URL).newBuilder().addPathSegments("api/manga/title").addPathSegment(slug).build();
    return mangaToSManga((await this.client.get(url.toString())).parseAs<LunarMangaResponse>().manga);
  }

  // ============================== Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + substringBefore(chapter.url, "?");
  }

  private async fetchChapterList(slug: string): Promise<SChapter[]> {
    const passwordUrl = toHttpUrl(API_URL).newBuilder().addPathSegments("api/manga/password/info").addPathSegment(slug).build();
    const passwordInfo = (await this.client.get(passwordUrl.toString())).parseAs<LunarPasswordInfoResponse>();

    const requestUrl = toHttpUrl(API_URL).newBuilder().addPathSegments("api/manga").addPathSegment(slug).build();
    const result = (await this.client.get(requestUrl.toString())).parseAs<LunarChapterListResponse>();

    return (result.data ?? [])
      .filter((it) => this.lang === "all" || it.language === this.internalLang)
      .map((chapter) => {
        const isLocked = passwordInfo.has_series_password === true || (passwordInfo.chapter_passwords ?? []).some((it) => it.chapter_number === chapter.chapter && (it.language == null || it.language === chapter.language));
        return chapterToSChapter(chapter, slug, isLocked);
      })
      .reverse();
  }

  // =============================== Pages ================================

  private async viewChapter(slug: string, number: string, lang: string) {
    await this.client.get(`${API_URL}/api/manga/rating/status/${slug}/${number}`, undefined, { ensureSuccess: false });

    const headers = this.headers;
    headers.set("Content-Type", "application/json; charset=utf-8");
    await this.client.post(`${API_URL}/api/manga/chapter/view`, headers, JSON.stringify({ slug, chapter: number, language: lang }), { ensureSuccess: false });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = toHttpUrl(this.baseUrl + chapter.url);
    const language = chapterUrl.queryParameter("lang") ?? "en";
    const [slug, chapterNumber] = chapterUrl.pathSegments.slice(-2);

    const seeds = this.crypto.extractSeeds((await this.client.get(chapterUrl.toString())).asJsoup());
    const minted = await this.crypto.mint(seeds, slug, chapterNumber);

    // Required requests or fake images are returned
    await this.viewChapter(slug, chapterNumber, language);

    const url = toHttpUrl(API_URL).newBuilder().addPathSegments("api/manga/r").addPathSegment(minted.token);
    if (language !== "en") url.addQueryParameter("language", language);

    const sessionData = (await this.client.get(url.build().toString())).parseAs<LunarPageListResponse>().data?.session_data;
    if (sessionData == null) throw new Error("session_data is empty");

    const images = JSON.parse(await this.crypto.unpack(sessionData, seeds, minted.nonce)) as LunarPageListDecrypted;
    return (images.data.images ?? []).map((imageUrl, index) => new Page(index, chapter.url, imageUrl));
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const imageHeaders = this.headersBuilder();
    imageHeaders.set("Referer", this.baseUrl + page.url);
    imageHeaders.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    return { url: page.imageUrl!, headers: imageHeaders };
  }

  // ============================== Filters ===============================

  override getFilterList(_data: unknown = null): FilterList {
    const filters: Filter[] = [new StatusFilter(), new TypeFilter()];
    if (this.lang === "all") filters.push(new LanguageFilter());
    filters.push(new YearFilter(), new GenreFilter());
    return filters;
  }
}
