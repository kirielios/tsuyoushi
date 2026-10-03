// Port of keiyoushi/extensions-source src/en/mehgazone/Mehgazone.kt
// Also ports interceptors/BasicAuthInterceptor.kt. The preference dialogs' link text (dialogMessage) has no
// counterpart in the app's preference model and is left out.
import {
  Base64,
  DateTimeFormatter,
  EditTextPreference,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseAs,
  parseHtml,
  substringBefore,
  toHttpUrl,
  type ClientBuilder,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Request,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";
import type { ChapterListDto, PageListDto } from "./dto.ts";

const thumbnailRegex = /^\/[^/]+-([0-9]+\.png)$/i;
const thumbnailReplaceRegex = /\/[^/]+-([0-9]+\.png)$/i;

const WORDPRESS_USERNAME_PREF_KEY = "WORDPRESS_USERNAME";
const WORDPRESS_USERNAME_PREF_TITLE = "WordPress username";
const WORDPRESS_USERNAME_PREF_SUMMARY = "The WordPress username";
const WORDPRESS_USERNAME_PREF_DEFAULT_VALUE = "";

const WORDPRESS_APP_PASSWORD_PREF_KEY = "WORDPRESS_APP_PASSWORD";
const WORDPRESS_APP_PASSWORD_PREF_TITLE = "WordPress app password";
const WORDPRESS_APP_PASSWORD_PREF_SUMMARY = "The WordPress app password (not your account password)";
const WORDPRESS_APP_PASSWORD_PREF_DEFAULT_VALUE = "";

export default class Mehgazone extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(TextInterceptor()).addInterceptor((request) => this.basicAuth(request));
  }

  /** BasicAuthInterceptor: WordPress REST calls carry the configured username / app password (read live, as its preference listeners keep it in sync). */
  private basicAuth(request: Request): Request {
    const user = this.preferences.getString(WORDPRESS_USERNAME_PREF_KEY, WORDPRESS_USERNAME_PREF_DEFAULT_VALUE);
    const password = this.preferences.getString(WORDPRESS_APP_PASSWORD_PREF_KEY, WORDPRESS_APP_PASSWORD_PREF_DEFAULT_VALUE);
    if (!new URL(request.url).pathname.includes("/wp-json/wp/v2/") || !user?.trim() || !password?.trim()) return request;

    // Credentials.basic: "user:password" in ISO-8859-1
    const latin1 = Uint8Array.from(`${user}:${password}`, (c) => c.charCodeAt(0) & 0xff);
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Basic ${Base64.encode(latin1)}`);
    return { ...request, headers };
  }

  private readonly uploadDateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.US);

  /** Parser.unescapeEntities(s, false) */
  private unescape(s: string): string {
    return parseHtml(this.host.load, `<textarea>${s.replaceAll("</textarea", "&lt;/textarea")}</textarea>`, this.baseUrl).selectFirst("textarea")!.wholeText();
  }

  override getMangaUrl(manga: SManga) {
    return manga.url;
  }

  /** Elements.selectFirst(cssQuery, roots) backport: the first match under (or at) each root, in order. */
  private selectFirstBackport(roots: Element[], cssQuery: string): Element | null {
    for (const root of roots) {
      const first = root.selectFirst(cssQuery);
      if (first != null) return first;
    }
    return null;
  }

  private nextElementSiblings(el: Element): Element[] {
    const out: Element[] = [];
    for (let s = el.nextElementSibling(); s != null; s = s.nextElementSibling()) out.push(s);
    return out;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const mangas = document
      .selectFirst("#main aside.primary-sidebar .sidebar-group")!
      .select("h2")
      .filter((el) => el.text().toLowerCase().includes("latest"))
      .map((it) => {
        const manga = SManga.create();
        manga.title = this.unescape(it.text().split('"')[1]);
        const siblings = this.nextElementSiblings(it);
        manga.url = toHttpUrl(this.selectFirstBackport(siblings, "a[href*='/feed']")!.attr("href")).resolve("/")!.toString();
        manga.thumbnail_url = this.selectFirstBackport(siblings, "img")!.attr("src");
        return manga;
      });
    return new MangasPage(mangas, false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage(
      (await this.getPopularManga(0)).mangas.filter((m) => m.title.includes(query)),
      false,
    );
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.fetchMangaDetails(manga) : null;
    const chapterList = fetchChapters ? await this.fetchChapterList(manga.url) : chapters;

    return new SMangaUpdate((await details) ?? manga, chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const html = (await this.client.get(manga.url)).asJsoup();

    manga.title = this.unescape(html.selectFirst("head title")!.text());
    manga.author = "Patricia Barton";
    manga.status = SManga.ONGOING;
    const src = html
      .select("#content img[src*='.png']")
      .find((it) => thumbnailRegex.test(it.attr("src")))
      ?.attr("src");
    manga.thumbnail_url = src?.replace(thumbnailReplaceRegex, "/$1");
    return manga;
  }

  private chapterListUrl(url: string, page: number) {
    return `${url}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,date_gmt,excerpt`;
  }

  private hasNextPage(totalPages: string | null, responseSize: number, page: number): boolean {
    if (totalPages == null) return responseSize === 100;
    return page < Number.parseInt(totalPages, 10);
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  private async fetchChapterList(mangaUrl: string): Promise<SChapter[]> {
    const apiResponse: ChapterListDto[] = [];

    let page = 0;
    let more: boolean;
    do {
      page++;
      const response = await this.client.get(this.chapterListUrl(mangaUrl, page));
      const totalPages = response.header("X-Wp-Totalpages");
      const pageResponse = response.parseAs<ChapterListDto[]>();

      apiResponse.push(...pageResponse);
      more = this.hasNextPage(totalPages, pageResponse.length, page);
    } while (more);

    const seen = new Set<number>();
    return apiResponse
      .filter((it) => !it.excerpt.rendered.includes("Unlock with Patreon"))
      .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
      .sort((a, b) => (a.date_gmt < b.date_gmt ? -1 : a.date_gmt > b.date_gmt ? 1 : 0))
      .map((it, i) => {
        const chapter = SChapter.create();
        chapter.url = `${mangaUrl}/?p=${it.id}`;
        chapter.name = this.unescape(it.title.rendered) || substringBefore(it.date_gmt, "T");
        chapter.date_upload = this.uploadDateFormat.tryParseDateTime(it.date_gmt);
        chapter.chapter_number = i;
        return chapter;
      })
      .reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = toHttpUrl(chapter.url);
    const pageListBuilder = HttpUrl.parse(chapterUrl.resolve("/wp-json/wp/v2/posts?per_page=1&_fields=link,content,excerpt,date,title")!.toString()).newBuilder();
    const p = chapterUrl.queryParameter("p");
    // removeAllQueryParameters + setQueryParameter(null) semantics: null removes
    if (p == null) pageListBuilder.removeAllQueryParameters("include");
    else pageListBuilder.setQueryParameter("include", p);
    const pageListUrl = pageListBuilder.build();

    const apiResponse = (await this.client.get(pageListUrl.toString())).parseAs<PageListDto[]>()[0];
    if (!apiResponse) throw new Error("List is empty.");

    const content = parseHtml(this.host.load, apiResponse.content.rendered, apiResponse.link);

    const images = content.select("img").map((it, i) => new Page(i, "", it.attr("src")));

    if (apiResponse.excerpt.rendered.trim()) {
      images.push(new Page(images.length, "", TextInterceptorHelper.createUrl("", parseHtml(this.host.load, this.unescape(apiResponse.excerpt.rendered), this.baseUrl).text())));
    }

    return images;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const name = this.preferences.getString(WORDPRESS_USERNAME_PREF_KEY, WORDPRESS_USERNAME_PREF_DEFAULT_VALUE)!;
    const user = new EditTextPreference(screen.context);
    user.key = WORDPRESS_USERNAME_PREF_KEY;
    user.title = WORDPRESS_USERNAME_PREF_TITLE;
    user.summary = name.trim() ? name : WORDPRESS_USERNAME_PREF_SUMMARY;
    user.setDefaultValue(WORDPRESS_USERNAME_PREF_DEFAULT_VALUE);
    screen.addPreference(user);

    const pwd = this.preferences.getString(WORDPRESS_APP_PASSWORD_PREF_KEY, WORDPRESS_APP_PASSWORD_PREF_DEFAULT_VALUE)!;
    const password = new EditTextPreference(screen.context);
    password.key = WORDPRESS_APP_PASSWORD_PREF_KEY;
    password.title = WORDPRESS_APP_PASSWORD_PREF_TITLE;
    password.summary = pwd.trim() ? "●".repeat(pwd.length) : WORDPRESS_APP_PASSWORD_PREF_SUMMARY;
    password.setDefaultValue(WORDPRESS_APP_PASSWORD_PREF_DEFAULT_VALUE);
    screen.addPreference(password);
  }
}
