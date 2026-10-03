// Port of keiyoushi/extensions-source lib-multisrc/madara/MadaraBase.kt
import {
  Base64,
  DateTimeFormatter,
  Intl,
  KeiSource,
  Locale,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneOffset,
  aesCbcDecrypt,
  ago,
  allDigits,
  distinctBy,
  escapeRegex,
  evpBytesToKey,
  fromUtf8,
  hexBytes,
  ifBlank,
  notBlank,
  startOfDayUtc,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  trimEnd,
  utf8,
  type Document,
  type Element,
  type Response,
} from "../../sdk/index.ts";
import { genreRoutes, type ChapterProtectorData, type GenreRoute } from "./filters.ts";
import { messages } from "./messages.ts";

export enum ChapterMode {
  MangaPage,
  AdminAjax,
  MangaAjax,
  MangaAjaxPaginated,
  MangaAjaxQuery,
}

export class SearchCard {
  constructor(
    readonly title: string,
    readonly path: string,
    readonly thumbnail: string | null | undefined,
  ) {}
}

const lastSegment = (path: string) => trimEnd(path, "/").split("/").pop() ?? "";
const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};

const GENERIC_GENRES = new Set(["manga", "manhwa", "manhua", "webtoon"]);
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
const IMAGE_DESCRIPTOR_REGEX = /^(\d+|\d+\.\d+)[wx]$/;
const NUMBER_REGEX = /\d+/;
// Keywords must not be preceded by a letter, otherwise "ay" matches inside "mayıs", "may" and "days"
const wordRegex = (...words: string[]) => new RegExp(`(?<!\\p{L})(?:${words.map(escapeRegex).join("|")})`, "u");
const YEAR_WORDS = wordRegex("year", "año", "ano", "năm", "yıl", "سنة", "سنوات");
const MONTH_WORDS = wordRegex("month", "mes", "tháng", "ay", "شهر", "أشهر", "شهور");
const WEEK_WORDS = wordRegex("week", "semana", "tuần", "hafta", "أسبوع", "أسابيع");
const DAY_WORDS = wordRegex("day", "día", "dia", "jour", "hari", "gün", "ngày", "giorni", "أيام", "天");
const HOUR_WORDS = wordRegex("hour", "hora", "heure", "jam", "saat", "giờ", "ore", "ساعة", "ساعات", "小时");
const MINUTE_WORDS = wordRegex("minute", "minuto", "min", "menit", "dakika", "phút", "دقيقة", "دقائق");
const SECOND_WORDS = wordRegex("second", "segundo", "sec", "detik", "giây", "ثانية", "ثوان");

export abstract class MadaraBase extends KeiSource {
  protected supportsPostId = true;

