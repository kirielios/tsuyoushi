// Port of keiyoushi/extensions-source lib-multisrc/madaralegacy/Madara.kt
import {
  Base64,
  DateTimeFormatter,
  Filter,
  GET,
  HttpSource,
  Intl,
  Locale,
  MangasPage,
  POST,
  Page,
  SChapter,
  SManga,
  aesCbcDecrypt,
  distinctBy,
  evpBytesToKey,
  fromUtf8,
  hexBytes,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  utf8,
  type Document,
  type Element,
  type FilterList,
  type Request,
  type Response,
} from "../../sdk/index.ts";
import { AdultContentFilter, ArtistFilter, AuthorFilter, GenreConditionFilter, GenreList, OrderByFilter, StatusFilter, Tag, YearFilter, type Genre } from "./filters.ts";
import { messages } from "./messages.ts";

export enum LoadMoreStrategy {
  AutoDetect,
  Always,
  Never,
}

enum LoadMoreDetection {
  Pending,
  True,
  False,
}

export class WordSet {
  private readonly words: string[];
  constructor(...words: string[]) {
    this.words = words;
  }
  anyWordIn(dateString: string) {
    return this.words.some((it) => dateString.toLowerCase().includes(it.toLowerCase()));
  }
  startsWith(dateString: string) {
    return this.words.some((it) => dateString.toLowerCase().startsWith(it.toLowerCase()));
  }
  endsWith(dateString: string) {
    return this.words.some((it) => dateString.toLowerCase().endsWith(it.toLowerCase()));
  }
}

