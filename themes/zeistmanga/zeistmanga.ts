// Port of keiyoushi/extensions-source lib-multisrc/zeistmanga/ZeistManga.kt (with ZeistMangaDto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  Intl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseHtml,
  substringAfter,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  urlWithoutDomain,
  type Document,
  type HttpUrlBuilder,
  type Response,
} from "../../sdk/index.ts";
import { Genre, GenreList, Language, LanguageList, Status, StatusList, Type, TypeList } from "./filters.ts";
import { messages } from "./messages.ts";

// ---- ZeistMangaDto.kt
type T = { $t: string };
export interface ZeistMangaDto {
  feed?: ZeistMangaFeedDto | null;
}
export interface ZeistMangaFeedDto {
  "openSearch$totalResults"?: T | null;
  "openSearch$itemsPerPage"?: T | null;
  category?: { term: string }[] | null;
  entry?: ZeistMangaEntryDto[] | null;
}
export interface ZeistMangaEntryDto {
  title?: T | null;
  published?: T | null;
  updated?: T | null;
  category?: { term: string }[] | null;
  link?: { rel: string; href: string }[] | null; // url
  content?: T | null;
  "media$thumbnail"?: { url: string } | null;
}
interface FeedUrl {
  url: string;
  old: boolean;
  new: boolean;
  category: string;
}

