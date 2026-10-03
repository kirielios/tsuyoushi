// Port of keiyoushi/extensions-source lib-multisrc/mmrcms/MMRCMS.kt (+ Filters.kt, Dto.kt)
import {
  DateTimeFormatter,
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
  distinctBy,
  parseHtml,
  substringAfterLast,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
  type Elements,
  type HttpUrlBuilder,
  type Response,
} from "../../sdk/index.ts";
import { messages } from "./messages.ts";

// ============================== Dto ==============================

export interface SuggestionDto {
  value: string;
  data: string;
}
interface SearchResultDto {
  suggestions: SuggestionDto[];
}
type Pair = [string, string];
interface FilterData {
  categories: Pair[];
  statuses: Pair[];
  tags: Pair[];
  sortOptions: Pair[];
}

// ============================== Filters ==============================

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
export const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as unknown as UriFilter).addToUri === "function";

export class TextFilter extends Filter.Text implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
  ) {
    super(name);
  }
  addToUri(builder: HttpUrlBuilder) {
    builder.addQueryParameter(this.param, this.state);
  }
}

export class UriPartFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    private readonly vals: Pair[],
    private readonly firstIsUnspecified = true,
    defaultValue = 0,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      defaultValue,
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    if (this.state === 0 && this.firstIsUnspecified) return;
    builder.addQueryParameter(this.param, this.vals[this.state][1]);
  }
}

export class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    vals: Pair[],
  ) {
    super(
      name,
      vals.map((it) => new UriMultiSelectOption(it[0], it[1])),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const checked = this.state.filter((it) => it.state);
    if (!checked.length) return;
    checked.forEach((it) => builder.addQueryParameter(this.param, it.value));
  }
}

