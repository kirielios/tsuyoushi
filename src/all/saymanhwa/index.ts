// Port of keiyoushi/extensions-source src/all/saymanhwa/SayManhwa.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList as FilterListType,
  type HttpUrl,
} from "../../../sdk/index.ts";

interface GenreOption {
  name: string;
  value: string | null;
}

class GenreFilter extends Filter.Select<string> {
  readonly vals: (string | null)[];
  constructor(title: string, genres: GenreOption[]) {
    super(title, ["All", ...genres.map((it) => it.name)]);
    this.vals = [null, ...genres.map((it) => it.value)];
  }
}

export default class SayManhwa extends KeiSource {
  private get saymanhwaLang(): string {
    switch (this.lang) {
      case "pt":
        return "pt-br";
      case "zh":
      case "zh-Hans":
        return "zh-cn";
      case "zh-Hant":
        return "zh-tw";
      default:
        return this.lang;
    }
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(3);
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const b = toHttpUrl(`${this.baseUrl}/${this.saymanhwaLang}/popular`)!.newBuilder();
    if (page !== 1) b.addQueryParameter("page", String(page));
    const document = (await this.client.get(b.build().toString())).asJsoup();
    return this.parseMangaPage(document, page);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const b = toHttpUrl(`${this.baseUrl}/${this.saymanhwaLang}/latest`)!.newBuilder();
    if (page !== 1) b.addQueryParameter("page", String(page));
    return this.parseMangaPage((await this.client.get(b.build().toString())).asJsoup(), page);
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);
    const selectedGenre = genreFilter?.vals[genreFilter.state];

    const b = toHttpUrl(`${this.baseUrl}/${this.saymanhwaLang}/series`)!.newBuilder();
    if (query.trim()) b.addQueryParameter("q", query.trim());
    if (selectedGenre) b.addQueryParameter("genre", selectedGenre);
    if (page !== 1) b.addQueryParameter("page", String(page));

