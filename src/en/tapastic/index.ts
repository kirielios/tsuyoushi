// Port of keiyoushi/extensions-source src/en/tapastic/Tapastic.kt
import {
  KeiSource,
  MangasPage,
  Page,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  substringAfterLast,
  toHttpUrl,
  distinctBy,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Request,
  type Response,
  type SChapter,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";
import { chapterListHasNextPage, chapterToSChapter, mangaToSManga, wrapperHasNextPage, wrapperItems, type ChapterDto, type ChapterListDto, type DataWrapper, type WrapperContent } from "./dto.ts";

const LOCKED_CHAPTER_VISIBILITY_PREF = "lockedChapterVisibilityPref";
const SCHEDULED_CHAPTER_VISIBILITY_PREF = "scheduledChapterVisibilityPref";
const SHOW_AUTHORS_NOTES_KEY = "showAuthorsNotes";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0";

export default class Tapastic extends KeiSource {
  private get apiUrl() {
    return `https://story-api.${substringAfterLast(this.baseUrl, "/")}`;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addInterceptor((request) =>
        this.addCookie(request, [
          ["birthDate", "1990-01-01"],
          ["adjustedBirthDate", "1990-01-01"],
        ]),
      )
      .addChainInterceptor(TextInterceptor());
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the source host on every matching request, which then sends them. */
  private addCookie(request: Request, cookies: [string, string][]): Request {
    const domain = new URL(this.baseUrl).hostname;
    const host = new URL(request.url).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${domain}/`, `${key}=${value}; Domain=${domain}; Path=/`);
    }
    return request;
  }

  protected override configureHeaders(headers: Headers) {
    headers.set("Referer", "https://m.tapas.io");
    headers.set("User-Agent", USER_AGENT);
    return headers;
  }

  // ============================== Popular ===================================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/cosmos/api/v1/landing/ranking`)
      .newBuilder()
      .addQueryParameter("category_type", "COMIC")
      .addQueryParameter("subtab_id", "17")
      .addQueryParameter("size", "25")
      .addQueryParameter("page", String(page - 1))
      .build();

    return this.parseMangaList(await this.client.get(url.toString()));
  }

  private parseMangaList(response: Response): MangasPage {
    const dto = response.parseAs<DataWrapper<WrapperContent>>();
    const mangas = wrapperItems(dto).map(mangaToSManga);
    return new MangasPage(mangas, wrapperHasNextPage(dto));
  }

  // ============================== Latest ====================================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/cosmos/api/v1/landing/genre`)
      .newBuilder()
      .addQueryParameter("category_type", "COMIC")
      .addQueryParameter("sort_option", "NEWEST_EPISODE")
      .addQueryParameter("subtab_id", "17")
      .addQueryParameter("pageSize", "25")
      .addQueryParameter("page", String(page - 1))
      .build();

    return this.parseMangaList(await this.client.get(url.toString()));
  }

  // ============================== Search ====================================

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("pageNumber", String(page)).addQueryParameter("q", query).addQueryParameter("t", "COMICS").build();
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select(".search-item-wrap").map((element) => {
      const manga = SManga.create();
      manga.title = element.select(".item__thumb img").first()?.attr("alt") ?? element.select(".title-section .title a").text();
      manga.thumbnail_url = element.select(".item__thumb img, .thumb-wrap img").attr("src");
      manga.description = element.selectFirst(".desc.force.mbm")?.text();
      manga.url = "/series/" + element.selectFirst(".item__thumb a, .title-section .title a")!.attr("data-series-id");
      return manga;
    });

    return new MangasPage(mangas, document.selectFirst("a[class*=paging__button--next]") != null);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (url.hostname !== new URL(this.baseUrl).hostname || segments[0] !== "series") {
      return null;
    }

    const slug = segments[1];
    if (slug === undefined) throw new Error("IndexOutOfBoundsException");
    let mangaUrl: string;
    if (/^[+-]?\d+$/.test(slug)) {
      mangaUrl = `/series/${slug}`;
    } else {
      const document = (await this.client.get(url)).asJsoup();
      const content = document.selectFirst("meta[content^=tapastic://series]")?.attr("content");
      if (content == null) return null;
      mangaUrl = `/series/${substringAfterLast(content, "/")}`;
    }

    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  // ============================== Updates ===================================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}/info`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [newManga, newChapters] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(newManga, newChapters);
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = SManga.create();
    details.title = document.selectFirst(".info__right .title")!.text();
    details.thumbnail_url = document.selectFirst(".thumb.js-thumbnail img")?.absUrl("src");
    // buildString { append(nullable String) } appends "null" for a missing element
    let description = String(document.selectFirst(".description__body")?.text() ?? null);
    const type = document.selectFirst('.stats > a[href^="/static-landing/genre?category="]')?.text();
    if (type != null) description += `\n\nType: ${type}\n`;
    const colophon = document.selectFirst(".colophon")?.wholeText();
    if (colophon != null) description += `\n\n${colophon.replace(new RegExp(`^${details.title}\\s*?(?:\\(Novel\\)|\\(Comic\\))?\\n\\s*`, "i"), "")}\n`;
    details.description = description;

    details.genre = distinctBy(
      document.select(".genre-btn").map((it) => it.text()),
      (it) => it,
    ).join(", ");

    details.author = document
      .select(".creator-section .name")
      .map((it) => it.text())
      .join(", ");

    const statusText = document.selectFirst(".schedule-ico:has(.sp-ico-updated-line-pwt) + .schedule-label")?.text();
    if (statusText != null) {
      const s = statusText.toLowerCase();
      if (s.includes("updates")) details.status = SManga.ONGOING;
      else if (s.includes("completed")) details.status = SManga.COMPLETED;
      else details.status = SManga.UNKNOWN;
    }
    return details;
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    let page = 1;
    const chapters: SChapter[] = [];
    let dto: DataWrapper<ChapterListDto>;
    do {
      const url = toHttpUrl(`${this.baseUrl}${manga.url}/episodes`)
        .newBuilder()
        .addQueryParameter("page", String(page++))
        .addQueryParameter("sort", "NEWEST")
        .addQueryParameter("since", String(Date.now()))
        .addQueryParameter("large", "true")
        .addQueryParameter("last_access", "0")
        .addQueryParameter("", "") // make the same request as the browser
        .build();
      const response = await this.client.get(url.toString());
      dto = response.parseAs<DataWrapper<ChapterListDto>>();
      chapters.push(...dto.data.episodes.filter((it) => this.isPaywalledVisible(it) && this.isScheduledVisible(it)).map(chapterToSChapter));
    } while (chapterListHasNextPage(dto.data));

    return chapters;
  }

  private isPaywalledVisible(c: ChapterDto) {
    return this.showLockedChapterPref || c.unlocked || c.free;
  }

  private isScheduledVisible(c: ChapterDto) {
    return this.showScheduledChapterPrefer || !c.scheduled;
  }

  // ============================== Pages =====================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();

    // check if the "Style" button is in the toolbar, because it is even present on locked chapters, so even those are detected correctly
    const isNovel = document.selectFirst('.toolbar a[data-type="style"]') != null;
    if (isNovel) {
      throw new Error("This is not a comic, but a novel chapter");
    }

    const pages = document.select("img.content__img").map((img, i) => new Page(i, "", img.hasAttr("data-src") ? img.attr("abs:data-src") : img.attr("abs:src")));

    if (this.showAuthorsNotesPref) {
      const episodeStory = document.select("p.js-episode-story").html();

      if (episodeStory.length > 0) {
        const creator = document.selectFirst("a.name.js-fb-tracking")!.text();
        pages.push(new Page(pages.length, "", TextInterceptorHelper.createUrl(`Author's Notes from ${creator}`, episodeStory)));
      }
    }

    if (pages.length === 0) throw new Error("Chapter locked");
    return pages;
  }

  // ============================== Settings ==================================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const locked = new SwitchPreferenceCompat(screen.context);
    locked.key = LOCKED_CHAPTER_VISIBILITY_PREF;
    locked.title = "Show paywalled chapters";
    locked.summary = "Tapas requires login/payment for some chapters. Enable to always show paywalled chapters. " + "Hiding chapters with paid access will also hide scheduled chapters.";
    locked.setDefaultValue(true);
    screen.addPreference(locked);

    const scheduled = new SwitchPreferenceCompat(screen.context);
    scheduled.key = SCHEDULED_CHAPTER_VISIBILITY_PREF;
    scheduled.title = "Show scheduled chapters";
    scheduled.summary = "Scheduled chapters can be hidden from the chapter list by enabling this option.";
    scheduled.setDefaultValue(true);
    screen.addPreference(scheduled);

    const notes = new SwitchPreferenceCompat(screen.context);
    notes.key = SHOW_AUTHORS_NOTES_KEY;
    notes.title = "Show author's notes";
    notes.summary = "Enable to see the author's notes at the end of chapters (if they're there).";
    notes.setDefaultValue(true);
    screen.addPreference(notes);
  }

  private get showLockedChapterPref(): boolean {
    return this.preferences.getBoolean(LOCKED_CHAPTER_VISIBILITY_PREF, true);
  }

  private get showScheduledChapterPrefer(): boolean {
    return this.preferences.getBoolean(SCHEDULED_CHAPTER_VISIBILITY_PREF, true);
  }

  private get showAuthorsNotesPref(): boolean {
    return this.preferences.getBoolean(SHOW_AUTHORS_NOTES_KEY, true);
  }
}