export class SortFilter extends Filter.Sort implements UriFilter {
  constructor(
    intl: Intl,
    private readonly sortables: Pair[],
    selection = { index: 0, ascending: true },
  ) {
    super(
      intl.get("sort_by_filter_title"),
      sortables.map((it) => it[0]),
      selection,
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    const state = this.state;
    if (!state) return;
    builder.addQueryParameter("sortBy", this.sortables[state.index][1]);
    builder.addQueryParameter("asc", String(state.ascending));
  }
}

// ============================== Source ==============================

const searchTokenRegex = /['"]_token['"]\s*:\s*['"]([0-9A-Za-z]+)['"]/;

const lowerSet = (...s: string[]) => new Set(s);

/**
 * dateFormat The date format used for parsing chapter dates.
 * itemPath The path used in the URL for entries.
 * fetchFilterOptions Whether to fetch filtering options (categories, types, tags).
 * supportsAdvancedSearch Whether the source supports advanced search under /advanced-search.
 * detailsTitleSelector Selector for the entry's title in its details page.
 * chapterNamePrefix A word that always precedes the chapter title, e.g. "Scan "
 * chapterString The word for "Chapter" in the source's language.
 */
export abstract class MMRCMS extends KeiSource {
  protected dateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM. yyyy", Locale.US);

  protected itemPath = "manga";

  protected fetchFilterOptions = true;

  protected supportsAdvancedSearch = true;

  protected detailsTitleSelector = ".listmanga-header, .widget-title";

  protected chapterNamePrefix = "";

  protected chapterString = this.lang === "es" ? "Capítulo" : this.lang === "fr" ? "Chapitre" : "Chapter";

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "es"], messages });

  protected popularMangaUrl(page: number) {
    return `${this.baseUrl}/filterList?page=${page}&sortBy=views&asc=false`;
  }

  override async getPopularManga(page: number) {
    return this.popularMangaParse((await this.client.get(this.popularMangaUrl(page))).asJsoup());
  }

  protected popularMangaParse(document: Document): MangasPage {
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const next = this.popularMangaNextPageSelector();
    const hasNextPage = next != null ? document.selectFirst(next) != null : false;
    return new MangasPage(mangas, hasNextPage);
  }

  protected popularMangaSelector(): string {
    return this.searchMangaSelector();
  }

  protected popularMangaFromElement(element: Element): SManga {
    return this.searchMangaFromElement(element);
  }

  protected popularMangaNextPageSelector(): string | null {
    return this.searchMangaNextPageSelector();
  }

  protected latestUpdatesUrl(page: number) {
    return `${this.baseUrl}/latest-release?page=${page}`;
  }

  override async getLatestUpdates(page: number) {
    return this.latestUpdatesParse(await this.client.get(this.latestUpdatesUrl(page)));
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const manga = distinctBy(
      document.select(this.latestUpdatesSelector()).map((it) => this.latestUpdatesFromElement(it)),
      (it) => it.url,
    );
    const next = this.latestUpdatesNextPageSelector();
    const hasNextPage = next != null ? document.selectFirst(next) != null : false;
    return new MangasPage(manga, hasNextPage);
  }

  protected latestUpdatesSelector() {
    return "div.mangalist div.manga-item";
  }

  protected latestUpdatesFromElement(element: Element) {
    return this.popularMangaFromElement(element);
  }

  protected latestUpdatesNextPageSelector(): string | null {
    return this.popularMangaNextPageSelector();
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (!query && this.supportsAdvancedSearch) {
      const document = (await this.client.get(`${this.baseUrl}/advanced-search`)).asJsoup();
      const b = toHttpUrl(this.baseUrl).newBuilder();
      filters.filter(isUriFilter).forEach((it) => it.addToUri(b));
      const params = b.build().encodedQuery ?? "";

      const body = new URLSearchParams();
      body.append("params", params);
      body.append("page", String(page));
      // script:containsData(_token)
      const script = document
        .select("script")
        .find((it) => it.data().includes("_token"))
        ?.data();
      const token = script != null ? searchTokenRegex.exec(script)?.[1] : undefined;
      if (token != null) body.append("_token", token);

      const resDoc = (await this.client.post(`${this.baseUrl}/advSearchFilter`, undefined, body)).asJsoup();
      const mangas = resDoc.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
      const next = this.searchMangaNextPageSelector();
      const hasNextPage = next != null ? resDoc.selectFirst(next) != null : false;
      return new MangasPage(mangas, hasNextPage);
    }

    return this.searchMangaParse(await this.client.get(this.searchMangaUrl(page, query, filters)), page);
  }

  protected searchMangaUrl(page: number, query: string, filters: FilterList): string {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    if (query) {
      b.addPathSegment("search");
      b.addQueryParameter("query", query);
    } else {
      b.addPathSegment("filterList");
      b.addQueryParameter("page", String(page));
      filters.filter(isUriFilter).forEach((it) => it.addToUri(b));
    }
    return b.build().toString();
  }

  protected searchMangaParse(response: Response, page: number): MangasPage {
    const searchType = toHttpUrl(response.url).pathSegments.at(-1);

    if (searchType === "filterList") {
      const document = response.asJsoup();
      const mangas = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
      const next = this.searchMangaNextPageSelector();
      const hasNextPage = next != null ? document.selectFirst(next) != null : false;
      return new MangasPage(mangas, hasNextPage);
    }

    return this.parseSearchDirectory(response.parseAs<SearchResultDto>().suggestions, page);
  }

  protected searchMangaSelector(): string {
    return "div.media";
  }

  protected searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const anchor = element.selectFirst(".media-heading a, .manga-heading a")!;

    manga.url = urlWithoutDomain(anchor.absUrl("href"));
    manga.title = anchor.text();
    const img = element.selectFirst("img");
    manga.thumbnail_url = this.guessCover(manga.url, img ? this.imgAttr(img) : null);
    return manga;
  }

  protected searchMangaNextPageSelector(): string | null {
    return ".pagination a[rel=next]";
  }

  protected parseSearchDirectory(searchDirectory: SuggestionDto[], page: number): MangasPage {
    const manga = searchDirectory.slice((page - 1) * 24, Math.min(page * 24, searchDirectory.length)).map((it) => {
      const m = SManga.create();
      m.url = `/${this.itemPath}/${it.data}`;
      m.title = it.value;
      m.thumbnail_url = this.guessCover(m.url, null);
      return m;
    });
    const hasNextPage = (page + 1) * 24 <= searchDirectory.length;

    return new MangasPage(manga, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || segments.length < 2 || segments[0] !== this.itemPath) return null;

    const manga = this.mangaDetailsParse((await this.client.get(url)).asJsoup());
    manga.url = urlWithoutDomain(url.toString());
    return manga;
  }

  // Details and chapters come from the same page
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document), await this.chapterListParse(document));
  }

  protected readonly detailAuthor = lowerSet("author(s)", "autor(es)", "auteur(s)", "著作", "yazar(lar)", "mangaka(lar)", "pengarang/penulis", "pengarang", "penulis", "autor", "المؤلف", "перевод", "autor/autorzy");
  protected readonly detailArtist = lowerSet("artist(s)", "artiste(s)", "sanatçi(lar)", "artista(s)", "artist(s)/ilustrator", "الرسام", "seniman", "rysownik/rysownicy", "artista");
  protected readonly detailGenre = lowerSet("categories", "categorías", "catégories", "ジャンル", "kategoriler", "categorias", "kategorie", "التصنيفات", "жанр", "kategori", "tagi", "género");
  protected readonly detailStatus = lowerSet("status", "statut", "estado", "状態", "durum", "الحالة", "статус");
  protected readonly detailStatusComplete = lowerSet("complete", "مكتملة", "complet", "completo", "zakończone", "concluído", "finalizado");
  protected readonly detailStatusOngoing = lowerSet("ongoing", "مستمرة", "en cours", "em lançamento", "prace w toku", "ativo", "em andamento", "activo", "publicándose", "publicandose");
  protected readonly detailStatusDropped = lowerSet("dropped");

  protected mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst(this.detailsTitleSelector)!.text();
    const img = document.selectFirst(".row img.img-responsive");
    manga.thumbnail_url = this.guessCover(document.location(), img ? this.imgAttr(img) : null);
    const wells = document.select(".row .well");
    wells.select("h5").remove();
    manga.description = this.textWithNewlines(wells);

    document.select(".row .dl-horizontal dt").forEach((element) => {
      let key = element.text().toLowerCase();
      if (key.endsWith(":")) key = key.slice(0, -1);
      if (this.detailAuthor.has(key)) manga.author = element.nextElementSibling()!.text();
      else if (this.detailArtist.has(key)) manga.artist = element.nextElementSibling()!.text();
      else if (this.detailGenre.has(key))
        manga.genre = element
          .nextElementSibling()!
          .select("a")
          .map((it) => it.text())
          .join(", ");
      else if (this.detailStatus.has(key)) manga.status = this.parseStatus(element.nextElementSibling()!.text());
    });
    return manga;
  }

  protected parseStatus(text: string): number {
    const s = text.toLowerCase();
    if (this.detailStatusComplete.has(s)) return SManga.COMPLETED;
    if (this.detailStatusOngoing.has(s)) return SManga.ONGOING;
    if (this.detailStatusDropped.has(s)) return SManga.CANCELLED;
    return SManga.UNKNOWN;
  }

  protected async chapterListParse(document: Document): Promise<SChapter[]> {
    const title = document.selectFirst(this.detailsTitleSelector)!.text();
    return document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it, title));
  }

  protected chapterListSelector(): string {
    return "ul.chapters > li:not(.btn)";
  }

  protected chapterFromElement(element: Element, mangaTitle: string): SChapter {
    const chapter = SChapter.create();
    const titleWrapper = element.selectFirst(".chapter-title-rtl")!;
    const anchor = titleWrapper.selectFirst("a")!;

    chapter.url = urlWithoutDomain(anchor.absUrl("href"));
    chapter.name = this.cleanChapterName(mangaTitle, titleWrapper.text());
    const dateStr = element.selectFirst(".date-chapter-title-rtl")?.text();
    chapter.date_upload = this.dateFormat.tryParseDate(dateStr);
    return chapter;
  }

  /**
   * Function to clean up chapter names. Mostly useful for sites that
   * don't know what a chapter title is and do "One Piece 1234 : Chapter 1234".
   */
  protected cleanChapterName(mangaTitle: string, name: string): string {
    const initialName = name.replace(this.chapterNamePrefix + mangaTitle, () => this.chapterString);

    const i = initialName.indexOf(":");
    const splits = (i < 0 ? [initialName] : [initialName.slice(0, i), initialName.slice(i + 1)]).map((it) => it.trim());

    return splits.length < 2 || splits[0] === splits[1] ? splits[0] : `${splits[0]}: ${splits[1]}`;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  protected pageListParse(document: Document): Page[] {
    return document.select("#all > img.img-responsive").map((it, i) => new Page(i, "", this.imgAttr(it)));
  }

  override get supportsFilterFetching() {
    return this.fetchFilterOptions;
  }

  override async fetchFilterData(): Promise<unknown> {
    const pairs = (els: Elements): Pair[] => els.map((it) => [it.text(), it.attr("value")]);
    if (this.supportsAdvancedSearch) {
      const document = (await this.client.get(`${this.baseUrl}/advanced-search`)).asJsoup();
      return {
        categories: pairs(document.select("select[name='categories[]'] option")),
        statuses: pairs(document.select("select[name='status[]'] option")),
        tags: pairs(document.select("select[name='types[]'] option")),
        sortOptions: [],
      } satisfies FilterData;
    }
    const document = (await this.client.get(`${this.baseUrl}/${this.itemPath}-list`)).asJsoup();
    return {
      categories: document.select("a.category").map((it) => [it.text(), toHttpUrl(it.absUrl("href")).queryParameter("cat")!]),
      statuses: [],
      tags: document.select("div.tag-links a").map((it) => [it.text(), toHttpUrl(it.absUrl("href")).pathSegments.at(-1)!]),
      sortOptions: document.select("#sort-types label:has(input)").map((it) => [it.ownText(), it.selectFirst("input")!.id()]),
    } satisfies FilterData;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as FilterData | null;
    const categories = filterData?.categories ?? [];
    const statuses = filterData?.statuses ?? [];
    const tags = filterData?.tags ?? [];
    const sortOptions = filterData?.sortOptions ?? [];
    const intl = this.intl;

    const filters: Filter[] = [new Filter.Header(intl.get("filter_warning")), new Filter.Separator()];

    if (this.supportsAdvancedSearch) {
      if (categories.length) filters.push(new UriMultiSelectFilter(intl.get("category_filter_title"), "categories[]", categories));
      if (statuses.length) filters.push(new UriMultiSelectFilter(intl.get("status_filter_title"), "status[]", statuses));
      if (tags.length) filters.push(new UriMultiSelectFilter(intl.get("type_filter_title"), "types[]", tags));
      filters.push(new TextFilter(intl.get("year_filter_title"), "release"));
      filters.push(new TextFilter(intl.get("author_filter_title"), "author"));
    } else {
      if (categories.length) filters.push(new UriPartFilter(intl.get("category_filter_title"), "cat", [["Any", ""], ...categories]));
      filters.push(new UriPartFilter(intl.get("title_begins_with_filter_title"), "alpha", this.alphaOptions));
      if (tags.length) filters.push(new UriPartFilter(intl.get("tag_filter_title"), "tag", [["Any", ""], ...tags]));
      if (sortOptions.length) filters.push(new SortFilter(intl, sortOptions));
    }

    return filters;
  }

  private get alphaOptions(): Pair[] {
    return [["Any", ""], ...[..."#ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((it): Pair => [it, it])];
  }

  protected guessCover(mangaUrl: string, url: string | null | undefined): string {
    if (url == null || url.endsWith("no-image.png")) return `${this.baseUrl}/uploads/manga/${substringAfterLast(mangaUrl, "/")}/cover/cover_250x350.jpg`;
    return url;
  }

  protected imgAttr(element: Element): string {
    if (element.hasAttr("data-background-image")) return element.absUrl("data-background-image");
    if (element.hasAttr("data-cfsrc")) return element.absUrl("data-cfsrc");
    if (element.hasAttr("data-lazy-src")) return element.absUrl("data-lazy-src");
    if (element.hasAttr("data-src")) return element.absUrl("data-src");
    return element.absUrl("src");
  }

  /** select("p, br").prepend("\\n"); text() with the markers turned into newlines. */
  protected textWithNewlines(elements: Elements): string {
    const html = elements.map((it) => it.outerHtml().replace(/<(p|br)\b/gi, "\\n<$1")).join("");
    return parseHtml(this.host.load, html, "").text().replaceAll("\\n", "\n").replaceAll("\n ", "\n");
  }
}