export const URL_SEARCH_PREFIX = "slug:";
const URL_REGEX = /^(https?:\/\/[^\s/$.?#].[^\s]*)$/;
const IMAGE_DESCRIPTOR_REGEX = /^(\d+|\d+\.\d+)([wx])$/;

/**
 * Jsoup's attr("abs:srcset"): java.net.URL resolves the whole list and keeps its spaces, where WHATWG URL encodes them
 * to %20 and breaks the split. An absolute list is returned as is.
 */
export const absSrcset = (element: Element) => {
  const raw = element.attr("srcset").trim();
  return /^https?:/i.test(raw) ? raw : element.attr("abs:srcset");
};

/** Calendar.getInstance() at local midnight, `days` ago. */
const localMidnight = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export abstract class Madara extends HttpSource {
  protected dateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.US);

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    return h;
  }

  private _xhrHeaders?: Headers;
  protected get xhrHeaders(): Headers {
    if (!this._xhrHeaders) {
      this._xhrHeaders = this.headersBuilder();
      this._xhrHeaders.set("X-Requested-With", "XMLHttpRequest");
    }
    return this._xhrHeaders;
  }

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "pt-BR", "es"], messages });

  /**
   * If enabled, will attempt to remove non-manga items in popular and latest.
   * The filter will not be used in search as the theme doesn't set the CSS class.
   * Can be disabled if the source incorrectly sets the entry types.
   */
  protected filterNonMangaItems = true;

  /** The CSS selector used to filter manga items in popular and latest if `filterNonMangaItems` is set. */
  protected get mangaEntrySelector(): string {
    return this.filterNonMangaItems ? ".manga" : "";
  }

  /** Disable it if you don't want the genres to be fetched. */
  protected fetchGenres = true;

  /** The path used in the URL for the manga pages. */
  protected mangaSubString = "manga";

  /** enable if the site use "madara_load_more" to load manga on the site */
  protected useLoadMoreStrategy = LoadMoreStrategy.AutoDetect;

  private loadMoreRequestDetected = LoadMoreDetection.Pending;

  protected detectLoadMore(document: Document) {
    if (this.useLoadMoreStrategy === LoadMoreStrategy.AutoDetect && this.loadMoreRequestDetected === LoadMoreDetection.Pending) {
      this.loadMoreRequestDetected = document.selectFirst("nav.navigation-ajax") != null ? LoadMoreDetection.True : LoadMoreDetection.False;
    }
  }

  /** useLoadMoreRequest() upstream; the property it reads is `useLoadMoreStrategy` here (TS has one namespace for both). */
  protected useLoadMoreRequest(): boolean {
    switch (this.useLoadMoreStrategy) {
      case LoadMoreStrategy.Always:
        return true;
      case LoadMoreStrategy.Never:
        return false;
      default:
        return this.loadMoreRequestDetected === LoadMoreDetection.True;
    }
  }

  // Popular Manga

  protected override popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const entries = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const next = this.popularMangaNextPageSelector();
    const hasNextPage = next != null && document.selectFirst(next) != null;
    this.detectLoadMore(document);
    return new MangasPage(entries, hasNextPage);
  }

  // exclude/filter bilibili manga from list
  protected popularMangaSelector() {
    return `div.page-item-detail:not(:has(a[href*='bilibilicomics.com']))${this.mangaEntrySelector} , .manga__item`;
  }

  protected popularMangaUrlSelector = "div.post-title a";
  protected popularMangaUrlSelectorImg = "img";

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst(this.popularMangaUrlSelector)!;
    manga.url = urlWithoutDomain(it.attr("abs:href"));
    manga.title = it.ownText();
    const img = element.selectFirst(this.popularMangaUrlSelectorImg);
    if (img) manga.thumbnail_url = this.processThumbnail(this.imageFromElement(img), true) ?? undefined;
    return manga;
  }

  protected popularMangaRequest(page: number): Request {
    return this.useLoadMoreRequest() ? this.loadMoreRequest(page, true) : GET(`${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?m_orderby=views`, this.headers);
  }

  protected popularMangaNextPageSelector(): string | null {
    return this.useLoadMoreRequest() ? "body:not(:has(.no-posts))" : "div.nav-previous, nav.navigation-ajax, a.nextpostslink";
  }

  // Related Manga
  override get supportsRelatedMangas() {
    return true;
  }
  protected relatedMangaSelector() {
    return ".related-reading-wrap";
  }

  protected override async relatedMangaListParse(response: Response): Promise<SManga[]> {
    const document = response.asJsoup();
    return document.select(this.relatedMangaSelector()).flatMap((manga) => {
      const m = SManga.create();
      const a = manga.selectFirst(".widget-title a");
      if (!a) return [];
      m.url = urlWithoutDomain(a.attr("abs:href"));
      m.title = a.ownText();
      const img = manga.selectFirst(".widget-thumbnail img");
      if (img) m.thumbnail_url = this.processThumbnail(this.imageFromElement(img), true) ?? undefined;
      return [m];
    });
  }

  // Latest Updates

  protected latestUpdatesSelector() {
    return this.popularMangaSelector();
  }

  protected latestUpdatesFromElement(element: Element): SManga {
    // Even if it's different from the popular manga's list, the relevant classes are the same
    return this.popularMangaFromElement(element);
  }

  protected latestUpdatesRequest(page: number): Request {
    return this.useLoadMoreRequest() ? this.loadMoreRequest(page, false) : GET(`${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?m_orderby=latest`, this.headers);
  }

  protected latestUpdatesNextPageSelector(): string | null {
    return this.popularMangaNextPageSelector();
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    const mp = this.popularMangaParse(response);
    return new MangasPage(
      distinctBy(mp.mangas, (it) => it.url),
      mp.hasNextPage,
    );
  }

  // load more
  protected loadMoreRequest(page: number, popular: boolean): Request {
    const formBody = new URLSearchParams();
    formBody.append("action", "madara_load_more");
    formBody.append("page", String(page - 1));
    formBody.append("template", "madara-core/content/content-archive");
    formBody.append("vars[orderby]", "meta_value_num");
    formBody.append("vars[paged]", "1");
    if (this.filterNonMangaItems) {
      formBody.append("vars[meta_query][0][key]", "_wp_manga_chapter_type");
      formBody.append("vars[meta_query][0][value]", "manga");
    }
    formBody.append("vars[post_type]", "wp-manga");
    formBody.append("vars[post_status]", "publish");
    formBody.append("vars[meta_key]", popular ? "_wp_manga_views" : "_latest_update");
    formBody.append("vars[order]", "desc");
    formBody.append("vars[sidebar]", "right");
    formBody.append("vars[manga_archives_item_layout]", "big_thumbnail");
    return POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.xhrHeaders, formBody);
  }

  // Search Manga

  /** Upstream handles pasted URLs itself in fetchSearchManga, so KeiSource's URL routing is bypassed. */
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = toHttpUrl(query);
      if (url.host !== toHttpUrl(this.baseUrl).host) throw new Error("Unsupported url");
      if (url.pathSegments.length < 2) throw new Error("Unsupported url");
      const slug = url.pathSegments[1];
      return this.fetchSearchManga(page, `${URL_SEARCH_PREFIX}${slug}`, filters);
    }
    if (query.startsWith(URL_SEARCH_PREFIX)) {
      const mangaUrl = toHttpUrl(this.baseUrl).newBuilder().addPathSegment(this.mangaSubString).addPathSegment(substringAfter(query, URL_SEARCH_PREFIX)).addPathSegment("").build(); // add trailing slash
      const response = await this.executeSuccess(GET(mangaUrl, this.headers));
      const manga = await this.mangaDetailsParse(response.asJsoup());
      manga.url = urlWithoutDomain(mangaUrl.toString());
      manga.initialized = true;
      return new MangasPage([manga], false);
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchPage(page: number): string {
    return page === 1 ? "" : `page/${page}/`;
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request | Promise<Request> {
    return this.useLoadMoreRequest() ? this.searchLoadMoreRequest(page, query, filters) : this.searchRequest(page, query, filters);
  }

  protected searchRequest(page: number, query: string, filters: FilterList): Request {
    const url = toHttpUrl(`${this.baseUrl}/${this.searchPage(page)}`).newBuilder();
    url.addQueryParameter("s", query);
    url.addQueryParameter("post_type", "wp-manga");
    for (const filter of filters) {
      if (filter instanceof AuthorFilter) {
        if (filter.state.trim()) url.addQueryParameter("author", filter.state);
      } else if (filter instanceof ArtistFilter) {
        if (filter.state.trim()) url.addQueryParameter("artist", filter.state);
      } else if (filter instanceof YearFilter) {
        if (filter.state.trim()) url.addQueryParameter("release", filter.state);
      } else if (filter instanceof StatusFilter) {
        filter.state.forEach((it) => {
          if (it.state) url.addQueryParameter("status[]", it.id);
        });
      } else if (filter instanceof OrderByFilter) {
        if (filter.state !== 0) url.addQueryParameter("m_orderby", filter.toUriPart());
      } else if (filter instanceof AdultContentFilter) {
        url.addQueryParameter("adult", filter.toUriPart());
      } else if (filter instanceof GenreConditionFilter) {
        url.addQueryParameter("op", filter.toUriPart());
      } else if (filter instanceof GenreList) {
        filter.state.filter((it) => it.state).forEach((genre) => url.addQueryParameter("genre[]", genre.id));
      }
    }
    return GET(url.build(), this.headers);
  }

  protected searchLoadMoreRequest(page: number, query: string, filters: FilterList): Request | Promise<Request> {
    const add = (k: string, v: string) => formBody.append(k, v);
    const formBody = new URLSearchParams();
    add("action", "madara_load_more");
    add("page", String(page - 1));
    add("template", "madara-core/content/content-search");
    add("vars[paged]", "1");
    add("vars[template]", "archive");
    add("vars[sidebar]", "right");
    add("vars[post_type]", "wp-manga");
    add("vars[post_status]", "publish");
    add("vars[manga_archives_item_layout]", "big_thumbnail");
    if (this.filterNonMangaItems) {
      add("vars[meta_query][0][key]", "_wp_manga_chapter_type");
      add("vars[meta_query][0][value]", "manga");
    }
    add("vars[s]", query);

    let metaQueryIdx = this.filterNonMangaItems ? 1 : 0;
    let taxQueryIdx = 0;
    const genreList = filters.find((it): it is GenreList => it instanceof GenreList);
    const genres = genreList ? genreList.state.filter((it) => it.state).map((it) => it.id) : [];

    const tax = (taxonomy: string, terms: string) => {
      add(`vars[tax_query][${taxQueryIdx}][taxonomy]`, taxonomy);
      add(`vars[tax_query][${taxQueryIdx}][field]`, "name");
      add(`vars[tax_query][${taxQueryIdx}][terms]`, terms);
      taxQueryIdx++;
    };

    for (const filter of filters) {
      if (filter instanceof AuthorFilter) {
        if (filter.state.trim()) tax("wp-manga-author", filter.state);
      } else if (filter instanceof ArtistFilter) {
        if (filter.state.trim()) tax("wp-manga-artist", filter.state);
      } else if (filter instanceof YearFilter) {
        if (filter.state.trim()) tax("wp-manga-release", filter.state);
      } else if (filter instanceof StatusFilter) {
        const statuses = filter.state.filter((it) => it.state).map((it) => it.id);
        if (statuses.length) {
          add(`vars[meta_query][${metaQueryIdx}][key]`, "_wp_manga_status");
          statuses.forEach((slug, i) => add(`vars[meta_query][${metaQueryIdx}][value][${i}]`, slug));
          metaQueryIdx++;
        }
      } else if (filter instanceof OrderByFilter) {
        if (filter.state !== 0) {
          switch (filter.toUriPart()) {
            case "latest":
              add("vars[orderby]", "meta_value_num");
              add("vars[order]", "DESC");
              add("vars[meta_key]", "_latest_update");
              break;
            case "alphabet":
              add("vars[orderby]", "post_title");
              add("vars[order]", "ASC");
              break;
            case "rating":
              add("vars[orderby][query_average_reviews]", "DESC");
              add("vars[orderby][query_total_reviews]", "DESC");
              break;
            case "trending":
              add("vars[orderby]", "meta_value_num");
              add("vars[meta_key]", "_wp_manga_week_views_value");
              add("vars[order]", "DESC");
              break;
            case "views":
              add("vars[orderby]", "meta_value_num");
              add("vars[meta_key]", "_wp_manga_views");
              add("vars[order]", "DESC");
              break;
            default:
              add("vars[orderby]", "date");
              add("vars[order]", "DESC");
          }
        }
      } else if (filter instanceof AdultContentFilter) {
        if (filter.state !== 0) {
          add(`vars[meta_query][${metaQueryIdx}][key]`, "manga_adult_content");
          add(`vars[meta_query][${metaQueryIdx}][compare]`, filter.state === 1 ? "not exists" : "exists");
          metaQueryIdx++;
        }
      } else if (filter instanceof GenreConditionFilter) {
        if (filter.state === 1 && genres.length) add(`vars[tax_query][${taxQueryIdx}][operation]`, "AND");
      } else if (filter instanceof GenreList) {
        if (genres.length) {
          add(`vars[tax_query][${taxQueryIdx}][taxonomy]`, "wp-manga-genre");
          add(`vars[tax_query][${taxQueryIdx}][field]`, "slug");
          genres.forEach((slug, i) => add(`vars[tax_query][${taxQueryIdx}][terms][${i}]`, slug));
          taxQueryIdx++;
        }
      }
    }
    return POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.xhrHeaders, formBody);
  }

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

  protected adultContentFilterOptions: [string, string][] = [
    [this.intl.get("adult_content_filter_all"), ""],
    [this.intl.get("adult_content_filter_none"), "0"],
    [this.intl.get("adult_content_filter_only"), "1"],
  ];

  // Genres: upstream fetches them in the background from getFilterList (3 attempts); here the host fetches and caches them.
  override get supportsFilterFetching() {
    return this.fetchGenres;
  }
  override async fetchFilterData(): Promise<unknown> {
    return this.parseGenres((await this.executeSuccess(this.genresRequest())).asJsoup());
  }

  override getFilterList(data: unknown = null): FilterList {
    const genresList = Array.isArray(data) ? (data as Genre[]) : [];
    const filters: Filter[] = [
      new AuthorFilter(this.intl.get("author_filter_title")),
      new ArtistFilter(this.intl.get("artist_filter_title")),
      new YearFilter(this.intl.get("year_filter_title")),
      new StatusFilter(
        this.intl.get("status_filter_title"),
        this.statusFilterOptions.map(([k, v]) => new Tag(k, v)),
      ),
      new OrderByFilter(this.intl.get("order_by_filter_title"), this.orderByFilterOptions, 0),
      new AdultContentFilter(this.intl.get("adult_content_filter_title"), this.adultContentFilterOptions),
    ];
    if (genresList.length) {
      filters.push(
        new Filter.Separator(),
        new Filter.Header(this.intl.get("genre_filter_header")),
        new GenreConditionFilter(this.intl.get("genre_condition_filter_title"), this.genreConditionFilterOptions),
        new GenreList(this.intl.get("genre_filter_title"), genresList),
      );
    } else if (this.fetchGenres) {
      filters.push(new Filter.Separator(), new Filter.Header(this.intl.get("genre_missing_warning")));
    }
    return filters;
  }

  protected override searchMangaParse(response: Response): MangasPage | Promise<MangasPage> {
    const document = response.asJsoup();
    const entries = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
    const next = this.searchMangaNextPageSelector();
    const hasNextPage = next != null && document.selectFirst(next) != null;
    this.detectLoadMore(document);
    return new MangasPage(entries, hasNextPage);
  }

  protected searchMangaSelector() {
    return "div.c-tabs-item__content , .manga__item";
  }

  protected searchMangaUrlSelector = "div.post-title a";

  protected searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst(this.searchMangaUrlSelector)!;
    manga.url = urlWithoutDomain(it.attr("abs:href"));
    manga.title = it.ownText();
    const img = element.selectFirst("img");
    if (img) manga.thumbnail_url = this.processThumbnail(this.imageFromElement(img), true) ?? undefined;
    return manga;
  }

  protected searchMangaNextPageSelector(): string | null {
    return this.popularMangaNextPageSelector();
  }

  // Manga Details Parse

  protected readonly completedStatusList = ["Completed", "Completo", "Completado", "Concluído", "Concluido", "Finalizado", "Achevé", "Terminé", "Hoàn Thành", "مكتملة", "مكتمل", "已完结", "Tamamlandı", "Đã hoàn thành", "Завершено", "Tamamlanan", "Complété"];

  protected readonly ongoingStatusList = [
    "OnGoing", "Продолжается", "Updating", "Em Lançamento", "Em lançamento", "Em andamento",
    "Em Andamento", "En cours", "En Cours", "En cours de publication", "Ativo", "Lançando", "Đang Tiến Hành", "Còn Nữa", "Devam Ediyor",
    "Devam ediyor", "In Corso", "In Arrivo", "مستمرة", "مستمر", "En Curso", "En curso", "Emision",
    "Curso", "En marcha", "Publicandose", "Publicándose", "En emision", "连载中", "Em Lançamento", "Devam Ediyo",
    "Đang làm", "Em postagem", "Devam Eden", "Em progresso", "Em curso", "Atualizações Semanais",
  ]; // prettier-ignore

  protected readonly hiatusStatusList = ["On Hold", "Pausado", "En espera", "Durduruldu", "Beklemede", "Đang chờ", "متوقف", "En Pause", "Заморожено", "En attente"];

  protected readonly canceledStatusList = ["Canceled", "Cancelado", "İptal Edildi", "Güncel", "Đã hủy", "ملغي", "Abandonné", "Заброшено", "Annulé"];

  /** mangaDetailsParse(response) = mangaDetailsParse(response.asJsoup()): the Document goes in (see sdk/httpsource.ts). */
  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    return this.mangaDetailsParse((await this.executeSuccess(await this.mangaDetailsRequest(manga))).asJsoup());
  }

  protected override mangaDetailsParse(document: Document | Response): SManga | Promise<SManga> {
    if (!("select" in document)) document = document.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst(this.mangaDetailsSelectorTitle)!.ownText();
    const author = document
      .select(this.mangaDetailsSelectorAuthor)
      .eachText()
      .filter((it) => this.notUpdating(it))
      .join(", ");
    if (author.trim()) manga.author = author;
    const artist = document
      .select(this.mangaDetailsSelectorArtist)
      .eachText()
      .filter((it) => this.notUpdating(it))
      .join(", ");
    if (artist.trim()) manga.artist = artist;
    const desc = document.select(this.mangaDetailsSelectorDescription);
    if (desc.select("p").text() !== "") {
      manga.description = desc
        .select("p")
        .map((p) => p.text().replaceAll("<br>", "\n"))
        .join("\n\n");
    } else {
      manga.description = desc.text();
    }
    const thumb = document.selectFirst(this.mangaDetailsSelectorThumbnail);
    if (thumb) manga.thumbnail_url = this.processThumbnail(this.imageFromElement(thumb)) ?? undefined;
    const statusEl = document.select(this.mangaDetailsSelectorStatus).last();
    if (statusEl) {
      const s = [...statusEl.text()].filter((ch) => /[\p{L}\p{Nd}\s]/u.test(ch)).join("").trim();
      manga.status = this.containsIn(s, this.completedStatusList)
        ? SManga.COMPLETED
        : this.containsIn(s, this.ongoingStatusList)
          ? SManga.ONGOING
          : this.containsIn(s, this.hiatusStatusList)
            ? SManga.ON_HIATUS
            : this.containsIn(s, this.canceledStatusList)
              ? SManga.CANCELLED
              : SManga.UNKNOWN;
    }
    const genres = document.select(this.mangaDetailsSelectorGenre).map((element) => element.text());

    if (this.mangaDetailsSelectorTag !== "") {
      const has = (text: string, s: string) => text.toLowerCase().includes(s.toLowerCase());
      document.select(this.mangaDetailsSelectorTag).forEach((element) => {
        const t = element.text();
        if (t.length <= 25 && !has(t, "read") && !has(t, this.name) && !has(t, this.name.replaceAll(" ", "")) && !has(t, manga.title) && !has(t, this.altName)) {
          genres.push(t);
        }
      });
    }

    // add manga/manhwa/manhua thinggy to genre
    const type = document.selectFirst(this.seriesTypeSelector)?.ownText();
    if (type != null && type !== "" && this.notUpdating(type) && type !== "-") genres.push(type);

    manga.genre = distinctBy(genres, (it) => it.toLowerCase()).join(", ");

    // add alternative name to manga description
    const alt = document.selectFirst(this.altNameSelector)?.ownText();
    if (alt != null && alt.trim() && this.notUpdating(alt)) {
      manga.description = !manga.description?.trim() ? `${this.altName} ${alt}` : `${manga.description}\n\n${this.altName} ${alt}`;
    }
    return manga;
  }

  // Manga Details Selector
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
  protected altName = this.intl.get("alt_names_heading");
  protected updatingRegex = /Updating|Atualizando/i;

  protected notUpdating(s: string): boolean {
    return !this.updatingRegex.test(s);
  }

  private containsIn(s: string, array: string[]): boolean {
    return array.map((it) => it.toLowerCase()).includes(s.toLowerCase());
  }

  protected imageFromElement(element: Element): string | null {
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("srcset")) return this.getSrcSetImage(absSrcset(element));
    if (element.hasAttr("data-cfsrc")) return element.attr("abs:data-cfsrc");
    if (element.hasAttr("data-manga-src")) return element.attr("abs:data-manga-src");
    return element.attr("abs:src");
  }

  /** Get the best image quality available from srcset */
  protected getSrcSetImage(srcset: string): string | null {
    const images = srcset
      .split(",")
      .map((it) => {
        const m = /^(\S*)(?:\s+([\s\S]*))?$/.exec(it.trim()); // split(WHITESPACE_REGEX, limit = 2)
        return m![2] !== undefined ? [m![1], m![2]] : [m![1]];
      })
      .filter((it) => it.length && URL_REGEX.test(it[0]));

    const imagesWithDescriptor = images
      .filter((it) => it.length === 2)
      .flatMap((candidate): [string, number][] => {
        const match = IMAGE_DESCRIPTOR_REGEX.exec(candidate[1]);
        return match ? [[candidate[0], parseFloat(match[1])]] : [];
      });

    // Prefer images with descriptors as to get the highest resolution
    if (imagesWithDescriptor.length) return imagesWithDescriptor.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

    // Fallback to lexicographical comparison of image URLs
    return images.length ? images.map((it) => it[0]).reduce((a, b) => (b > a ? b : a)) : null;
  }

  /** Apply any additional processing to the thumbnail URL if needed. */
  protected processThumbnail(url: string | null, _fromSearch = false): string | null {
    return url;
  }

  /** Set it to true if the source uses the new AJAX endpoint to fetch the manga chapters instead of admin-ajax.php. */
  protected useNewChapterEndpoint = false;

  private oldChapterEndpointDisabled = false;

  protected oldXhrChaptersRequest(mangaId: string): Request {
    const form = new URLSearchParams({ action: "manga_get_chapters", manga: mangaId });
    return POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.xhrHeaders, form);
  }

  protected xhrChaptersRequest(mangaUrl: string): Request {
    return POST(`${mangaUrl}/ajax/chapters`, this.xhrHeaders);
  }

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    const document = response.asJsoup();
    this.countViews(document);

    const chaptersWrapper = document.select("div[id^=manga-chapters-holder]");
    let chapterElements = document.select(this.chapterListSelector());

    if (chapterElements.length === 0 && chaptersWrapper.length) {
      const mangaUrl = document.location().replace(/\/$/, "");
      const mangaId = chaptersWrapper.attr("data-id");

      let xhrRequest = this.useNewChapterEndpoint || this.oldChapterEndpointDisabled ? this.xhrChaptersRequest(mangaUrl) : this.oldXhrChaptersRequest(mangaId);
      let xhrResponse = await this.client.execute(xhrRequest);

      // Newer Madara versions throws HTTP 400 when using the old endpoint.
      if (!this.useNewChapterEndpoint && xhrResponse.code === 400) {
        // Set it to true so following calls will be made directly to the new endpoint.
        this.oldChapterEndpointDisabled = true;
        xhrRequest = this.xhrChaptersRequest(mangaUrl);
        xhrResponse = await this.client.execute(xhrRequest);
      }
      chapterElements = xhrResponse.asJsoup().select(this.chapterListSelector());
    }
    return chapterElements.map((it) => this.chapterFromElement(it));
  }

  protected chapterListSelector() {
    return "li.wp-manga-chapter";
  }

  protected chapterDateSelector() {
    return "span.chapter-release-date";
  }

  protected chapterUrlSelector = "a";

  // can cause some issue for some site. blocked by cloudflare when opening the chapter pages
  protected chapterUrlSuffix = "?style=list";

  protected chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const urlElement = element.selectFirst(this.chapterUrlSelector)!;
    const href = urlElement.attr("abs:href");
    chapter.url = substringBefore(href, "?style=paged") + (!href.endsWith(this.chapterUrlSuffix) ? this.chapterUrlSuffix : "");
    chapter.name = urlElement.text();
    // Dates can be part of a "new" graphic or plain text
    // Added "title" alternative
    const imgAlt = element.selectFirst("img:not(.thumb)")?.attr("alt");
    const spanTitle = element.selectFirst("span a")?.attr("title");
    chapter.date_upload =
      imgAlt != null ? this.parseRelativeDate(imgAlt) : spanTitle != null ? this.parseRelativeDate(spanTitle) : this.parseChapterDate(element.selectFirst(this.chapterDateSelector())?.text() ?? null);
    return chapter;
  }

  parseChapterDate(date: string | null): number {
    if (date == null) return 0;
    if (new WordSet("yesterday", "يوم واحد").startsWith(date)) return localMidnight(1);
    if (new WordSet("today").startsWith(date)) return localMidnight(0);
    if (new WordSet("يومين").startsWith(date)) return localMidnight(2);
    if (new WordSet("ago", "atrás", "önce", "قبل", "trước").endsWith(date)) return this.parseRelativeDate(date);
    if (new WordSet("hace", "năm", "tháng", "tuần", "ngày", "giờ", "phút", "giây").startsWith(date)) return this.parseRelativeDate(date);
    // Handle "jour" with a number before it
    if (/\b\d+ jour/.test(date)) return this.parseRelativeDate(date);
    if (/\d(st|nd|rd|th)/.test(date)) {
      // Clean date (e.g. 5th December 2019 to 5 December 2019) before parsing it
      const cleaned = date
        .split(" ")
        .map((it) => (/\d\D\D/.test(it) ? it.replace(/\D/g, "") : it))
        .join(" ");
      return this.dateFormat.tryParseDate(cleaned);
    }
    return this.dateFormat.tryParseDate(date);
  }

  // Parses dates in this form:
  // 21 horas ago
  protected parseRelativeDate(date: string): number {
    const m = /(\d+)/.exec(date);
    const number = m ? parseInt(m[1], 10) : NaN;
    if (Number.isNaN(number)) return 0;
    const cal = new Date();
    if (new WordSet("hari", "gün", "jour", "día", "dia", "day", "วัน", "ngày", "giorni", "أيام", "天").anyWordIn(date)) cal.setDate(cal.getDate() - number);
    else if (new WordSet("jam", "saat", "heure", "hora", "hour", "ชั่วโมง", "giờ", "ore", "ساعة", "小时").anyWordIn(date)) cal.setHours(cal.getHours() - number);
    else if (new WordSet("menit", "dakika", "min", "minute", "minuto", "นาที", "دقائق", "phút").anyWordIn(date)) cal.setMinutes(cal.getMinutes() - number);
    else if (new WordSet("detik", "segundo", "second", "วินาที", "giây").anyWordIn(date)) cal.setSeconds(cal.getSeconds() - number);
    else if (new WordSet("week", "semana", "tuần").anyWordIn(date)) cal.setDate(cal.getDate() - number * 7);
    else if (new WordSet("month", "mes", "tháng").anyWordIn(date)) cal.setMonth(cal.getMonth() - number);
    else if (new WordSet("year", "año", "năm").anyWordIn(date)) cal.setFullYear(cal.getFullYear() - number);
    else return 0;
    return cal.getTime();
  }

  protected override pageListRequest(chapter: SChapter): Request {
    if (chapter.url.startsWith("http")) return GET(chapter.url, this.headers);
    return GET(this.baseUrl + chapter.url, this.headers); // super.pageListRequest(chapter)
  }

  protected pageListParseSelector = "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item)) img";

  protected chapterProtectorSelector = "#chapter-protector-data";
  protected chapterProtectorPasswordPrefix = "wpmangaprotectornonce='";
  protected chapterProtectorDataPrefix = "chapter_data='";

  /** pageListParse(response) = pageListParse(response.asJsoup()): the Document goes in (see sdk/httpsource.ts). */
  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.executeSuccess(await this.pageListRequest(chapter))).asJsoup());
  }

  /** Async here (WebCrypto), where upstream is synchronous. */
  protected override async pageListParse(document: Document | Response): Promise<Page[]> {
    if (!("select" in document)) document = document.asJsoup();
    this.countViews(document);

    const chapterProtector = document.selectFirst(this.chapterProtectorSelector);
    if (!chapterProtector) {
      const doc = document;
      return doc.select(this.pageListParseSelector).map((element, index) => {
        const img = element.selectFirst("img");
        return new Page(index, doc.location(), (img ? this.imageFromElement(img) : null) ?? undefined);
      });
    }
    const src = chapterProtector.attr("src");
    const chapterProtectorHtml = src.startsWith("data:text/javascript;base64,") ? fromUtf8(Base64.decode(substringAfter(src, "data:text/javascript;base64,"))) : chapterProtector.html();
    const password = substringBefore(substringAfter(chapterProtectorHtml, this.chapterProtectorPasswordPrefix), "';");
    const chapterData = JSON.parse(substringBefore(substringAfter(chapterProtectorHtml, this.chapterProtectorDataPrefix), "';").replaceAll("\\/", "/")) as { ct: string; s: string };

    // CryptoAES.decrypt("Salted__" + salt + ct, password): OpenSSL EVP_BytesToKey + AES-CBC
    const { key, iv } = evpBytesToKey(utf8(password), hexBytes(chapterData.s));
    const rawImgArray = fromUtf8(await aesCbcDecrypt(key, iv, Base64.decode(chapterData.ct)));
    const imgArray = JSON.parse(JSON.parse(rawImgArray) as string) as string[];
    return imgArray.map((it, idx) => new Page(idx, document.location(), it));
  }

  override imageRequest(page: Page): Request {
    const headers = new Headers(this.headers);
    headers.set("Referer", page.url);
    return GET(page.imageUrl!, headers);
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("Not used");
  }

  /** Set it to false to disable reporting the view count back to the site through admin-ajax.php. */
  protected sendViewCount = true;

  protected countViewsRequest(document: Document): Request | null {
    const wpMangaData = document.selectFirst("script#wp-manga-js-extra")?.data();
    if (wpMangaData == null) return null;
    const wpMangaInfo = substringBeforeLast(substringAfter(wpMangaData, "var manga = "), ";");
    const wpManga = JSON.parse(wpMangaInfo) as Record<string, unknown>;
    if (wpManga.enable_manga_view != null && String(wpManga.enable_manga_view) === "1") {
      const formBody = new URLSearchParams({ action: "manga_views", manga: String(wpManga.manga_id) });
      if (wpManga.chapter_slug != null) formBody.append("chapter", String(wpManga.chapter_slug));
      const newHeaders = this.headersBuilder();
      newHeaders.set("Referer", document.location());
      return POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, newHeaders, formBody);
    }
    return null;
  }

  /** Send the view count request to the Madara endpoint (fire and forget, as upstream's launchIO). */
  protected countViews(document: Document) {
    if (!this.sendViewCount) return;
    try {
      const request = this.countViewsRequest(document);
      if (request) this.client.enqueue(request);
    } catch {
      // ignored, as upstream
    }
  }

  /** The request to the search page (or another one) that have the genres list. */
  protected genresRequest(): Request {
    return GET(`${this.baseUrl}/?s=genre&post_type=wp-manga`, this.headers);
  }

  /** Get the genres from the search page document. */
  protected parseGenres(document: Document): Genre[] {
    const group = document.selectFirst("div.checkbox-group");
    return (group ? group.select("div.checkbox") : []).map((li) => ({
      name: li.selectFirst("label")!.text(),
      id: li.selectFirst("input[type=checkbox]")!.attr("value"),
    }));
  }
}
