// Port of keiyoushi/extensions-source lib-multisrc/galleryadults/GalleryAdults.kt
// Kotlin extension functions on Element/String become methods taking the receiver first (element.mangaTitle() ->
// this.mangaTitle(element)). `Element.mangaLang()` is `mangaLangOf(element)`: TS cannot share the name with the
// `mangaLang` property.
import {
  Filter,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  isNotBlank,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  trimEnd,
  trimStart,
  urlWithoutDomain,
  type DateTimeFormatter,
  type Document,
  type Element,
  type Elements,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import {
  AdvancedTextFilter,
  ArtistsFilter,
  CategoryFilters,
  CharactersFilter,
  FavoriteFilter,
  GenresFilter,
  GroupsFilter,
  ParodiesFilter,
  RandomEntryFilter,
  SearchFlagFilter,
  SortOrderFilter,
  SpeechlessFilter,
  TagsFilter,
} from "./filters.ts";
import { imgAttr, regexExcludeTerm, regexSpaceNotAfterComma, thumbnailToFull, toBinary, toDate } from "./utils.ts";

// references to be used in factory
export const LANGUAGE_MULTI = "";
export const LANGUAGE_ENGLISH = "english";
export const LANGUAGE_JAPANESE = "japanese";
export const LANGUAGE_CHINESE = "chinese";
export const LANGUAGE_KOREAN = "korean";
export const LANGUAGE_SPANISH = "spanish";
export const LANGUAGE_FRENCH = "french";
export const LANGUAGE_GERMAN = "german";
export const LANGUAGE_RUSSIAN = "russian";
export const LANGUAGE_SPEECHLESS = "speechless";
export const LANGUAGE_TRANSLATED = "translated";

const PREF_SHORT_TITLE = "pref_short_title";

/* List detail */
export interface SMangaDto {
  title: string;
  url: string;
  thumbnail: string | null | undefined;
  lang: string;
}

const firstInstance = <T>(filters: FilterList, cls: abstract new (...args: never[]) => T): T | undefined => filters.find((f): f is Filter & T => f instanceof cls);
const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);
const trimSlashes = (s: string) => trimEnd(trimStart(s, "/"), "/");
const toIntOrNull = (s: string) => (/^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null);

export abstract class GalleryAdults extends KeiSource {
  protected mangaLang: string = LANGUAGE_MULTI;

  protected dateFormat: DateTimeFormatter | null = null;

