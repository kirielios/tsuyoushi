// Port of keiyoushi/extensions-source src/en/flamecomics/FlameComics.kt (+ Dto.kt)
import { KeiSource, MangasPage, SManga, SMangaUpdate, extractNextJsFromDocument, hasKeys, parseHtml, toHttpUrl, type ChainInterceptor, type ClientBuilder, type FilterList, type HttpUrl, type HttpUrlBuilder, type Page, type SChapter } from "../../../sdk/index.ts";
import { THUMBNAIL_FRAGMENT, chapterImagesToPages, chapterToSChapter, latestSeries, seriesToSManga, seriesToSMangaDetails, type BrowseDto, type BuildIdDto, type ChapterPageDto, type LatestDto, type NextDataDto, type SeriesDto, type SeriesPageDto } from "./dto.ts";

const SPECIAL_CHARS_REGEX = /[^A-Za-z0-9 ]/g;

export default class FlameComics extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(this.buildIdOutdatedInterceptor).rateLimit(2, 2000, (url) => url.hash !== `#${THUMBNAIL_FRAGMENT}`);
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    // sortedByDescending { it.views }: null views sort last
    const series = (await this.fetchBrowseSeries()).sort((a, b) => (a.views === b.views ? 0 : a.views == null ? 1 : b.views == null ? -1 : b.views - a.views));
    return new MangasPage(series.flatMap((it) => seriesToSManga(it) ?? []), false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const series = latestSeries((await this.client.get((await this.dataUrl((b) => b.addPathSegment("index.json"))).toString())).parseAs<NextDataDto<LatestDto>>().pageProps);
    return new MangasPage(series.flatMap((it) => seriesToSManga(it) ?? []), false);
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const normalizedQuery = this.normalizeTitle(query);
    const series = (await this.fetchBrowseSeries()).filter((s) => [s.title, ...(s.altTitles ?? [])].some((it) => this.normalizeTitle(it).includes(normalizedQuery)));
    return new MangasPage(series.flatMap((it) => seriesToSManga(it) ?? []), false);
  }

  private async fetchBrowseSeries(): Promise<SeriesDto[]> {
    return (await this.client.get((await this.dataUrl((b) => b.addPathSegment("browse.json"))).toString())).parseAs<NextDataDto<BrowseDto>>().pageProps.series;
  }

  private normalizeTitle(s: string) {
    return s.toLowerCase().replace(SPECIAL_CHARS_REGEX, "");
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== toHttpUrl(this.baseUrl).host || segments[0] !== "series") return null;
    const seriesId = /^[+-]?\d+$/.test(segments[1] ?? "") ? Number.parseInt(segments[1], 10) : null;
    if (seriesId === null) return null;
    const manga = SManga.create();
    manga.url = `/series/${seriesId}`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const segments = toHttpUrl(this.getMangaUrl(manga)).pathSegments;
    const seriesId = segments[segments.length - 1];
    const url = await this.dataUrl((b) => b.addPathSegment("series").addPathSegment(`${seriesId}.json`).addQueryParameter("id", seriesId));
    const seriesPage = (await this.client.get(url.toString())).parseAs<NextDataDto<SeriesPageDto>>().pageProps;

    return new SMangaUpdate(
      seriesToSMangaDetails(seriesPage.series, (html) => this.wholeText(html)),
      seriesPage.chapters.map(chapterToSChapter),
    );
  }

  /** Jsoup.parseBodyFragment(html).wholeText(): Jsoup writes "\n" for <br>, cheerio's text() drops it. */
  private wholeText(html: string): string {
    return parseHtml(this.host.load, html.replace(/<br\s*\/?>/gi, "\n"), "").selectFirst("body")!.wholeText();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const [seriesId, token] = toHttpUrl(this.getChapterUrl(chapter)).pathSegments.slice(1);
    const url = await this.dataUrl((b) => b.addPathSegment("series").addPathSegment(seriesId).addPathSegment(`${token}.json`).addQueryParameter("id", seriesId).addQueryParameter("token", token));
    return chapterImagesToPages((await this.client.get(url.toString())).parseAs<NextDataDto<ChapterPageDto>>().pageProps.chapter);
  }

  // Next.js data routes are keyed by the site's build id, which changes on every deploy.
  private buildId: string | null = null;

  private async dataUrl(path: (b: HttpUrlBuilder) => void): Promise<HttpUrl> {
    let id = this.buildId;
    if (id == null) {
      id = extractNextJsFromDocument<BuildIdDto>((await this.client.get(this.baseUrl)).asJsoup(), hasKeys("buildId"))?.buildId ?? null;
      if (id == null) throw new Error("Failed to find buildId");
      this.buildId = id;
    }

    const builder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("_next").addPathSegment("data").addPathSegment(id);
    path(builder);
    return builder.build();
  }

  private readonly buildIdOutdatedInterceptor: ChainInterceptor = async (chain) => {
    const request = chain.request();
    const response = await chain.proceed(request);
    const url = toHttpUrl(request.url);
    const segments = url.pathSegments;

    if (response.code !== 404 || url.host !== toHttpUrl(this.baseUrl).host || segments[0] !== "_next" || segments[1] !== "data") return response;

    // CacheControl.FORCE_NETWORK: this client keeps no cache
    const homeResponse = await chain.proceed({ ...request, url: this.baseUrl });
    const newBuildId = extractNextJsFromDocument<BuildIdDto>(homeResponse.asJsoup(), hasKeys("buildId"))?.buildId;
    if (newBuildId == null) throw new Error("Failed to find buildId");
    this.buildId = newBuildId;

    const newUrl = url.newBuilder().setPathSegment(2, newBuildId).build();
    return chain.proceed({ ...request, url: newUrl.toString() });
  };
}