const getChapterLink = (list: { rel: string; href: string }[]) => {
  const link = list.find((it) => it.rel === "alternate");
  if (!link) throw new Error("Collection contains no element matching the predicate.");
  return link.href;
};
const getThumbnail = (thumbnail: { url: string }) => thumbnail.url.replace(/\/s.+?-c\//, "/w600/").replace(/=s(?!.*=s).+?-c$/, "=w600");

const MAX_MANGA_RESULTS = 20;
const MAX_CHAPTER_RESULTS = 150;
const CHAPTER_CHUNK = 50;

export abstract class ZeistManga extends KeiSource {
  protected dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd");

  protected mangaCategory = "Series";

  apiUrl(feed: string = this.mangaCategory): HttpUrlBuilder {
    return toHttpUrl(`${this.baseUrl}/feeds/posts/default/-/`).newBuilder().addPathSegment(feed).addQueryParameter("alt", "json");
  }

  protected readonly intl = new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["ar", "en", "es", "id", "pt-BR"], messages });

  /** Jsoup.parse(html, baseUri) */
  protected parseDocument(html: string, baseUri = this.baseUrl): Document {
    return parseHtml(this.host.load, html, baseUri);
  }

  toSManga(entry: ZeistMangaEntryDto): SManga {
    const manga = SManga.create();
    manga.title = entry.title!.$t;
    manga.url = substringAfter(getChapterLink(entry.link!), this.baseUrl);
    manga.thumbnail_url = entry["media$thumbnail"] == null ? this.parseDocument(entry.content!.$t).selectFirst("img")!.attr("src") : getThumbnail(entry["media$thumbnail"]);
    return manga;
  }

  toSChapter(entry: ZeistMangaEntryDto, dateUpload = 0): SChapter {
    const chapter = SChapter.create();
    chapter.name = entry.title!.$t;
    chapter.url = substringAfter(getChapterLink(entry.link!), this.baseUrl);
    chapter.date_upload = dateUpload;
    return chapter;
  }

  // Popular
  popularMangaUrl(_page: number): string {
    return this.baseUrl;
  }

  protected popularMangaSelector = "div.PopularPosts div.grid > figure";
  protected popularMangaSelectorTitle = "figcaption > a";
  protected popularMangaSelectorUrl = "figcaption > a";

  override async getPopularManga(page: number): Promise<MangasPage> {
    return this.supportsLatest ? this.parsePopularManga(await this.client.get(this.popularMangaUrl(page))) : this.getLatestUpdates(page);
  }

  parsePopularManga(response: Response): MangasPage {
    const mangas = response
      .asJsoup()
      .select(this.popularMangaSelector)
      .map((element) => {
        const manga = SManga.create();
        manga.thumbnail_url = element.selectFirst("img")!.attr("abs:src");
        manga.title = element.selectFirst(this.popularMangaSelectorTitle)!.text();
        manga.url = urlWithoutDomain(element.selectFirst(this.popularMangaSelectorUrl)!.attr("abs:href"));
        return manga;
      });
    return new MangasPage(mangas, false);
  }

  // Latest
  latestUpdatesUrl(page: number, orderBy: string | null = "published"): string {
    const startIndex = MAX_MANGA_RESULTS * (page - 1) + 1;
    return this.apiUrl()
      .addQueryParameter("orderby", orderBy)
      .addQueryParameter("max-results", String(MAX_MANGA_RESULTS + 1))
      .addQueryParameter("start-index", String(startIndex))
      .build()
      .toString();
  }

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseSearchManga(await this.client.get(this.latestUpdatesUrl(page)));
  }

  parseLastestUpdates(response: Response): MangasPage {
    return this.parseSearchManga(response);
  }

  // Search
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.pathname.slice(1).split("/").length < 3) return null;
    const doc = (await this.client.get(url)).asJsoup();
    const manga = this.mangaDetailsParse(doc);
    if (!manga.title) manga.title = substringBefore(doc.selectFirst("meta[property='og:title']")!.attr("content"), "-").trim();
    manga.url = urlWithoutDomain(url.href);
    return manga;
  }

  searchMangaUrl(_page: number, _query: string): HttpUrlBuilder {
    return this.apiUrl();
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const startIndex = MAX_MANGA_RESULTS * (page - 1) + 1;
    const url = this.searchMangaUrl(page, query);

    let searchUrlBuilder: HttpUrlBuilder;
    if (query.trim()) {
      searchUrlBuilder = url
        .addQueryParameter("q", query)
        .addQueryParameter("max-results", String(MAX_MANGA_RESULTS + 1))
        .addQueryParameter("start-index", String(startIndex));
    } else {
      for (const filter of filters) {
        if (filter instanceof StatusList || filter instanceof TypeList || filter instanceof LanguageList) url.addPathSegment(filter.selected.value);
        else if (filter instanceof GenreList) filter.state.forEach((genre) => genre.state && url.addPathSegment(genre.value));
      }
      searchUrlBuilder = url;
    }
    const searchUrl = replaceLast(searchUrlBuilder.build().toString(), "q=", `q=label:${this.mangaCategory}+`);

    return this.parseSearchManga(await this.client.get(searchUrl));
  }

  protected excludedCategories: string[] = ["Anime", "Novel", "Novela"];

  parseSearchManga(response: Response): MangasPage {
    const result = response.parseAs<ZeistMangaDto>();
    const mangas = (result.feed?.entry ?? [])
      .filter((it) => (it.category ?? []).some((category) => category.term === this.mangaCategory))
      .filter((it) => !(it.category ?? []).some((category) => this.excludedCategories.includes(category.term)))
      .map((it) => this.toSManga(it));

    if (mangas.length === MAX_MANGA_RESULTS + 1) {
      mangas.pop();
      return new MangasPage(mangas, true);
    }
    return new MangasPage(mangas, false);
  }

  // Details + Chapters
  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const feedUrl = manga.memo["feedUrl"] as FeedUrl | undefined;
    if (feedUrl != null && this.isValid(feedUrl) && this.supportsChapterFeed) {
      const [updatedManga, updatedChapters] = await Promise.all([
        (async () => {
          if (!fetchDetails) return manga;
          const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
          const details = this.mangaDetailsParse(doc);
          details.memo = manga.memo;
          return details;
        })(),
        fetchChapters ? this.getChapterList(feedUrl.url) : Promise.resolve(chapters),
      ]);
      return new SMangaUpdate(updatedManga, updatedChapters);
    }

    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const url = this.getChapterFeedUrl(doc, manga.title);

    const updatedManga = this.mangaDetailsParse(doc);
    updatedManga.memo = { feedUrl: { url, old: this.useOldChapterFeed, new: this.useNewChapterFeed, category: this.chapterCategory } satisfies FeedUrl };
    return new SMangaUpdate(updatedManga, fetchChapters ? await this.getChapterList(url, doc) : chapters);
  }

  protected statusSelectorList = ["Status", "Estado", "الحالة"];
  protected authorSelectorList = ["Author", "Autor", "Mangaka", "الكاتب", "Yazar"];
  protected artisSelectorList = ["Artist", "Artista", "الرسام", "Çizer"];

  protected mangaDetailsSelector = ".grid.gtc-235fr";
  protected mangaDetailsSelectorThumbnail = "img";
  protected mangaDetailsSelectorDescription = "#synopsis";
  protected mangaDetailsSelectorGenres = "div.mt-15 > a[rel=tag]";
  protected mangaDetailsSelectorAuthor = "span#author";
  protected mangaDetailsSelectorArtist = "span#artist";
  protected mangaDetailsSelectorAltName = "header > p";
  protected mangaDetailsSelectorStatus = "span[data-status]";
  protected mangaDetailsSelectorInfo = ".y6x11p";
  protected mangaDetailsSelectorInfoTitle = "strong";
  protected mangaDetailsSelectorInfoDescription = "span.dt";

  mangaDetailsParse(document: Document): SManga {
    const profileManga = document.selectFirst(this.mangaDetailsSelector)!;
    const manga = SManga.create();
    manga.thumbnail_url = profileManga.selectFirst(this.mangaDetailsSelectorThumbnail)!.attr("abs:src");
    let description = profileManga.select(this.mangaDetailsSelectorDescription).text() + "\n\n";
    const altName = profileManga.selectFirst(this.mangaDetailsSelectorAltName)?.text();
    if (altName?.trim()) description += this.intl.get("alternative_names") + altName;
    manga.description = description.trim();
    manga.genre = profileManga
      .select(this.mangaDetailsSelectorGenres)
      .map((it) => it.text())
      .join(", ");
    manga.author = profileManga.selectFirst(this.mangaDetailsSelectorAuthor)?.text();
    manga.artist = profileManga.selectFirst(this.mangaDetailsSelectorArtist)?.text();
    manga.status = this.parseStatus(profileManga.selectFirst(this.mangaDetailsSelectorStatus)?.text() ?? "");

    for (const element of profileManga.select(this.mangaDetailsSelectorInfo)) {
      const infoText = element.ownText().trim() || (element.selectFirst(this.mangaDetailsSelectorInfoTitle)?.text()?.trim() ?? "");
      const descText = element.select(this.mangaDetailsSelectorInfoDescription).text().trim();
      if (manga.status === SManga.UNKNOWN && this.statusSelectorList.some((it) => infoText.includes(it))) manga.status = this.parseStatus(descText);
      else if (manga.author == null && this.authorSelectorList.some((it) => infoText.includes(it))) manga.author = descText;
      else if (manga.artist == null && this.artisSelectorList.some((it) => infoText.includes(it))) manga.artist = descText;
    }
    return manga;
  }

  protected chapterCategory = "Chapter";

  preferChapterUpdatedDate = false;

  async fetchChapter(url: string, startIndex: number, maxResults: number): Promise<ZeistMangaDto> {
    const paginationUrl = toHttpUrl(url).newBuilder().setQueryParameter("start-index", String(startIndex)).setQueryParameter("max-results", String(maxResults)).build().toString();
    return (await this.client.get(paginationUrl)).parseAs<ZeistMangaDto>();
  }

  async getChapterList(feedUrl: string, _doc: Document | null = null): Promise<SChapter[]> {
    // Get total and server chunk size by initial max request.
    const result = await this.fetchChapter(feedUrl, 1, MAX_CHAPTER_RESULTS);
    const totalResults = toIntOrNull(result.feed?.["openSearch$totalResults"]?.$t) ?? MAX_CHAPTER_RESULTS;
    const itemsPerPage = toIntOrNull(result.feed?.["openSearch$itemsPerPage"]?.$t) ?? CHAPTER_CHUNK;

    const first = result.feed?.entry;
    if (first == null) throw new Error("Failed to parse from chapter API");
    const allEntries = [...first];

    const starts: number[] = [];
    for (let startIndex = allEntries.length; startIndex < totalResults; startIndex += itemsPerPage) starts.push(startIndex);
    const rest = await Promise.all(starts.map(async (startIndex) => (await this.fetchChapter(feedUrl, startIndex + 1, itemsPerPage)).feed!.entry!));
    allEntries.push(...rest.flat());

    return allEntries
      .filter((it) => (it.category ?? []).some((cat) => cat.term === this.chapterCategory))
      .map((entry) => {
        const updated = entry.updated?.$t?.trim();
        const published = entry.published?.$t?.trim();
        const dateStr = this.preferChapterUpdatedDate ? (updated ?? published) : (published ?? updated);
        return this.toSChapter(entry, this.parseDate(dateStr));
      });
  }

  protected supportsChapterFeed = true;

  protected useNewChapterFeed = false;
  protected useOldChapterFeed = false;

  protected chapterFeedRegex = /clwd\.run\(["'](.*?)["']\)/;
  protected scriptSelector = "#clwd > script";

  getChapterFeedUrl(doc: Document, mangaTitle: string): string {
    if (this.useNewChapterFeed) return this.newChapterFeedUrl(doc);
    if (this.useOldChapterFeed) return this.oldChapterFeedUrl(doc);

    let feed: string;
    try {
      const script = doc.selectFirst(this.scriptSelector);
      if (script == null) {
        try {
          return this.oldChapterFeedUrl(doc);
        } catch {
          return this.newChapterFeedUrl(doc);
        }
      }
      const found = this.chapterFeedRegex.exec(script.html())?.[1];
      if (found == null) throw new Error("Failed to find chapter feed");
      feed = found;
    } catch {
      feed = mangaTitle;
    }

    return this.apiUrl(this.chapterCategory).addPathSegments(feed).build().toString();
  }

  private readonly oldChapterFeedRegex = /([^']+)\?/;
  private readonly oldScriptSelector = "#myUL > script";

  oldChapterFeedUrl(doc: Document): string {
    const script = doc.selectFirst(this.oldScriptSelector)!.attr("src");
    const feed = this.oldChapterFeedRegex.exec(script)?.[1];
    if (feed == null) throw new Error("Failed to find chapter feed");
    return `${this.baseUrl}${feed}?alt=json`;
  }

  private readonly newChapterFeedRegex = /label\s*=\s*'([^']+)'/;
  private readonly newScriptSelector = "#latest > script";

  private newChapterFeedUrl(doc: Document): string {
    let chapterRegex = this.chapterFeedRegex;
    let script = doc.selectFirst(this.scriptSelector);

    if (script == null) {
      script = doc.selectFirst(this.newScriptSelector)!;
      chapterRegex = this.newChapterFeedRegex;
    }

    const feed = chapterRegex.exec(script.html())?.[1];
    if (feed == null) throw new Error("Failed to find chapter feed");

    return this.apiUrl(feed).addQueryParameter("start-index", "1").addQueryParameter("max-results", "999999").build().toString();
  }

  // Pages
  protected pageListSelector = "div.check-box div.separator";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  pageListParse(document: Document): Page[] {
    const images = document.select(this.pageListSelector);
    return images.select("img[src]").map((img, i) => new Page(i, "", img.attr("abs:src")));
  }

  // Filters
  protected hasFilters = false;

  protected hasStatusFilter = true;
  protected hasTypeFilter = true;
  protected hasLanguageFilter = true;
  protected hasGenreFilter = true;

  override getFilterList(_data: unknown = null): FilterList {
    const filterList: Filter[] = [];

    if (!this.hasFilters) return FilterList();

    filterList.push(new Filter.Header(this.intl.get("filter_warning")));
    filterList.push(new Filter.Separator());

    if (this.hasStatusFilter) filterList.push(new StatusList(this.intl.get("status_filter_title"), this.getStatusList()));
    if (this.hasTypeFilter) filterList.push(new TypeList(this.intl.get("type_filter_title"), this.getTypeList()));
    if (this.hasLanguageFilter) filterList.push(new LanguageList(this.intl.get("language_filter_title"), this.getLanguageList()));
    if (this.hasGenreFilter) filterList.push(new GenreList(this.intl.get("genre_filter_title"), this.getGenreList()));

    return filterList;
  }

  protected getStatusList(): Status[] {
    return [
      new Status(this.intl.get("all"), ""),
      new Status(this.intl.get("status_ongoing"), "Ongoing"),
      new Status(this.intl.get("status_completed"), "Completed"),
      new Status(this.intl.get("status_dropped"), "Dropped"),
      new Status(this.intl.get("status_upcoming"), "Upcoming"),
      new Status(this.intl.get("status_hiatus"), "Hiatus"),
      new Status(this.intl.get("status_cancelled"), "Cancelled"),
    ];
  }

  protected getTypeList(): Type[] {
    return [
      new Type(this.intl.get("all"), ""),
      new Type(this.intl.get("type_manga"), "Manga"),
      new Type(this.intl.get("type_manhua"), "Manhua"),
      new Type(this.intl.get("type_manhwa"), "Manhwa"),
      new Type(this.intl.get("type_novel"), "Novel"),
      new Type(this.intl.get("type_web_novel_jp"), "Web Novel (JP)"),
      new Type(this.intl.get("type_web_novel_kr"), "Web Novel (KR)"),
      new Type(this.intl.get("type_web_novel_cn"), "Web Novel (CN)"),
      new Type(this.intl.get("type_doujinshi"), "Doujinshi"),
    ];
  }

  protected getGenreList(): Genre[] {
    return [
      "Action", "Adventure", "Comedy", "Crime",
      "Drama", "Ecchi", "Fantasy", "Harem",
      "Historical", "Horror", "Isekai", "Josei",
      "Magic", "Martial Arts", "Medical", "Military",
      "Music", "Mystery", "One Shot", "Police",
      "Psychological", "Reincarnation", "Revenge", "Romance",
      "School Life", "Sci-Fi", "Seinen", "Shounen",
      "Slice of Life", "Sports", "Supernatural", "Survival",
      "Thriller", "Time Travel", "Tragedy", "Vampire",
    ].map((it) => new Genre(it, it));
  }

  protected getLanguageList(): Language[] {
    return [new Language(this.intl.get("all"), ""), new Language("Indonesian", "Indonesian"), new Language("English", "English")];
  }

  protected statusOnGoingList = ["ongoing", "en curso", "en emisión", "em lançamento", "activo", "ativo", "lançando", "مستمر", "مستمرة"];
  protected statusCompletedList = ["completed", "completo", "finalizado", "مكتمل", "مكتملة"];
  protected statusHiatusList = ["hiatus", "pausado"];
  protected statusCancelledList = ["cancelled", "dropped", "dropado", "abandonado", "cancelado"];

  // Utils
  private isValid(feedUrl: FeedUrl) {
    return feedUrl.old === this.useOldChapterFeed && feedUrl.new === this.useNewChapterFeed && feedUrl.category === this.chapterCategory;
  }

  protected parseDate(dateStr: string | null | undefined): number {
    const date = this.dateFormat.tryParseDate(dateStr);
    return date > 0 ? date : tryParseInstant(dateStr);
  }

  protected parseStatus(element: string): number {
    const s = element.toLowerCase().trim();
    if (this.statusOnGoingList.includes(s)) return SManga.ONGOING;
    if (this.statusCompletedList.includes(s)) return SManga.COMPLETED;
    if (this.statusHiatusList.includes(s)) return SManga.ON_HIATUS;
    if (this.statusCancelledList.includes(s)) return SManga.CANCELLED;
    return SManga.UNKNOWN;
  }
}

function replaceLast(s: string, oldValue: string, newValue: string): string {
  const lastIndexOf = s.lastIndexOf(oldValue);
  return lastIndexOf === -1 ? s : s.substring(0, lastIndexOf) + newValue + s.substring(lastIndexOf + oldValue.length);
}

const toIntOrNull = (s: string | undefined) => (s != null && /^[+-]?\d+$/.test(s) ? Number(s) : null);