  protected get xhrHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("X-Requested-With", "XMLHttpRequest");
    return h;
  }

  protected mangaTitleSelector = ".caption";

  protected mangaTitle(element: Element, selector: string = this.mangaTitleSelector): string | null {
    const it = this.mangaFullTitle(element, selector);
    return this.shortTitle ? (it != null ? this.shortenTitle(it) : it) : it;
  }

  protected mangaFullTitle(element: Element, selector: string): string | null {
    return element.selectFirst(selector)?.text() ?? null;
  }

  protected shortenTitle(s: string): string {
    return s.replace(this.shortenTitleRegex, "").trim();
  }

  protected shortenTitleRegex = /(\[[^\]]*]|[({][^)}]*[)}])/g;

  protected mangaUrl(element: Element): string | null {
    return element.selectFirst(".inner_thumb a")?.attr("abs:href") ?? null;
  }

  protected mangaThumbnail(element: Element): string | null {
    const img = element.selectFirst(".inner_thumb img");
    return img ? imgAttr(img) : null;
  }

  // Overwrite this to filter other languages' manga from search result.
  // Default to [mangaLang] won't filter anything
  protected mangaLangOf(_element: Element): string {
    return this.mangaLang;
  }

  protected addPageUri(s: string, page: number): string {
    return `${trimSlashes(s)}${s.includes("?") ? "&" : "/?"}page=${page}`;
  }

  /* Popular */
  protected get popularMangaUrl(): string {
    let s = `${this.baseUrl}/`;
    if (isNotBlank(this.mangaLang)) s += `language/${this.mangaLang}/`;
    if (this.supportsLatest) s += "popular";
    return s;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.addPageUri(this.popularMangaUrl, page);
    return this.parsePopularManga((await this.client.get(url)).asJsoup());
  }

  protected parsePopularManga(document: Document): MangasPage {
    const mangas = document.select(this.popularMangaSelector()).map((element) => this.popularMangaFromElement(element));
    const sel = this.popularMangaNextPageSelector();
    const hasNextPage = sel != null ? document.selectFirst(sel) != null : false;
    return new MangasPage(mangas, hasNextPage);
  }

  protected popularMangaSelector() {
    return "div.thumb";
  }

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = this.mangaTitle(element)!;
    manga.url = urlWithoutDomain(this.mangaUrl(element)!);
    manga.thumbnail_url = this.mangaThumbnail(element) ?? undefined;
    return manga;
  }

  protected popularMangaNextPageSelector(): string | null {
    return ".pagination li.active + li:not(.disabled), a[rel='next']";
  }

  /* Latest */
  protected get latestUpdatesUrl(): string {
    let s = `${this.baseUrl}/`;
    if (isNotBlank(this.mangaLang)) s += `language/${this.mangaLang}`;
    return s;
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.addPageUri(this.latestUpdatesUrl, page);
    return this.parseLatestUpdates((await this.client.get(url)).asJsoup());
  }

  protected parseLatestUpdates(document: Document): MangasPage {
    const mangas = document.select(this.latestUpdatesSelector()).map((element) => this.latestUpdatesFromElement(element));
    const sel = this.latestUpdatesNextPageSelector();
    const hasNextPage = sel != null ? document.selectFirst(sel) != null : false;
    return new MangasPage(mangas, hasNextPage);
  }

  protected latestUpdatesSelector() {
    return this.popularMangaSelector();
  }

  protected latestUpdatesFromElement(element: Element) {
    return this.popularMangaFromElement(element);
  }

  protected latestUpdatesNextPageSelector(): string | null {
    return this.popularMangaNextPageSelector();
  }

  /* Search */
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const id = url.pathname.slice(1).split("/")[1];
    if (id == null) return null;
    return this.getMangaById(id);
  }

  protected get randomEntryUrl() {
    return `${this.baseUrl}/random/`;
  }

  protected randomEntryParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const url = response.url;
    const id = substringAfterLast(removeSuffix(url, "/"), "/");
    const manga = SManga.create();
    manga.title = this.mangaTitle(document, "h1")!;
    manga.url = urlWithoutDomain(`${this.baseUrl}/${this.idPrefixUri}/${id}/`);
    manga.thumbnail_url = this.getCover(document) ?? undefined;
    return new MangasPage([manga], false);
  }

  /**
   * Manga URL: $baseUrl/$idPrefixUri/<id>/
   */
  protected idPrefixUri = "gallery";

  protected async getMangaById(id: string): Promise<SManga> {
    const response = await this.client.get(`${this.baseUrl}/${this.idPrefixUri}/${id}`);
    const manga = this.parseMangaDetails(response.asJsoup());
    manga.url = `/${this.idPrefixUri}/${id}/`;
    return manga;
  }

  protected useIntermediateSearch = false;
  protected supportAdvancedSearch = false;
  protected supportSpeechless = false;
  protected get useBasicSearch(): boolean {
    return !this.useIntermediateSearch;
  }

  protected searchPopularPath = "popular";

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (toIntOrNull(query) != null) return new MangasPage([await this.getMangaById(query)], false);

    const randomEntryFilter = firstInstance(filters, RandomEntryFilter);
    if (randomEntryFilter?.state === true) return this.randomEntryParse(await this.client.get(this.randomEntryUrl));

    // Basic search
    const sortOrderFilter = firstInstance(filters, SortOrderFilter);
    const genresFilter = firstInstance(filters, GenresFilter);
    const selectedGenres = genresFilter?.selected ?? [];
    const favoriteFilter = firstInstance(filters, FavoriteFilter);

    // Speechless
    const speechlessFilter = firstInstance(filters, SpeechlessFilter);

    // Advanced search
    const advancedSearchFilters = filters.filter((f): f is AdvancedTextFilter => f instanceof AdvancedTextFilter);

    if (favoriteFilter?.state === true) return this.searchFavoriteFilter(page, query, filters);

    let url: string;
    if (this.supportSpeechless && speechlessFilter?.state === true) url = this.speechlessFilterSearchUrl(page, query, filters);
    else if (this.supportAdvancedSearch && advancedSearchFilters.some((it) => isNotBlank(it.state))) url = this.advancedSearchUrl(page, query, filters);
    else if (selectedGenres.length === 1 && !isNotBlank(query)) url = this.tagBrowsingSearchUrl(page, query, filters);
    else if (this.useIntermediateSearch) url = this.intermediateSearchUrl(page, query, filters);
    else if (this.useBasicSearch && (selectedGenres.length > 1 || isNotBlank(query))) url = this.basicSearchUrl(page, query, filters);
    else if (sortOrderFilter?.state === 1) url = this.latestUpdatesUrl;
    else url = this.popularMangaUrl;

    return this.parseSearchManga(await this.client.get(this.addPageUri(url, page)));
  }

  /**
   * Browsing user's personal favorites saved on site. This requires login in view WebView.
   */
  protected async searchFavoriteFilter(page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.parseSearchManga(await this.client.post(`${this.baseUrl}/${this.favoritePath}`, this.xhrHeaders, new URLSearchParams({ page: String(page) })));
  }

  protected basicSearchKey = "q";

  /**
   * Basic Search: support query string with multiple-genres filter by adding genres to query string.
   */
  protected basicSearchUrl(_page: number, query: string, filters: FilterList): string {
    // Basic search
    const sortOrderFilter = firstInstance(filters, SortOrderFilter);
    const genresFilter = firstInstance(filters, GenresFilter);
    const selectedGenres = genresFilter?.selected ?? [];

    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addPathSegments("search/");
    builder.addEncodedQueryParameter(
      this.basicSearchKey,
      this.buildQueryString(
        selectedGenres.map((it) => it.name),
        query,
      ),
    );
    if (sortOrderFilter?.state === 0) builder.addQueryParameter("sort", "popular");
    return builder.build().toString();
  }

  protected intermediateSearchKey = "key";

  /**
   * This supports filter query search with languages, categories (manga, doujinshi...)
   * with additional sort orders.
   */
  protected intermediateSearchUrl(_page: number, query: string, filters: FilterList): string {
    // Basic search
    const sortOrderFilter = firstInstance(filters, SortOrderFilter);
    const genresFilter = firstInstance(filters, GenresFilter);
    const selectedGenres = genresFilter?.selected ?? [];

    // Intermediate search
    const categoryFilters = firstInstance(filters, CategoryFilters);

    // Only for query string or multiple tags
    const builder = toHttpUrl(`${this.baseUrl}/search/`).newBuilder();
    this.getSortOrderURIs().forEach((pair, index) => builder.addQueryParameter(pair[1], toBinary(sortOrderFilter?.state === index)));
    categoryFilters?.state?.forEach((it) => builder.addQueryParameter(it.uri, toBinary(it.state)));
    this.getLanguageURIs().forEach((pair) => builder.addQueryParameter(pair[1], toBinary(this.mangaLang === pair[0] || this.mangaLang === LANGUAGE_MULTI)));
    builder.addEncodedQueryParameter(
      this.intermediateSearchKey,
      this.buildQueryString(
        selectedGenres.map((it) => it.name),
        query,
      ),
    );
    return builder.build().toString();
  }

  protected advancedSearchKey = "key";
  protected advancedSearchUri = "advsearch";

  /**
   * Advanced Search normally won't support search for string but allow to include/exclude specific
   * tags/artists/groups/parodies/characters
   */
  protected advancedSearchUrl(_page: number, _query: string, filters: FilterList): string {
    // Basic search
    const sortOrderFilter = firstInstance(filters, SortOrderFilter);
    const genresFilter = firstInstance(filters, GenresFilter);
    const selectedGenres = genresFilter?.selected ?? [];

    // Intermediate search
    const categoryFilters = firstInstance(filters, CategoryFilters);
    // Advanced search
    const advancedSearchFilters = filters.filter((f): f is AdvancedTextFilter => f instanceof AdvancedTextFilter);

    const builder = toHttpUrl(`${this.baseUrl}/${this.advancedSearchUri}/`).newBuilder();
    this.getSortOrderURIs().forEach((pair, index) => builder.addQueryParameter(pair[1], toBinary(sortOrderFilter?.state === index)));
    categoryFilters?.state?.forEach((it) => builder.addQueryParameter(it.uri, toBinary(it.state)));
    this.getLanguageURIs().forEach((pair) => builder.addQueryParameter(pair[1], toBinary(this.mangaLang === pair[0] || this.mangaLang === LANGUAGE_MULTI)));

    // Build this query string: +tag:"bat+man"+-tag:"cat"+artist:"Joe"...
    // +tag must be encoded into %2Btag while the rest are not needed to encode
    const keys: string[] = [];
    keys.push(...selectedGenres.map((it) => `%2Btag:"${it.name}"`));
    for (const filter of advancedSearchFilters) {
      const key =
        filter instanceof TagsFilter
          ? "tag"
          : filter instanceof ParodiesFilter
            ? "parody"
            : filter instanceof ArtistsFilter
              ? "artist"
              : filter instanceof CharactersFilter
                ? "character"
                : filter instanceof GroupsFilter
                  ? "group"
                  : null;
      if (key != null) {
        keys.push(
          ...filter.state
            .trim()
            .replace(regexSpaceNotAfterComma, "+")
            .replaceAll(" ", "")
            .split(",")
            .flatMap((it) => {
              const groups = regexExcludeTerm.exec(it);
              return groups ? [`${isNotBlank(groups[1]) ? "-" : "%2B"}${key}:"${groups[2]}"`] : [];
            }),
        );
      }
    }
    builder.addEncodedQueryParameter(this.advancedSearchKey, keys.join("+"));
    return builder.build().toString();
  }

  /**
   * Convert space( ) typed in search-box into plus(+) in URL. Then:
   * - uses plus(+) to search for exact match
   * - use comma(, ) for separate terms, as AND condition.
   * Plus(+) after comma(, ) doesn't have any effect.
   */
  protected buildQueryString(tags: string[], query: string): string {
    return [...tags, query]
      .filter(isNotBlank)
      .map((it) =>
        // any space except after a comma (we're going to replace spaces only between words)
        it.trim().replace(regexSpaceNotAfterComma, "+").replaceAll(" ", ""),
      )
      .join(",");
  }

  protected tagBrowsingSearchUrl(_page: number, _query: string, filters: FilterList): string {
    // Basic search
    const sortOrderFilter = firstInstance(filters, SortOrderFilter);
    const genresFilter = firstInstance(filters, GenresFilter);
    const selectedGenres = genresFilter?.selected ?? [];
    if (selectedGenres.length !== 1) throw new Error("List has more than one element.");

    // Browsing single tag's catalog
    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addPathSegment("tag");
    builder.addPathSegment(selectedGenres[0].uri);
    if (sortOrderFilter?.state === 0) builder.addPathSegment(this.searchPopularPath);
    return builder.build().toString();
  }

  /**
   * Browsing speechless titles. Some sites exclude speechless titles from normal search and
   * allow browsing separately.
   */
  protected speechlessFilterSearchUrl(_page: number, _query: string, filters: FilterList): string {
    // Basic search
    const sortOrderFilter = firstInstance(filters, SortOrderFilter);

    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addPathSegment("language");
    builder.addPathSegment(LANGUAGE_SPEECHLESS);
    if (sortOrderFilter?.state === 0) builder.addPathSegment(this.searchPopularPath);
    return builder.build().toString();
  }

  protected favoritePath = "user/fav_pags.php";

  protected loginRequired(document: Document, url: string): boolean {
    return url.includes("/login/") && document.select("input[value=Login]").length > 0;
  }

  protected parseSearchManga(response: Response): MangasPage {
    const document = response.asJsoup();
    if (this.loginRequired(document, response.url)) {
      throw new Error("Log in via WebView to view favorites");
    }
    const sel = this.searchMangaNextPageSelector();
    const hasNextPage = sel != null ? document.selectFirst(sel) != null : false;
    const mangas = this.searchMangaFromElements(document.select(this.searchMangaSelector()), hasNextPage);
    return new MangasPage(mangas, hasNextPage);
  }

  protected searchMangaFromElements(elements: Elements, hasNextPage: boolean): SManga[] {
    const unfiltered = elements.flatMap((it): SMangaDto[] => {
      const title = this.mangaTitle(it);
      if (title == null) return [];
      const url = this.mangaUrl(it);
      if (url == null) return [];
      return [{ title, url, thumbnail: this.mangaThumbnail(it), lang: this.mangaLangOf(it) }];
    });
    const results = unfiltered.filter(
      (it) =>
        !isNotBlank(this.mangaLang) ||
        it.lang === LANGUAGE_SPEECHLESS || // Include Speechless in search results
        it.lang === this.mangaLang,
    );
    // return at least 1 title if all mangas in current page is of other languages
    const list = results.length === 0 && hasNextPage ? unfiltered.slice(0, 1) : results;
    return list.map((it) => {
      const manga = SManga.create();
      manga.title = it.title;
      manga.url = urlWithoutDomain(it.url);
      manga.thumbnail_url = it.thumbnail ?? undefined;
      return manga;
    });
  }

  protected searchMangaSelector() {
    return this.popularMangaSelector();
  }

  protected searchMangaNextPageSelector(): string | null {
    return this.popularMangaNextPageSelector();
  }

  /* Related titles */
  override get supportsRelatedMangas() {
    return true;
  }

  protected relatedMangaSelector() {
    return this.popularMangaSelector();
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return this.searchMangaFromElements(document.select(this.relatedMangaSelector()), false);
  }

  /* Details */

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const doc = response.asJsoup();

    return new SMangaUpdate(this.parseMangaDetails(doc), this.parseChapterList(doc, new URL(response.url).pathname));
  }

  protected mangaDetailInfoSelector = ".gallery_top";

  // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE has no counterpart in the SDK
  protected parseMangaDetails(document: Document): SManga {
    const el = document.selectFirst(this.mangaDetailInfoSelector)!;
    const manga = SManga.create();
    manga.status = SManga.COMPLETED;
    const title = this.mangaTitle(el, "h1");
    if (title != null) manga.title = title;
    manga.thumbnail_url = this.getCover(el) ?? undefined;
    manga.genre = this.getInfo(el, "Tags");
    manga.author = this.getInfo(el, "Artists") || this.getInfo(el, "Groups");
    manga.description = this.getDescription(el, document);
    return manga;
  }

  protected getCover(element: Element): string | null {
    const img = element.selectFirst(".cover img");
    return img ? imgAttr(img) : null;
  }

  protected abstract getInfoSelector(tag: string): string;

  protected infoTagName(element: Element): string {
    return element.ownText();
  }

  /**
   * Parsing document to extract info related to [tag].
   */
  protected getInfo(element: Element, tag: string): string {
    return element
      .select(this.getInfoSelector(tag))
      .flatMap((it) => [this.infoTagName(it), removePrefix(it.select(".split_tag").text()).trim()])
      .filter(isNotBlank)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .join(", ");
  }

  protected getDescription(element: Element, document: Document | null = null): string {
    const parts: string[] = [];
    for (const tag of ["Parodies", "Characters", "Groups", "Languages", "Categories", "Category"]) {
      const info = this.getInfo(element, tag);
      if (isNotBlank(info)) parts.push(`**${tag}**: ${info}`);
    }
    const pages = this.getInfoPages(element, document);
    if (isNotBlank(pages)) parts.push(`**Pages**: ${pages}`);
    const alt = this.getInfoAlternativeTitle(element);
    if (isNotBlank(alt)) parts.push(`**Alternative title**: ${alt}`);
    const full = this.getInfoFullTitle(element);
    if (this.shortTitle && isNotBlank(full)) parts.push(`**Full title**: ${full}`);
    return parts.join("\n\n");
  }

  protected getInfoPages(_element: Element, document: Document | null = null): string | null | undefined {
    return document != null ? this.totalPages(document) : null;
  }

  protected getInfoAlternativeTitle(element: Element): string | null | undefined {
    return element.selectFirst("h1 + h2, .subtitle")?.ownText();
  }

  protected getInfoFullTitle(element: Element): string | null {
    return this.mangaFullTitle(element, "h1");
  }

  protected getTime(element: Element): number {
    return toDate(element.selectFirst(".uploaded")?.ownText(), this.dateFormat);
  }

  /* Chapters */
  protected parseChapterList(document: Document, url: string): SChapter[] {
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    const info = document.selectFirst(this.mangaDetailInfoSelector);
    chapter.scanlator = info ? this.getInfo(info, "Groups") : undefined;
    chapter.date_upload = this.getTime(document);
    chapter.url = urlWithoutDomain(url);
    return [chapter];
  }

  /* Pages */

  protected totalPages(element: Element): string {
    return this.inputIdValueOf(element, this.totalPagesSelector);
  }

  protected galleryId(element: Element): string {
    return this.inputIdValueOf(element, this.galleryIdSelector);
  }

  protected inputIdValueOf(element: Element, string: string): string {
    return element.select(`input[id=${string}]`).attr("value");
  }

  protected pagesRequest = "inc/thumbs_loader.php";
  protected galleryIdSelector = "gallery_id";
  protected loadIdSelector = "load_id";
  protected loadDirSelector = "load_dir";
  protected totalPagesSelector = "load_pages";
  protected serverSelector = "load_server";

  protected pageRequestForm(document: Document, totalPages: string, loadedPages: number): URLSearchParams {
    const token = document.select("[name=csrf-token]").attr("content");
    const serverNumber = this.serverNumber(document);

    const form = new URLSearchParams();
    form.append("u_id", this.galleryId(document));
    form.append("g_id", this.inputIdValueOf(document, this.loadIdSelector));
    form.append("img_dir", this.inputIdValueOf(document, this.loadDirSelector));
    form.append("visible_pages", String(loadedPages));
    form.append("total_pages", totalPages);
    form.append("type", "2"); // 1 would be "more", 2 is "all remaining"
    if (isNotBlank(token)) form.append("_token", token);
    if (serverNumber != null) form.append("server", serverNumber);
    return form;
  }

  protected thumbnailSelector = ".gallery_thumb";

  protected serverPrefix = "m";

  protected getServer(element: Element): string {
    const domain = new URL(this.baseUrl).hostname;
    const n = this.serverNumber(element);
    return n != null ? `${this.serverPrefix}${n}.${domain}` : new URL(this.getCover(element)!).hostname;
  }

  protected serverNumber(element: Element): string | null {
    const v = this.inputIdValueOf(element, this.serverSelector);
    return isNotBlank(v) ? v : null;
  }

  protected parseJson(element: Element): string | null {
    const data = element.select("script").find((s) => s.data().includes("parseJSON"))?.data();
    if (data == null) return null;
    return substringBefore(substringAfter(data, "$.parseJSON('"), "');").trim();
  }

  /**
   * Page URL: $baseUrl/$pageUri/<id>/<page>
   */
  protected pageUri = "g";

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.getChapterUrl(chapter));
    return this.pageListParse(response.asJsoup());
  }

  protected async pageListParse(document: Document): Promise<Page[]> {
    const json = this.parseJson(document);

    if (json != null) {
      const loadDir = this.inputIdValueOf(document, this.loadDirSelector);
      const loadId = this.inputIdValueOf(document, this.loadIdSelector);
      const galleryId = this.galleryId(document);
      const pageUrl = `${this.baseUrl}/${this.pageUri}/${galleryId}`;

      const server = this.getServer(document);
      const imagesUri = `https://${server}/${loadDir}/${loadId}`;

      let images: Record<string, unknown>;
      try {
        images = JSON.parse(json) as Record<string, unknown>;
        if (images == null || typeof images !== "object" || Array.isArray(images)) throw new Error("not an object");
      } catch {
        // Log.e("GalleryAdults", "Failed to decode JSON")
        return this.pageListParseAlternative(document);
      }
      const pages: Page[] = [];
      // JSON string in this form: {"1":"j,1100,1148","2":"j,728,689",...
      for (const [key, value] of Object.entries(images)) {
        const ext = (typeof value === "string" ? value : JSON.stringify(value)).replaceAll('"', "").split(",")[0];
        const imageExt = ext === "p" ? "png" : ext === "b" ? "bmp" : ext === "g" ? "gif" : ext === "w" ? "webp" : "jpg";
        const idx = parseInt(key, 10);
        pages.push(new Page(idx, `${pageUrl}/${idx}/`, `${imagesUri}/${key}.${imageExt}`));
      }
      return pages;
    }
    return this.pageListParseAlternative(document);
  }

  /**
   * Overwrite this to force extension not blindly converting thumbnails to full image
   * by simply removing the trailing "t" from file name. Instead, it will open each page,
   * one by one, then parsing for actual image's URL.
   * This will be much slower but guaranteed work.
   *
   * This only apply if site doesn't provide 'parseJSON'.
   */
  protected parsingImagePageByPage = false;

  /**
   * Either:
   *  - Load all thumbnails then convert thumbnails to full images.
   *  - Or request then parse for a list of manga's page's URL,
   *   which will then request one by one to parse for page's image's URL using [imageUrlParse].
   */
  protected async pageListParseAlternative(document: Document): Promise<Page[]> {
    const totalPages = this.totalPages(document);
    const galleryId = this.galleryId(document);

    const pageUrl = `${this.baseUrl}/${this.pageUri}/${galleryId}`;

    if (this.parsingImagePageByPage) {
      return Array.from({ length: parseInt(totalPages, 10) }, (_, i) => new Page(i + 1, `${pageUrl}/${i + 1}/`));
    }
    const pages = document.select(`${this.thumbnailSelector} a`).flatMap((it) => {
      const img = it.selectFirst("img");
      return img ? [imgAttr(img)] : [];
    });

    if (totalPages !== "" && parseInt(totalPages, 10) > pages.length) {
      const form = this.pageRequestForm(document, totalPages, pages.length);

      const morePages = (await this.client.post(`${this.baseUrl}/${this.pagesRequest}`, this.xhrHeaders, form))
        .asJsoup()
        .select("a")
        .flatMap((it) => {
          const img = it.selectFirst("img");
          return img ? [imgAttr(img)] : [];
        });
      if (morePages.length > 0) pages.push(...morePages);
      else return this.pageListParseDummy(document);
    }
    return pages.map((url, idx) => new Page(idx, "", thumbnailToFull(url)));
  }

  /**
   * Generate all images using `totalPages`. Supposedly they are sequential.
   * Use in case any extension doesn't know how to request for "All thumbnails"
   */
  protected pageListParseDummy(document: Document): Page[] {
    const loadDir = this.inputIdValueOf(document, this.loadDirSelector);
    const loadId = this.inputIdValueOf(document, this.loadIdSelector);

    const server = this.getServer(document);
    const imagesUri = `https://${server}/${loadDir}/${loadId}`;

    const images = document.select(`${this.thumbnailSelector} img`);
    const thumbUrls = images.map((it) => imgAttr(it));

    const totalPages = this.totalPages(document);

    if (isNotBlank(totalPages) && parseInt(totalPages, 10) > thumbUrls.length) {
      const imagesExt = substringAfterLast(imgAttr(images.first()!), ".");
      for (let it = images.length + 1; it <= parseInt(totalPages, 10); it++) thumbUrls.push(`${imagesUri}/${it}t.${imagesExt}`);
    }
    return thumbUrls.map((url, idx) => new Page(idx, "", thumbnailToFull(url)));
  }

  override async getImageUrl(page: Page): Promise<string> {
    return this.imageUrlParse((await this.client.get(page.url)).asJsoup());
  }

  protected imageUrlParse(document: Document): string {
    const img = document.selectFirst("img#gimg, img#fimg, img#readerImg");
    return img ? imgAttr(img) : "";
  }

  /* Filters */

  protected maxTagPages = 5;

  protected tagsPath = "tags/popular";

  /**
   * Parsing [document] to return tags in <name: uri> Map.
   */
  protected tagsParser(document: Document): Record<string, string> {
    const out: Record<string, string> = {};
    for (const it of document.select("a.tag_btn")) out[it.select(".list_tag, .tag_name").text()] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    return out;
  }

  override get supportsFilterFetching(): boolean {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const genres: Record<string, string> = {};
    await Promise.all(
      Array.from({ length: this.maxTagPages }, async (_, i) => {
        const doc = await this.client
          .get(this.addPageUri(`${this.baseUrl}/${this.tagsPath}`, i + 1))
          .then((r) => r.asJsoup())
          .catch(() => null);
        if (doc) Object.assign(genres, this.tagsParser(doc));
      }),
    );
    return genres;
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = data != null && typeof data === "object" ? (data as Record<string, string>) : {};

    const filters: Filter[] = [];
    if (this.useIntermediateSearch) filters.push(new Filter.Header("HINT: Separate search term with comma (,)"));

    filters.push(new SortOrderFilter(this.getSortOrderURIs()));

    if (Object.keys(genres).length > 0) filters.push(new GenresFilter(genres));

    if (this.useIntermediateSearch || this.supportAdvancedSearch) {
      filters.push(new Filter.Separator(), new CategoryFilters(this.getCategoryURIs()));
    }

    if (this.supportAdvancedSearch) {
      filters.push(
        new Filter.Separator(),
        new Filter.Header("Advanced filters will ignore query search. Separate terms by comma (,) and precede term with minus (-) to exclude."),
        new TagsFilter(),
        new ParodiesFilter(),
        new ArtistsFilter(),
        new CharactersFilter(),
        new GroupsFilter(),
      );
    }

    filters.push(new Filter.Separator());

    if (this.supportSpeechless) filters.push(new SpeechlessFilter());
    filters.push(new FavoriteFilter());

    filters.push(new RandomEntryFilter());

    return filters;
  }

  protected getSortOrderURIs(): [string, string][] {
    return [
      ["Popular", "pp"],
      ["Latest", "lt"],
      ...(this.useIntermediateSearch || this.supportAdvancedSearch
        ? ([
            ["Downloads", "dl"],
            ["Top Rated", "tr"],
          ] as [string, string][])
        : []),
    ];
  }

  protected getCategoryURIs(): SearchFlagFilter[] {
    return [
      new SearchFlagFilter("Manga", "m"),
      new SearchFlagFilter("Doujinshi", "d"),
      new SearchFlagFilter("Western", "w"),
      new SearchFlagFilter("Image Set", "i"),
      new SearchFlagFilter("Artist CG", "a"),
      new SearchFlagFilter("Game CG", "g"),
    ];
  }

  protected getLanguageURIs(): [string, string][] {
    return [
      [LANGUAGE_ENGLISH, "en"],
      [LANGUAGE_JAPANESE, "jp"],
      [LANGUAGE_SPANISH, "es"],
      [LANGUAGE_FRENCH, "fr"],
      [LANGUAGE_KOREAN, "kr"],
      [LANGUAGE_GERMAN, "de"],
      [LANGUAGE_RUSSIAN, "ru"],
    ];
  }

  /* Preferences */
  protected useShortTitlePreference = true;

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = PREF_SHORT_TITLE;
    pref.title = "Display Short Titles";
    // summaryOff = "Showing Long Titles", summaryOn = "Showing short Titles": the SDK has one summary
    pref.summary = "Showing short Titles";
    pref.setDefaultValue(false);
    // setVisible(useShortTitlePreference)
    if (this.useShortTitlePreference) screen.addPreference(pref);
  }

  protected get shortTitle(): boolean {
    return this.preferences.getBoolean(PREF_SHORT_TITLE, false);
  }
}

/** .removePrefix("| ") */
const removePrefix = (s: string, prefix = "| ") => (s.startsWith(prefix) ? s.slice(prefix.length) : s);
