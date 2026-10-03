// Port of keiyoushi/extensions-source src/en/toonily/Toonily.kt
import { ClientBuilder, DateTimeFormatter, Locale, toHttpUrl, type FilterList, type Request, type SChapter, type SManga } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

const titleSpecialCharactersRegex = /[^a-z0-9]+/g;
const sdCoverRegex = /-[0-9]+x[0-9]+(\.\w+)$/;

export default class Toonily extends Madara {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("MMM d, yy", Locale.US);

  protected override configureClient(b: ClientBuilder) {
    b.addInterceptor((request) => this.addCookie(request, "toonily-mature", "1"));
    b.addInterceptor((request) => this.hdCoverInterceptor(request));
    return b;
  }

  protected override mangaSubString = "serie";
  protected override genreDirectory = "genre";
  protected override filterNonMangaItems = false;
  protected override sendViewCount = false;
  protected override chapterMode = ChapterMode.MangaAjax;

  protected override mangaDetailsSelectorDescription = "div.content-area div.summary__content";

  protected override searchCardSelector() {
    return "div.page-item-detail.manga";
  }

  override getSearchMangaList(page: number, query: string, filters: FilterList) {
    return super.getSearchMangaList(page, query.replace(titleSpecialCharactersRegex, " ").trim(), filters);
  }

  override fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean) {
    manga.url = manga.url.replaceAll("/webtoon/", `/${this.mangaSubString}/`);
    return super.fetchMangaUpdate(manga, chapters, fetchDetails, fetchChapters);
  }

  /**
   * keiyoushi's addCookie("toonily-mature" to "1"): on each request for the source's host (or a subdomain) the cookie
   * is (re)set in the jar for that domain, which then sends it.
   */
  private addCookie(request: Request, key: string, value: string): Request {
    const domain = new URL(this.baseUrl).hostname;
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    return request;
  }

  // ponytail: SDK interceptors only rewrite the request (no chain.proceed), so the upstream fallback to the SD cover
  // when the HD one fails is lost. Covers are not fetched through the client today, so this rarely fires.
  private hdCoverInterceptor(request: Request): Request {
    const url = toHttpUrl(request.url);
    const last = url.pathSegments[url.pathSegments.length - 1];
    if (
      url.host.startsWith("static") && // covers are hosted on the static cdn, panels on data cdn
      last != null &&
      sdCoverRegex.test(last)
    ) {
      const newUrl = url
        .newBuilder()
        .removePathSegment(url.pathSegments.length - 1)
        .addPathSegment(last.replace(sdCoverRegex, "$1"))
        .build();
      return { ...request, url: newUrl.toString() };
    }
    return request;
  }
}
