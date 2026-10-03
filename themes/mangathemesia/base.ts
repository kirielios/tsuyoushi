// Port of keiyoushi/extensions-source lib-multisrc/mangathemesia/MangaThemesia.kt
// Formerly WPMangaStream & WPMangaReader -> MangaThemesia
import {
  Base64,
  DateTimeFormatter,
  DateTimeFormatterBuilder,
  Filter,
  FilterList,
  Intl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  fromUtf8,
  ifBlank,
  substringAfter,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type Elements,
  type HttpUrlBuilder,
  type Interceptor,
} from "../../sdk/index.ts";
import { AuthorFilter, Genre, GenreListFilter, OrderByFilter, ProjectFilter, StatusFilter, TypeFilter, YearFilter, type GenreData } from "./filters.ts";
import { messages } from "./messages.ts";

// More info: https://issuetracker.google.com/issues/36970498
const MANGA_PAGE_ID_REGEX = /(?:post_id["']?\s*:\s*|ts_dynamic_ajax_view\D*|tsUpdateView\D*)(\d+)/;
const CHAPTER_PAGE_ID_REGEX = /chapter_id\s*=\s*(\d+);/;
export const JSON_IMAGE_LIST_REGEX = /["']?(?:images|imageUrls)["']?\s*[:=]\s*(\[.*?])/;
const ALT_NAME_SEPARATOR = /[|/•,;]/;
const IMAGE_EXTENSION_REGEX = /\.(?:webp|jpe?g|png|gif)/i;

const selector = (sel: string, contains: string[]) => contains.map((it) => sel.replaceAll("%s", it)).join(", ");

export abstract class MangaThemesia extends KeiSource {
  mangaUrlDirectory = "/manga";

  datePattern = "MMMM d, yyyy";
  private _dateFormat?: DateTimeFormatter;
  /** `by lazy` upstream: built from datePattern after subclasses have set it. */
  get dateFormat(): DateTimeFormatter {
    return (this._dateFormat ??= new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(this.datePattern).toFormatter(Locale.forLanguageTag(this.lang)));
  }

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "es"], messages });

  projectPageString = "/project";

  // Popular (Search with popular order and nothing else)
  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", this.popularFilter);
  }

  // Latest (Search with update order and nothing else)
  override getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", this.latestFilter);
  }

  // Search
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const probe = SManga.create();
    probe.url = url.pathname;
    const manga = await this.getMangaDetails(probe);
    return manga.title ? manga : null;
  }

  searchMangaUrl(page: number, query: string): HttpUrlBuilder {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    b.addPathSegment(this.mangaUrlDirectory.slice(1));
    if (query) b.addQueryParameter("title", query);
    b.addQueryParameter("page", String(page));
    return b;
  }

  /** searchMangaUrl(page, query, filters) upstream; renamed because TypeScript has no overloads by arity. */
  searchMangaUrlWithFilters(page: number, query: string, filters: FilterList): HttpUrlBuilder {
    const b = this.searchMangaUrl(page, query);
    for (const filter of filters) {
      if (filter instanceof StatusFilter) b.addQueryParameter("status", filter.selectedValue());
      else if (filter instanceof TypeFilter) b.addQueryParameter("type", filter.selectedValue());
      else if (filter instanceof OrderByFilter) b.addQueryParameter("order", filter.selectedValue());
      else if (filter instanceof GenreListFilter) {
        filter.state
          .filter((it) => it.state !== Filter.TriState.STATE_IGNORE)
          .forEach((it) => b.addQueryParameter("genre[]", it.state === Filter.TriState.STATE_EXCLUDE ? `-${it.value}` : it.value));
      } else if (filter instanceof AuthorFilter) {
        if (filter.state) b.addQueryParameter("author", filter.state);
      } else if (filter instanceof YearFilter) {
        if (filter.state) b.addQueryParameter("yearx", filter.state);
      }
      // if site has project page, default value "hasProjectPage" = false
      else if (filter instanceof ProjectFilter) {
        if (filter.selectedValue() === "project-filter-on") b.setPathSegment(0, this.projectPageString.slice(1));
      }
    }
    b.addPathSegment("");
    return b;
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = this.searchMangaUrlWithFilters(page, query, filters);
    return this.searchMangaParse((await this.client.get(url.build().toString())).asJsoup());
  }

  searchMangaParse(document: Document): MangasPage {
    const mangas = document.select(this.searchMangaSelector()).map((element) => this.searchMangaFromElement(element));
    const next = this.searchMangaNextPageSelector();
    const hasNextPage = next != null && document.select(next).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected searchMangaSelector() {
    return ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx";
  }

  protected searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.thumbnail_url = this.imgAttrOf(element.select("img"));
    manga.title = element.select("a").attr("title");
    manga.url = urlWithoutDomain(element.select("a").attr("href"));
    return manga;
  }

  protected searchMangaNextPageSelector(): string | null {
    return "div.pagination .next, div.hpage .r";
  }

  // Related
  override get supportsRelatedMangas() {
    return true;
  }
  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    return this.searchMangaParse((await this.client.get(this.getMangaUrl(manga))).asJsoup()).mangas.filter((it) => it.title);
  }

  // Manga details + Chapters

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const memoPostId = manga.memo?.postId;
    if (this.sendViewCount && memoPostId != null) {
      this.sendView(String(memoPostId));
      const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
      const details = this.mangaDetailsParse(doc);
      details.memo = manga.memo;
      return new SMangaUpdate(details, this.chapterListParse(doc));
    }
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const postId = this.docPostId(doc);
    this.sendView(postId);
    const details = this.mangaDetailsParse(doc);
    if (postId != null) details.memo = { postId };
    return new SMangaUpdate(details, this.chapterListParse(doc));
  }

  seriesDetailsSelector = "div.bigcontent, div.animefull, div.main-info, div.postbody";
  seriesTitleSelector = ".entry-title, .ts-breadcrumb li:last-child span";
  seriesArtistSelector = selector(".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span, span:contains(%s)", ["artist", "Artiste", "Artista", "الرسام", "الناشر", "İllüstratör", "Çizer", "Sanatçı"]);
  seriesAuthorSelector = selector(".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span, span:contains(%s)", ["Author", "Auteur", "autor", "المؤلف", "Mangaka", "seniman", "Pengarang", "Yazar"]);
  seriesDescriptionSelector = ".desc, .entry-content[itemprop=description]";
  seriesAltNameSelector = ".alternative, .wd-full:contains(alt) span, .alter, .seriestualt, " + selector(".infotable tr:contains(%s) td:last-child", ["Alternative", "Alternatif", "الأسماء الثانوية"]);
  seriesGenreSelector = "div.gnr a, .mgen a, .seriestugenre a, " + selector("span:contains(%s)", ["genre", "التصنيف"]);
  seriesTypeSelector = selector(".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .tsinfo .imptdt:contains(%s) a, .fmed b:contains(%s)+span, span:contains(%s) a", ["type", "ประเภท", "النوع", "tipe", "Türü"]) + ", a[href*=type\\=]";
  seriesStatusSelector = selector(".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span span:contains(%s)", ["status", "Statut", "Durum", "連載状況", "Estado", "الحالة", "حالة العمل", "สถานะ", "stato", "Statüsü"]);
  seriesThumbnailSelector = ".infomanga > div[itemprop=image] img, .thumb img";

  altNamePrefix = `${this.intl.get("alt_names_heading")} `;

  async getMangaDetails(manga: SManga): Promise<SManga> {
    return this.mangaDetailsParse((await this.client.get(this.getMangaUrl(manga))).asJsoup());
  }

  protected mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    const seriesDetails = document.selectFirst(this.seriesDetailsSelector);
    if (seriesDetails) {
      manga.title = seriesDetails.selectFirst(this.seriesTitleSelector)!.text();
      manga.artist = this.removeEmptyPlaceholder(seriesDetails.selectFirst(this.seriesArtistSelector)?.ownText());
      manga.author = this.removeEmptyPlaceholder(seriesDetails.selectFirst(this.seriesAuthorSelector)?.ownText());
      manga.description = seriesDetails.selectFirst(this.seriesDescriptionSelector)?.textOrNull() ?? undefined;
      // Add alternative name to manga description
      const altName = seriesDetails.selectFirst(this.seriesAltNameSelector)?.ownText();
      if (altName && altName.trim()) {
        const names = altName
          .split(ALT_NAME_SEPARATOR)
          .map((it) => `- ${it.trim()}`)
          .join("\n");
        manga.description = (manga.description != null ? `${manga.description}\n\n` : "") + `${this.altNamePrefix}\n${names}`.trim();
      }
      const genres = seriesDetails.select(this.seriesGenreSelector).map((it) => it.text());
      // Add series type (manga/manhwa/manhua/other) to genre
      const type = seriesDetails.selectFirst(this.seriesTypeSelector)?.ownText();
      if (type && type.trim()) genres.push(type);
      manga.genre = genres
        .map((genre) => {
          const lower = genre.toLocaleLowerCase(this.lang);
          return lower.charAt(0).toLocaleUpperCase(this.lang) + lower.slice(1);
        })
        .map((it) => it.trim())
        .join(", ");
      manga.status = this.parseStatus(seriesDetails.selectFirst(this.seriesStatusSelector)?.text());
      manga.thumbnail_url = this.imgAttrOf(seriesDetails.select(this.seriesThumbnailSelector));
    }
    return manga;
  }

  protected removeEmptyPlaceholder(s: string | null | undefined): string | undefined {
    return !s || !s.trim() || s === "-" || s === "N/A" || s === "n/a" || s === "Unknown" ? undefined : s;
  }

  /** Kotlin's String?.parseStatus() extension. */
  parseStatus(s: string | null | undefined): number {
    if (s == null) return SManga.UNKNOWN;
    const has = (list: string[]) => list.some((it) => s.toLowerCase().includes(it.toLowerCase()));
    if (has(["مستمرة", "en curso", "ongoing", "on going", "new season", "mass released", "ativo", "en cours", "en cours de publication", "đang tiến hành", "em lançamento", "онгоінг", "publishing", "devam ediyor", "em andamento", "in corso", "güncel", "berjalan", "продолжается", "updating", "lançando", "in arrivo", "emision", "en emision", "مستمر", "curso", "en marcha", "publicandose", "publicando", "连载中", "devam etmekte", "連載中"])) return SManga.ONGOING;
    if (has(["completed", "completo", "complété", "fini", "achevé", "terminé", "tamamlandı", "đã hoàn thành", "hoàn thành", "مكتملة", "завершено", "finished", "finalizad", "completata", "one-shot", "bitti", "tamat", "completado", "concluído", "完結", "concluido", "已完结", "bitmiş"])) return SManga.COMPLETED;
    if (has(["canceled", "cancelled", "cancelado", "cancellato", "cancelados", "dropped", "discontinued", "abandonné"])) return SManga.CANCELLED;
    if (has(["hiatus", "on hold", "season end", "pausado", "en espera", "en pause", "en attente", "hiato"])) return SManga.ON_HIATUS;
    return SManga.UNKNOWN;
  }

  // Chapter list
  protected chapterListSelector() {
    return "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)";
  }

  chapterListParse(document: Document): SChapter[] {
    const chapters = document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));
    // Add timestamp to latest chapter, taken from "Updated On".
    // So source which not provide chapter timestamp will have at least one
    if (chapters.length && chapters[0].date_upload === 0) {
      const date = document.select(".listinfo time[itemprop=dateModified], .fmed:contains(update) time, span:contains(update) time").attr("datetime");
      if (date) chapters[0].date_upload = this.parseUpdatedOnDate(date);
    }
    return chapters;
  }

  private parseUpdatedOnDate(date: string) {
    return DateTimeFormatter.ofPattern("yyyy-MM-dd").tryParseDate(date);
  }

  protected chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const urlElements = element.select("a");
    chapter.url = urlWithoutDomain(urlElements.attr("href"));
    chapter.name = ifBlank(element.select(".lch a, .chapternum").text(), urlElements.first()?.text() ?? "");
    chapter.date_upload = this.parseChapterDate(element.selectFirst(".chapterdate")?.text());
    return chapter;
  }

  /** Kotlin's String?.parseChapterDate() extension. */
  protected parseChapterDate(s: string | null | undefined): number {
    const date = this.dateFormat.tryParseDate(s);
    return date !== 0 ? date : DateTimeFormatter.ofPattern(this.datePattern, Locale.US).tryParseDate(s);
  }

  // Pages
  pageSelector = "div#readerarea img";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const doc = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    this.sendView(this.docPostId(doc));
    return this.pageListParse(doc);
  }

  protected pageListParse(document: Document): Page[] {
    const htmlPages = document
      .select(this.pageSelector)
      .filter((it) => this.imgAttr(it) !== "")
      .map((img, i) => new Page(i, "", this.imgAttr(img)));

    // Some sites also loads pages via javascript
    if (htmlPages.length) return htmlPages;

    // "ts_reader.run({" in base64
    const script = document.selectFirst("script[src^=data:text/javascript;base64,dHNfcmVhZGVyLnJ1bih7]");
    const docString = script ? fromUtf8(Base64.decode(substringAfter(script.attr("src"), "base64,"))) : document.outerHtml();

    const imageListJson = JSON_IMAGE_LIST_REGEX.exec(docString)?.[1] ?? "";
    let imageList: string[] = [];
    try {
      imageList = JSON.parse(imageListJson) as string[];
    } catch {
      imageList = [];
    }
    return imageList.map((url, i) => new Page(i, "", this.absolute(url)));
  }

  /**
   * Set it to false if you want to disable the extension reporting the view count
   * back to the source website through admin-ajax.php.
   */
  protected sendViewCount = true;

  protected sendView(postId: string | null) {
    if (!this.sendViewCount || !postId) return;
    const body = new URLSearchParams({ action: "dynamic_view_ajax", post_id: postId });
    const headers = this.headers;
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    this.client.enqueue({ url: `${this.baseUrl}/wp-admin/admin-ajax.php`, method: "POST", headers, body: body.toString() });
  }

  /** Kotlin's Document.postId() extension. */
  docPostId(document: Document): string | null {
    for (const script of document.select("script")) {
      const m = MANGA_PAGE_ID_REGEX.exec(script.data()) ?? CHAPTER_PAGE_ID_REGEX.exec(script.data());
      if (m) return m[1];
    }
    return null;
  }

  // Filters
  protected statusOptions: [string, string][] = [
    [this.intl.get("status_filter_option_all"), ""],
    [this.intl.get("status_filter_option_ongoing"), "ongoing"],
    [this.intl.get("status_filter_option_completed"), "completed"],
    [this.intl.get("status_filter_option_hiatus"), "hiatus"],
    [this.intl.get("status_filter_option_dropped"), "dropped"],
  ];

  protected typeFilterOptions: [string, string][] = [
    [this.intl.get("type_filter_option_all"), ""],
    [this.intl.get("type_filter_option_manga"), "Manga"],
    [this.intl.get("type_filter_option_manhwa"), "Manhwa"],
    [this.intl.get("type_filter_option_manhua"), "Manhua"],
    [this.intl.get("type_filter_option_comic"), "Comic"],
  ];

  protected orderByFilterOptions: [string, string][] = [
    [this.intl.get("order_by_filter_default"), ""],
    [this.intl.get("order_by_filter_az"), "title"],
    [this.intl.get("order_by_filter_za"), "titlereverse"],
    [this.intl.get("order_by_filter_latest_update"), "update"],
    [this.intl.get("order_by_filter_latest_added"), "latest"],
    [this.intl.get("order_by_filter_popular"), "popular"],
  ];

  /** `by lazy` upstream: the options above may be overridden. */
  protected get popularFilter(): FilterList {
    return FilterList(new OrderByFilter("", this.orderByFilterOptions, "popular"));
  }
  protected get latestFilter(): FilterList {
    return FilterList(new OrderByFilter("", this.orderByFilterOptions, "update"));
  }

  protected projectFilterOptions: [string, string][] = [
    [this.intl.get("project_filter_all_manga"), ""],
    [this.intl.get("project_filter_only_project"), "project-filter-on"],
  ];

  hasProjectPage = false;

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.parseGenres((await this.client.get(`${this.baseUrl}/${this.mangaUrlDirectory}`)).asJsoup());
  }

  override getFilterList(data: unknown = null): FilterList {
    const genrelist = Array.isArray(data) ? (data as GenreData[]).map((it) => new Genre(it.name, it.value, it.state ?? Filter.TriState.STATE_IGNORE)) : [];

    const filters: Filter[] = [
      new Filter.Separator(),
      new AuthorFilter(this.intl.get("author_filter_title")),
      new YearFilter(this.intl.get("year_filter_title")),
      new StatusFilter(this.intl.get("status_filter_title"), this.statusOptions),
      new TypeFilter(this.intl.get("type_filter_title"), this.typeFilterOptions),
      new OrderByFilter(this.intl.get("order_by_filter_title"), this.orderByFilterOptions),
    ];

    if (genrelist.length) filters.push(new Filter.Header(this.intl.get("genre_exclusion_warning")), new GenreListFilter(this.intl.get("genre_filter_title"), genrelist));

    if (this.hasProjectPage) {
      filters.push(
        new Filter.Separator(),
        new Filter.Header(this.intl.get("project_filter_warning")),
        new Filter.Header(this.intl.format("project_filter_name", this.name)),
        new ProjectFilter(this.intl.get("project_filter_title"), this.projectFilterOptions),
      );
    }
    return FilterList(...filters);
  }

  // Helpers

  acceptHeaderInterceptor(): Interceptor {
    return (request) => {
      if (!IMAGE_EXTENSION_REGEX.test(new URL(request.url).pathname)) return request;
      const headers = new Headers(request.headers);
      headers.set("Accept", "image/avif,image/webp,image/png,image/jpeg,*/*");
      headers.set("Sec-Fetch-Dest", "image");
      headers.set("Sec-Fetch-Mode", "no-cors");
      headers.set("Sec-Fetch-Site", "same-site");
      return { ...request, headers };
    };
  }

  protected parseGenres(document: Document): GenreData[] | null {
    const list = document.selectFirst("ul.genrez");
    if (!list) return null;
    return list.select("li").map((li) => ({ name: li.selectFirst("label")!.text(), value: li.selectFirst("input[type=checkbox]")!.attr("value") }));
  }

  private absolute(s: string) {
    return s.startsWith("/") ? this.baseUrl + s : s;
  }

  /** Kotlin's Element.imgAttr() extension. */
  protected imgAttr(element: Element): string {
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-cfsrc")) return element.attr("abs:data-cfsrc");
    return element.attr("abs:src");
  }

  /** Kotlin's Elements.imgAttr() extension. */
  protected imgAttrOf(elements: Elements): string {
    const first = elements.first();
    return first ? this.imgAttr(first) : "";
  }
}