  protected chapterMode = ChapterMode.MangaPage;
  protected mangaSubString = "manga";
  protected genreDirectory = "manga-genre";
  protected filterNonMangaItems = true;
  protected sendViewCount = true;

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "pt-BR", "es", "uk"], messages });

  protected statusFilterOptions: [string, string][] = [
    [this.intl.get("status_filter_completed"), "end"],
    [this.intl.get("status_filter_ongoing"), "on-going"],
    [this.intl.get("status_filter_canceled"), "canceled"],
    [this.intl.get("status_filter_on_hold"), "on-hold"],
  ];

  protected orderByFilterOptions: [string, string][] = [
    [this.intl.get("order_by_filter_relevance"), ""],
    [this.intl.get("order_by_filter_latest"), "latest"],
    [this.intl.get("order_by_filter_az"), "alphabet"],
    [this.intl.get("order_by_filter_rating"), "rating"],
    [this.intl.get("order_by_filter_trending"), "trending"],
    [this.intl.get("order_by_filter_views"), "views"],
    [this.intl.get("order_by_filter_new"), "new-manga"],
  ];

  protected genreConditionFilterOptions: [string, string][] = [
    [this.intl.get("genre_condition_filter_or"), ""],
    [this.intl.get("genre_condition_filter_and"), "1"],
  ];

  protected adultFilterOptions: [string, string][] = [
    [this.intl.get("adult_content_filter_all"), ""],
    [this.intl.get("adult_content_filter_none"), "0"],
    [this.intl.get("adult_content_filter_only"), "1"],
  ];

  protected get xhrHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("X-Requested-With", "XMLHttpRequest");
    return h;
  }

  override get supportsFilterFetching() {
    return true;
  }
  override get supportsRelatedMangas() {
    return true;
  }

  protected archiveSelector() {
    return "div.page-item-detail, .manga__item, .c-tabs-item__content";
  }
  protected searchCardSelector() {
    return ".c-tabs-item__content";
  }
  protected archiveTitleSelector: string | null = null;
  protected archiveUrlSelector = ".post-title a";
  protected mangaDetailsSelectorTitle = "div.post-title h3, div.post-title h1, #manga-title > h1";
  protected mangaDetailsSelectorAuthor = "div.author-content > a, div.manga-authors > a";
  protected mangaDetailsSelectorArtist = "div.artist-content > a";
  protected mangaDetailsSelectorStatus = "div.summary-content, div.summary-heading:contains(Status) + div";
  protected mangaDetailsSelectorDescription = "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt";
  protected mangaDetailsSelectorThumbnail = "div.summary_image img";
  protected mangaDetailsSelectorGenre = "div.genres-content a";
  protected mangaDetailsSelectorTag = "div.tags-content a";
  protected seriesTypeSelector = ".post-content_item:contains(Type) .summary-content";
  protected altNameSelector = ".post-content_item:contains(Alt) .summary-content";
  protected updatingRegex = /Updating|Atualizando/i;
  protected chapterListSelector() {
    return "li.wp-manga-chapter";
  }
  protected chapterNameSelector: string | null = null;
  protected chapterUrlSelector = "a";
  protected chapterDateSelector = "span.chapter-release-date";
  protected pageListParseSelector = "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item))";
  protected filterGenresSelector = "div.genres";

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/${this.mangaSubString}/`)).asJsoup();
    const routes = document
      .select(this.filterGenresSelector)
      .select(`a[href*='/${this.genreDirectory}/']`)
      .flatMap((element): GenreRoute[] => {
        const href = notBlank(element.attr("abs:href"));
        if (!href) return [];
        const path = new URL(href).pathname;
        const name = notBlank(element.text());
        if (!name) return [];
        const slug = lastSegment(path);
        if (!slug) return [];
        return [{ name, slug, path }];
      });
    return distinctBy(routes, (it) => it.slug);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const document = (await this.client.get(url)).asJsoup();
    let id = "";
    if (this.supportsPostId) {
      const found = this.docMangaId(document);
      if (found == null) return null;
      id = found;
    }
    const manga = this.parseDetails(document, id, null);
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    const path = this.memoPath(manga);
    if (path) return new URL(path, this.baseUrl).href;
    if (!allDigits(manga.url)) return new URL(manga.url, this.baseUrl).href;
    return `${this.baseUrl}/?p=${this.mangaId(manga) ?? manga.url}`;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const id = this.supportsPostId ? this.mangaId(manga) : "";
    const path = this.memoPath(manga);
    const endpointCanUseMemo = this.chapterMode !== ChapterMode.MangaPage && id != null && path != null;
    if (fetchChapters && endpointCanUseMemo && !fetchDetails) {
      return new SMangaUpdate(manga, await this.fetchChapters(path!, id!));
    }
    if (fetchChapters && endpointCanUseMemo && fetchDetails) {
      const [document, chapterList] = await Promise.all([this.getDetailsDocument(manga), this.fetchChapters(path!, id!)]);
      return new SMangaUpdate(this.parseDetails(document, id!, manga.url), chapterList);
    }

    const document = await this.getDetailsDocument(manga);
    const resolvedId = id ?? this.docMangaId(document);
    if (resolvedId == null) throw new Error("Missing Madara post ID");
    const resolvedPath = new URL(document.location()).pathname;
    const updated = this.parseDetails(document, resolvedId, manga.url);
    const updatedChapters = fetchChapters ? await this.fetchChapters(resolvedPath, resolvedId, document) : chapters;
    return new SMangaUpdate(updated, updatedChapters);
  }

  private async getDetailsDocument(manga: SManga): Promise<Document> {
    const document = (await this.getDetailsResponse(manga)).asJsoup();
    this.enqueueViewCount(document);
    return document;
  }

  private async getDetailsResponse(manga: SManga): Promise<Response> {
    let id = this.mangaId(manga);
    const path = this.memoPath(manga) ?? (allDigits(manga.url) ? null : manga.url);
    if (path != null) {
      const requestedUrl = new URL(path, this.baseUrl).href;
      const response = await this.client.get(requestedUrl, undefined, { ensureSuccess: false });
      if (response.isSuccessful && sameUrl(response.url, requestedUrl)) return response;
      const redirectedId = id == null ? this.docMangaId(response.asJsoup()) : null;
      id = id ?? redirectedId;
    }
    if (id == null) throw new Error("Missing Madara post ID");
    return this.client.get(`${this.baseUrl}/?p=${id}`);
  }

  protected parseDetails(document: Document, id: string, preserveUrl: string | null): SManga {
    const manga = SManga.create();
    const mangaPath = new URL(document.location()).pathname;
    const keepUrl = preserveUrl != null && !allDigits(preserveUrl);
    manga.url = this.supportsPostId ? (keepUrl ? preserveUrl! : id) : mangaPath;
    manga.title = document.selectFirst(this.mangaDetailsSelectorTitle)!.ownText();
    manga.author = ifBlank(document.select(this.mangaDetailsSelectorAuthor).eachText().filter((it) => !this.isUpdating(it)).join(", "), undefined);
    manga.artist = ifBlank(document.select(this.mangaDetailsSelectorArtist).eachText().filter((it) => !this.isUpdating(it)).join(", "), undefined);
    const descriptionElement = document.selectFirst(this.mangaDetailsSelectorDescription);
    if (descriptionElement) {
      const paragraphs = descriptionElement.select("p");
      manga.description = paragraphs.length ? paragraphs.map((it) => it.text()).join("\n\n") : descriptionElement.text();
    }
    const alternative = document.selectFirst(this.altNameSelector)?.ownText();
    if (alternative && !this.isUpdating(alternative)) {
      manga.description = [manga.description, `${this.intl.get("alt_names_heading")} ${alternative}`].filter((it) => it != null).join("\n\n");
    }
    const thumbnail = document.selectFirst(this.mangaDetailsSelectorThumbnail);
    manga.thumbnail_url = thumbnail ? (this.processThumbnail(this.imageFromElement(thumbnail)) ?? undefined) : undefined;
    const statusText = document.select(this.mangaDetailsSelectorStatus).last()?.text();
    manga.status = statusText != null ? this.toStatus(statusText) : SManga.UNKNOWN;
    const genres = document.select(this.mangaDetailsSelectorGenre).flatMap((element): GenreRoute[] => {
      const href = notBlank(element.attr("abs:href"));
      if (!href) return [];
      const path = new URL(href).pathname;
      const slug = lastSegment(path);
      if (!slug) return [];
      return [{ name: element.text(), slug, path }];
    });
    const type = notBlank(document.selectFirst(this.seriesTypeSelector)?.text() ?? undefined);
    manga.genre = ifBlank(
      distinctBy([...genres.map((it) => it.name), ...document.select(this.mangaDetailsSelectorTag).eachText(), ...(type ? [type] : [])], (it) => it.toLowerCase()).join(", "),
      undefined,
    );
    manga.memo = this.mangaMemo(mangaPath, genres, keepUrl ? id : null);
    return manga;
  }

  protected fetchChapters(mangaPath: string, id: string, mangaPage: Document | null = null): Promise<SChapter[]> {
    switch (this.chapterMode) {
      case ChapterMode.MangaPage:
        return Promise.resolve(this.fetchMangaPageChapters(mangaPath, mangaPage));
      case ChapterMode.AdminAjax:
        return this.fetchAdminAjaxChapters(mangaPath, id);
      case ChapterMode.MangaAjax:
        return this.fetchMangaAjaxChapters(mangaPath);
      case ChapterMode.MangaAjaxPaginated:
        return this.fetchPaginatedChapters(mangaPath);
      case ChapterMode.MangaAjaxQuery:
        return this.fetchQueryChapters(mangaPath);
    }
  }

  private fetchMangaPageChapters(mangaPath: string, mangaPage: Document | null): SChapter[] {
    if (!mangaPage) throw new Error("Manga page is required for this chapter mode");
    return this.parseChapterList(mangaPage, mangaPath);
  }

  private async fetchAdminAjaxChapters(mangaPath: string, id: string): Promise<SChapter[]> {
    const body = new URLSearchParams({ action: "manga_get_chapters", manga: id });
    return this.parseChapterList((await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.xhrHeaders, body)).asJsoup(), mangaPath);
  }

  private async fetchMangaAjaxChapters(mangaPath: string): Promise<SChapter[]> {
    return this.parseChapterList((await this.client.post(this.chapterAjaxUrl(mangaPath), this.xhrHeaders, new URLSearchParams())).asJsoup(), mangaPath);
  }

  private async fetchPaginatedChapters(mangaPath: string): Promise<SChapter[]> {
    const result: SChapter[] = [];
    let lastUrl: string | null = null;
    for (let page = 1; ; page++) {
      const response = await this.client.post(`${this.chapterAjaxUrl(mangaPath)}?t=${page}`, this.xhrHeaders, new URLSearchParams(), { ensureSuccess: false });
      if (response.code === 404) return result;
      if (!response.isSuccessful) throw new Error(`HTTP error ${response.code}`);
      const chapters = this.parseChapterList(response.asJsoup(), mangaPath);
      if (!chapters.length || chapters[chapters.length - 1].url === lastUrl) break;
      result.push(...chapters);
      lastUrl = chapters[chapters.length - 1].url;
    }
    return result;
  }

  private async fetchQueryChapters(mangaPath: string): Promise<SChapter[]> {
    const slug = lastSegment(mangaPath);
    const body = new URLSearchParams({ "manga-core": slug, manga_ajax: "1", maction: "get_chapters" });
    return this.parseChapterList((await this.client.post(`${this.baseUrl}/index.php`, this.xhrHeaders, body)).asJsoup(), mangaPath);
  }

  private chapterAjaxUrl(mangaPath: string) {
    return `${this.baseUrl}${trimEnd(mangaPath, "/")}/ajax/chapters/`;
  }

  /** Kotlin's Element.postId() extension. */
  protected postId(element: Element): string | null {
    return element.selectFirst("[data-post-id]")?.attr("data-post-id") ?? null;
  }

  protected parseArchive(document: Document): SManga[] {
    return document.select(this.archiveSelector()).flatMap((element) => {
      let id = "";
      if (this.supportsPostId) {
        const found = notBlank(element.attr("data-post-id")) ?? notBlank(this.postId(element));
        if (!found) return [];
        id = found;
      }
      const manga = this.archiveManga(element, id);
      return manga ? [manga] : [];
    });
  }

  protected archiveManga(element: Element, id: string): SManga | null {
    const link = element.selectFirst(this.archiveUrlSelector);
    if (!link) return null;
    const href = notBlank(link.attr("abs:href"));
    if (!href) return null;
    const mangaPath = new URL(href).pathname;
    const manga = SManga.create();
    manga.url = id && this.supportsPostId ? id : mangaPath;
    manga.title = (this.archiveTitleSelector != null ? element.selectFirst(this.archiveTitleSelector)?.text() : undefined) ?? link.text();
    const img = element.selectFirst("img");
    manga.thumbnail_url = img ? (this.processThumbnail(this.imageFromElement(img), true) ?? undefined) : undefined;
    manga.memo = this.mangaMemo(mangaPath, []);
    return manga;
  }

  protected parseSearchCards(document: Document): SearchCard[] {
    return document.select(this.searchCardSelector()).flatMap((element) => {
      const link = element.selectFirst(this.archiveUrlSelector);
      if (!link) return [];
      const href = notBlank(link.attr("abs:href"));
      if (!href) return [];
      const title = (this.archiveTitleSelector != null ? element.selectFirst(this.archiveTitleSelector)?.text() : undefined) ?? link.text();
      const img = element.selectFirst("img");
      return [new SearchCard(title, new URL(href).pathname, img ? this.processThumbnail(this.imageFromElement(img), true) : null)];
    });
  }

  protected parseChapterList(document: Document, mangaPath: string): SChapter[] {
    return document.select(this.chapterListSelector()).flatMap((it) => {
      const chapter = this.chapterFromElement(it, mangaPath);
      return chapter ? [chapter] : [];
    });
  }

  protected chapterFromElement(element: Element, mangaPath: string): SChapter | null {
    const link = element.selectFirst(this.chapterUrlSelector);
    if (!link) return null;
    const url = notBlank(link.attr("abs:href"));
    if (!url) return null;
    const slug = lastSegment(new URL(url).pathname);
    if (!slug) return null;
    const chapter = SChapter.create();
    chapter.url = slug;
    chapter.name = (this.chapterNameSelector != null ? element.selectFirst(this.chapterNameSelector)?.text() : undefined) ?? link.text();
    chapter.date_upload = this.parseChapterDate(
      notBlank(element.selectFirst("img:not(.thumb)")?.attr("alt")) ?? notBlank(element.selectFirst("span a")?.attr("title")) ?? element.selectFirst(this.chapterDateSelector)?.text() ?? null,
    );
    chapter.memo = { mangaPath };
    return chapter;
  }

  override getChapterUrl(chapter: SChapter): string {
    if (chapter.url.includes("/")) throw new Error("Refresh the chapter list.");
    const mangaPath = chapter.memo?.mangaPath;
    if (typeof mangaPath !== "string") throw new Error("Refresh the chapter list.");
    return `${this.baseUrl}${trimEnd(mangaPath, "/")}/${chapter.url}/`;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const first = await this.fetchChapterDocument(chapterUrl);
    let document = first;
    if (first.selectFirst("#single-pager") != null) {
      const url = new URL(chapterUrl);
      url.searchParams.append("style", "list");
      document = (await this.client.get(url)).asJsoup();
    }
    this.enqueueViewCount(document);
    return this.parsePages(document);
  }

  protected async fetchChapterDocument(chapterUrl: string): Promise<Document> {
    return (await this.client.get(chapterUrl)).asJsoup();
  }

  private enqueueViewCount(document: Document) {
    if (!this.sendViewCount) return;
    const raw = notBlank(substringBeforeLast(substringAfter(document.selectFirst("script#wp-manga-js-extra")?.data() ?? "", "var manga = ", ""), ";"));
    if (!raw) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (String(data.enable_manga_view) !== "1") return;
    const mangaId = notBlank(data.manga_id == null ? undefined : String(data.manga_id));
    if (!mangaId) return;
    const body = new URLSearchParams({ action: "manga_views", manga: mangaId });
    if (data.chapter_slug != null) body.append("chapter", String(data.chapter_slug));
    const headers = this.headersBuilder();
    headers.set("Referer", document.location());
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    this.client.enqueue({ url: `${this.baseUrl}/wp-admin/admin-ajax.php`, method: "POST", headers, body: body.toString() });
  }

  /** Async here (WebCrypto), where upstream is synchronous. */
  protected async parsePages(document: Document): Promise<Page[]> {
    const protector = document.selectFirst("#chapter-protector-data");
    if (protector == null) {
      return document.select(this.pageListParseSelector).flatMap((element, index) => {
        const img = element.selectFirst("img");
        const url = img ? this.imageFromElement(img) : null;
        return url ? [new Page(index, document.location(), url)] : [];
      });
    }
    const src = protector.attr("src");
    const script = src.startsWith("data:text/javascript;base64,") ? fromUtf8(Base64.decode(substringAfter(src, ","))) : protector.html();
    const password = substringBefore(substringAfter(script, "wpmangaprotectornonce='"), "';");
    const encrypted = substringBefore(substringAfter(script, "chapter_data='"), "';").replaceAll("\\/", "/");
    const objectData = JSON.parse(encrypted) as ChapterProtectorData;
    const raw = await this.decryptChapterData(objectData, password);
    return (JSON.parse(JSON.parse(raw) as string) as string[]).map((image, index) => new Page(index, document.location(), image));
  }

  private async decryptChapterData(data: ChapterProtectorData, password: string): Promise<string> {
    const { key, iv } = evpBytesToKey(utf8(password), hexBytes(data.s));
    return fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(data.ct)));
  }

  /** The chapter page is the image Referer. */
  override imageRequest(page: Page) {
    const request = super.imageRequest(page);
    request.headers.set("Referer", page.url);
    return request;
  }

  protected imageFromElement(element: Element): string | null {
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("data-lzl-src")) return element.attr("abs:data-lzl-src");
    if (element.hasAttr("data-cfsrc")) return element.attr("abs:data-cfsrc");
    if (element.hasAttr("data-manga-src")) return element.attr("abs:data-manga-src");
    if (element.hasAttr("srcset")) return this.getSrcSetImage(element.attr("abs:srcset"));
    return element.attr("abs:src");
  }

  protected processThumbnail(url: string | null, _fromSearch = false): string | null {
    return url;
  }

  protected getSrcSetImage(srcset: string): string | null {
    const images = srcset
      .split(",")
      .map((it) => {
        const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(it.trim()); // split(WHITESPACE_REGEX, limit = 2)
        return m ? (m[2] !== undefined ? [m[1], m[2]] : [m[1]]) : [];
      })
      .filter((it) => it.length && URL_REGEX.test(it[0]));
    let best: [string, number] | null = null;
    for (const candidate of images) {
      const m = candidate[1] !== undefined ? IMAGE_DESCRIPTOR_REGEX.exec(candidate[1]) : null;
      const size = m ? Number(m[1]) : NaN;
      if (!Number.isNaN(size) && (!best || size > best[1])) best = [candidate[0], size];
    }
    if (best) return best[0];
    return images.length ? images.map((it) => it[0]).reduce((a, b) => (b > a ? b : a)) : null;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const id = this.mangaId(manga);
    if (id == null) return [];
    const genres = this.relatedGenres(manga);
    if (!genres.length) return [];
    return this.fetchRelatedMangaListByGenres(id, genres);
  }

  /** fetchRelatedMangaList(id, genres) upstream; renamed because TypeScript has no overloads by arity. */
  protected abstract fetchRelatedMangaListByGenres(id: string, genres: GenreRoute[]): Promise<SManga[]>;

  protected memoGenres(manga: SManga): GenreRoute[] {
    return genreRoutes(manga.memo?.genres);
  }

  protected relatedGenres(manga: SManga): GenreRoute[] {
    const genres = this.memoGenres(manga);
    const specific = genres.filter((it) => !GENERIC_GENRES.has(it.slug.toLowerCase()));
    return (specific.length ? specific : genres).slice(0, 3);
  }

  protected mangaId(manga: SManga): string | null {
    if (allDigits(manga.url)) return manga.url;
    const id = manga.memo?.id;
    return id == null ? null : String(id);
  }

  protected memoPath(manga: SManga): string | null {
    const path = manga.memo?.path;
    return path == null ? null : String(path);
  }

  protected mangaMemo(path: string, genres: GenreRoute[], legacyId: string | null = null): Record<string, unknown> {
    return { path, ...(genres.length ? { genres } : {}), ...(legacyId != null ? { id: legacyId } : {}) };
  }

  /** Kotlin's Document.mangaId() extension. */
  protected docMangaId(document: Document): string | null {
    return (
      notBlank(document.selectFirst("[id^=manga-chapters-holder]")?.attr("data-id")) ??
      notBlank(document.selectFirst("input.rating-post-id")?.attr("value")) ??
      notBlank(document.selectFirst("a[data-post]")?.attr("data-post")) ??
      (() => {
        const href = document.selectFirst("link[rel=shortlink]")?.attr("href");
        return href?.includes("?p=") ? notBlank(substringBefore(substringAfter(href, "?p="), "&")) : undefined;
      })() ??
      null
    );
  }

  protected completedStatus = ["completed", "completo", "completado", "concluído", "concluido", "finalizado", "achevé", "terminé", "hoàn thành", "مكتملة", "مكتمل", "已完结", "tamamlandı", "đã hoàn thành", "завершено", "tamamlanan", "complété"];
  protected ongoingStatus = ["ongoing", "on going", "updating", "продолжается", "em lançamento", "em andamento", "en cours", "ativo", "lançando", "đang tiến hành", "còn nữa", "devam ediyor", "in corso", "in arrivo", "مستمرة", "مستمر", "en curso", "emision", "curso", "en marcha", "publicandose", "publicándose", "en emision", "连载中", "đang làm", "em postagem", "devam eden", "em progresso", "atualizações semanais", "виходить"];
  protected hiatusStatus = ["on hold", "hiatus", "pausado", "en espera", "durduruldu", "beklemede", "đang chờ", "متوقف", "en pause", "заморожено", "en attente"];
  protected cancelledStatus = ["canceled", "cancelled", "cancelado", "iptal edildi", "đã hủy", "ملغي", "abandonné", "заброшено", "annulé"];

  /** Kotlin's String.toStatus() extension. */
  protected toStatus(s: string): number {
    const has = (list: string[]) => list.some((it) => s.toLowerCase().includes(it.toLowerCase()));
    if (has(this.completedStatus)) return SManga.COMPLETED;
    if (has(this.ongoingStatus)) return SManga.ONGOING;
    if (has(this.hiatusStatus)) return SManga.ON_HIATUS;
    if (has(this.cancelledStatus)) return SManga.CANCELLED;
    return SManga.UNKNOWN;
  }

  protected chapterDateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

  protected parseChapterDate(date: string | null): number {
    if (date == null) return 0;
    const normalized = date.toLowerCase();
    if (["today", "hoje", "hoy"].some((it) => normalized.startsWith(it))) return startOfDayUtc(0);
    if (["yesterday", "ontem", "ayer", "يوم واحد"].some((it) => normalized.startsWith(it))) return startOfDayUtc(1);
    const amount = NUMBER_REGEX.exec(normalized)?.[0];
    if (amount != null) {
      const unit = YEAR_WORDS.test(normalized)
        ? "years"
        : MONTH_WORDS.test(normalized)
          ? "months"
          : WEEK_WORDS.test(normalized)
            ? "weeks"
            : DAY_WORDS.test(normalized)
              ? "days"
              : HOUR_WORDS.test(normalized)
                ? "hours"
                : MINUTE_WORDS.test(normalized)
                  ? "minutes"
                  : SECOND_WORDS.test(normalized)
                    ? "seconds"
                    : null;
      if (unit != null) return ago(Number(amount), unit);
    }
    return this.chapterDateFormat.tryParseDate(date, ZoneOffset.UTC);
  }

  protected isUpdating(value: string) {
    return this.updatingRegex.test(value);
  }
}
