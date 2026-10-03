// Port of keiyoushi/extensions-source src/en/vizshonenjump/Viz.kt
import {
  DateTimeFormatter,
  GET,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  ZoneOffset,
  parseAs,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { imageInterceptor } from "./interceptor.ts";

// Dto.kt
interface Dto {
  ok?: number | null;
  data: unknown;
}

const DATE_FORMATTER = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);
const HIDE_LOCKED_PREF_KEY = "hide_locked";

const isFloat = (s: string) => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(s);

export default class Viz extends KeiSource {
  private get servicePath() {
    return this.name.includes("Shonen Jump") ? "shonenjump" : "vizmanga";
  }
  private get searchPath() {
    return this.name.includes("Shonen Jump") ? "SjChapterSeries" : "VmChapterSeries";
  }
  private get subscriber() {
    return this.name.includes("Shonen Jump") ? "is_sj_subscriber" : "is_vm_subscriber";
  }

  private loggedIn: boolean | null = null;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(imageInterceptor(this.host)).addChainInterceptor(async (chain) => {
      const response = await chain.proceed(chain.request());
      if (new URL(response.url).pathname === `/${this.servicePath}`) {
        throw new Error("This service is not available in your country.");
      }
      return response;
    });
  }

  // ============================== Popular ==============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/manga-books/${this.servicePath}/section/trending-manga`);
    return this.parseMangaPage(response);
  }

  private parseMangaPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const sortKey = (it: Element) => {
      const v = it.parent()?.attr("data-sort-recent");
      return v == null ? Number.NEGATIVE_INFINITY : Number.parseInt(v, 10);
    };
    // sortedBy is stable, like Array.prototype.sort
    const mangas = [...document.select("div.o_sortable > a.o_chapters-link")].sort((a, b) => sortKey(a) - sortKey(b)).map((it) => this.mangaFromElement(it));
    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/manga-books/${this.servicePath}/section/free-chapters`);
    return this.parseMangaPage(response);
  }

  // ============================== Search ===============================

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("search", query).addQueryParameter("category", this.searchPath).build();
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document
      .select("div.p-cs-tile a.o_property-link")
      .map((it) => this.mangaFromElement(it))
      .filter((manga) => manga.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(mangas, false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const service = pathSegments[0];
    const seriesSlug = pathSegments[2];

    if (service !== this.servicePath) return null;

    const manga = SManga.create();
    manga.url = seriesSlug;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    return result;
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.selectFirst("div.pad-x-rg")!.text();
    manga.thumbnail_url = element.selectFirst("div.pos-r img.disp-bl")?.absUrl("data-original");
    manga.url = urlWithoutDomain(toHttpUrl(element.absUrl("href")).pathSegments[2]);
    return manga;
  }

  // ============================== Updates ==============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${this.servicePath}/chapters/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const chapterId = chapter.memo.id;
    if (typeof chapterId !== "string") throw new Error("Refresh chapter list");
    const slug = chapter.memo.slug as string;
    return `${this.baseUrl}/${this.servicePath}/${slug}/chapter/${chapterId}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const seriesIntro = document.selectFirst("section#series-intro")!;
    const sManga = SManga.create();
    sManga.url = manga.url;
    sManga.title = seriesIntro.selectFirst("h2")!.text();
    sManga.author = seriesIntro.selectFirst("span.disp-bl--bm")?.text().replace("Created by ", "");
    sManga.description = seriesIntro.selectFirst("h2 + div")?.text();
    sManga.thumbnail_url = document.selectFirst("meta[property=og:image]")?.absUrl("content") ?? document.selectFirst("section.section_chapters td a > img")?.absUrl("data-original");

    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);

    const elements = document.select("section.section_chapters a.o_chapter-container[id^=ch-]");
    if (elements.isEmpty()) {
      if (document.selectFirst("section.section_static") != null) {
        throw new Error("This service is not available in your country.");
      }
    }

    const isSubscriber = await this.checkIfIsLoggedIn();

    const chapterList: SChapter[] = [];
    for (const it of elements) {
      const urlStr = it.absUrl("data-target-url");
      if (!urlStr.trim()) continue;

      const isMarkupLocked = urlStr.startsWith("javascript");
      const isLocked = isMarkupLocked && !isSubscriber;
      if (hideLocked && isLocked) continue;

      const lock = isLocked ? "🔒 " : "";
      const dateTable = it.selectFirst("div:nth-child(1) table");

      const chapter = SChapter.create();
      if (dateTable == null) {
        chapter.name = lock + it.text();
      } else {
        chapter.name = lock + (it.selectFirst("div:nth-child(2) table")?.selectFirst("td")?.text() ?? "Oneshot");
        const dateStr = dateTable.selectFirst("td[align=right], td > span")?.text();
        if (dateStr != null) chapter.date_upload = DATE_FORMATTER.tryParseDate(dateStr, ZoneOffset.UTC);
      }

      const num = substringBefore(substringAfter(chapter.name, "Ch. "), ":").trim();
      chapter.chapter_number = isFloat(num) ? Number.parseFloat(num) : -1;
      const cleanUrl = isMarkupLocked ? substringBeforeLast(substringAfter(urlStr, ",'"), "'") : urlStr;
      const absoluteUrl = cleanUrl.startsWith("http") ? cleanUrl : `${this.baseUrl}${cleanUrl}`;
      const paths = toHttpUrl(absoluteUrl).pathSegments;
      chapter.url = `${paths[3]}#${paths[1]}`;
      chapter.memo = { id: paths[3], slug: paths[1] };
      chapterList.push(chapter);
    }
    chapterList.sort((a, b) => b.chapter_number - a.chapter_number);

    return new SMangaUpdate(sManga, chapterList);
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pageCount = Number.parseInt(substringBefore(substringAfter(document.selectFirst("script:containsData(var pages)")!.data(), "= "), ";"), 10);
    if (Number.isNaN(pageCount)) throw new Error("For input string");

    await this.checkIfIsLoggedIn();
    const chapterId = chapter.memo.id;
    if (typeof chapterId !== "string") throw new Error("Refresh chapter list");
    const hasAccess = parseAs<Dto>((await this.client.execute(this.pageUrlRequest(chapterId, "0"))).text()).ok;
    if (hasAccess === 0) {
      throw new Error("Log in via WebView and subscribe to the website's service.");
    }

    return Array.from({ length: pageCount + 1 }, (_, it) => new Page(it, `${this.baseUrl}/${chapterId}#${it}`));
  }

  override async getImageUrl(page: Page): Promise<string> {
    const parts = HttpUrl.parse(page.url);
    const chapterId = parts.pathSegments[0];
    const index = parts.fragment!;
    const response = await this.client.execute(this.pageUrlRequest(chapterId, index), true);
    const result = response.parseAs<Dto>();
    return `${String(Object.values(result.data as Record<string, unknown>)[0])}#scramble`;
  }

  // ============================= Utilities =============================

  private pageUrlRequest(chapterId: string, index: string): Request {
    const login = this.loggedIn === true ? "active" : "false";
    const newHeaders = this.headersBuilder();
    newHeaders.set("X-Client-Login", login);

    const pageUrl = toHttpUrl(`${this.baseUrl}/manga/get_manga_url`).newBuilder().addQueryParameter("device_id", "3").addQueryParameter("manga_id", chapterId).addQueryParameter("pages", index).build();

    return GET(pageUrl.toString(), newHeaders);
  }

  private get subcription() {
    return new RegExp(`var ${this.subscriber}\\s*=\\s*(true|false)`);
  }

  private async checkIfIsLoggedIn(): Promise<boolean> {
    try {
      const document = (await this.client.get(`${this.baseUrl}/account/refresh_login_links`)).asJsoup();
      this.loggedIn = (document.selectFirst("div#o_account-links-content")?.attr("logged_in")?.toLowerCase() ?? "false") === "true";

      const data = document.selectFirst(`script:containsData(${this.subscriber})`)?.data();
      const m = data === undefined ? null : this.subcription.exec(data);
      return m ? m[1] === "true" : false;
    } catch {
      this.loggedIn = false;
      return false;
    }
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