    return this.parseMangaPage((await this.client.get(b.build().toString())).asJsoup(), page);
  }

  private parseMangaPage(document: Document, _page: number): MangasPage {
    const mangas = document.select("article.series-card").map((it) => this.mangaFromElement(it));

    const hasNextPage = document.select("nav.pagination span + a").length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const mangaLink = element.selectFirst(".series-card-body h2 a")!;
    manga.url = urlWithoutDomain(mangaLink.absUrl("href"));
    manga.title = mangaLink.text();
    manga.thumbnail_url = element.selectFirst(".series-card-cover img, a img")?.absUrl("src");
    return manga;
  }

  // ============================== Details ===============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document, this.getMangaUrl(manga)), this.chapterListParse(document));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const mangaUrl = this.mangaUrlFrom(toHttpUrl(url.toString())!);
    const document = (await this.client.get(mangaUrl.toString())).asJsoup();
    const manga = this.mangaDetailsParse(document, mangaUrl.toString());
    manga.initialized = true;
    return manga;
  }

  private mangaUrlFrom(url: HttpUrl): HttpUrl {
    const segments = url.pathSegments;
    if (segments.at(-1)?.startsWith("chapter-") === true) {
      return url.newBuilder().removePathSegment(segments.length - 1).build();
    }
    return url;
  }

  private mangaDetailsParse(document: Document, mangaUrl: string): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(substringBefore(mangaUrl, "/chapter-"));
    const h1 = document.selectFirst("h1");
    if (h1 == null) throw new Error("NullPointerException: h1 not found");
    manga.title = h1.ownText();
    manga.thumbnail_url = document.selectFirst(".series-v72-cover img")?.absUrl("src");

    const creatorRows = document.select(".series-v72-meta-row strong.series-creator-links");
    manga.author = creatorRows[0]?.select("a").map((it) => it.text()).join(", ");
    manga.artist = creatorRows[1]?.select("a").map((it) => it.text()).join(", ");

    manga.status = this.toStatus(document.selectFirst(".series-v72-meta-pair > div:first-child strong")?.ownText(), this.saymanhwaLang);

    const type = document.selectFirst(".series-v72-meta-pair > div:nth-child(2) strong")?.ownText();
    const genresContent = document.select("a[href*='/genres/']").map((it) => it.text());
    manga.genre = [...new Set([...(type != null ? [type] : []), ...genresContent])].join(", ");

    manga.description = document.selectFirst(".series-seo-context p")?.wholeText() ?? "";
    return manga;
  }

  private toStatus(text: string | undefined, langPath: string): number {
    if (!text) return SManga.UNKNOWN;

    let ongoingWords: string[];
    let completedWords: string[];
    switch (langPath) {
      case "ar":
        [ongoingWords, completedWords] = [["مستمر"], ["مكتمل"]];
        break;
      case "de":
        [ongoingWords, completedWords] = [["laufend"], ["abgeschlossen"]];
        break;
      case "es":
        [ongoingWords, completedWords] = [["en curso"], ["completado"]];
        break;
      case "fil":
        [ongoingWords, completedWords] = [["tuloy-tuloy", "tuloy tuloy"], ["tapos"]];
        break;
      case "fr":
        [ongoingWords, completedWords] = [["en cours"], ["terminé", "termine"]];
        break;
      case "id":
        [ongoingWords, completedWords] = [["berjalan"], ["selesai"]];
        break;
      case "ja":
        [ongoingWords, completedWords] = [["連載中"], ["完結"]];
        break;
      case "pt-br":
        [ongoingWords, completedWords] = [["em andamento"], ["concluído", "concluido"]];
        break;
      case "th":
        [ongoingWords, completedWords] = [["กำลังดำเนิน"], ["จบแล้ว"]];
        break;
      case "vi":
        [ongoingWords, completedWords] = [["đang tiến hành", "đang"], ["hoàn thành"]];
        break;
      case "zh-cn":
      case "zh-tw":
        [ongoingWords, completedWords] = [["连载中", "連載中"], ["已完结", "已完結", "完结", "完結"]];
        break;
      default:
        [ongoingWords, completedWords] = [["ongoing"], ["completed"]];
    }

    const lower = text.toLowerCase();
    if (ongoingWords.some((it) => lower.includes(it.toLowerCase()))) return SManga.ONGOING;
    if (completedWords.some((it) => lower.includes(it.toLowerCase()))) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  private chapterListParse(document: Document): SChapter[] {
    return document.select(".series-v72-chapter-list > a.series-v72-chapter-row").map((it) => this.chapterFromElement(it));
  }

  private chapterFromElement(element: Element): SChapter {
    const chapterName = element.selectFirst(".series-chapter-number-text")!.ownText();
    const isVip = element.selectFirst(".chapter-mini-lock") != null;
    const dateStr = element.selectFirst("time")?.attr("datetime");
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.absUrl("href"));
    chapter.name = isVip ? "🔒 " + chapterName : chapterName;
    chapter.date_upload = tryParseInstant(dateStr);
    return chapter;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".reader-pages img").map((element, index) => new Page(index, "", element.absUrl("src")));
  }

  // ============================== Related ==============================

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const mangas: SManga[] = [];
    for (const element of document.select(".recommend-card-v71")) {
      const link = element.selectFirst("h3 a");
      if (link == null) continue;
      const m = SManga.create();
      m.url = urlWithoutDomain(link.absUrl("href"));
      m.title = link.text();
      m.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      mangas.push(m);
    }
    return mangas;
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/${this.saymanhwaLang}/series`)).asJsoup();
    const genres: GenreOption[] = [];
    for (const option of document.select("select[name=genre] option")) {
      const value = option.attr("value");
      const text = option.text();
      if (value.length === 0 || text.length === 0) continue;
      genres.push({ name: text, value });
    }
    return genres;
  }

  override getFilterList(data: unknown = null): FilterListType {
    const genres = data as GenreOption[] | null;
    return !genres || genres.length === 0 ? FilterList() : FilterList(new GenreFilter("Genre", genres));
  }
}
