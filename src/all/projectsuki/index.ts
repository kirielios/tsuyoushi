// Port of keiyoushi/extensions-source src/all/projectsuki/ProjectSuki.kt
// (top-level declarations live in pathpattern.ts). SManga.update_strategy has no counterpart in the SDK and is dropped.
import { KeiSource, MangasPage, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, toHttpUrl, type ClientBuilder, type Document, type FilterList, type Page, type PreferenceScreen } from "../../../sdk/index.ts";
import { addRandomUAPreference, setRandomUserAgent } from "../../../libs/randomua/index.ts";
import { ProjectSukiAPI, bookIDToURL, simpleSearchMangasPage } from "./api.ts";
import { BookDetail, DataExtractor, compareChapterNumbers, type BookChapter } from "./dataextractor.ts";
import { Artist, Author, Origin, ProjectSukiFilters, ProjectSukiPreferences, SearchMode, SearchModeFilter, Status, type ProjectSukiFilter } from "./filters.ts";
import { SmartBookSearchHandler } from "./smartsearch.ts";
import { UNKNOWN_LANGUAGE, bookUrlPattern, chapterUrlPattern, homepageUrl, matchAgainst, rawRelative, reportErrorToUser, type BookID } from "./pathpattern.ts";

const DESCRIPTION_DIVIDER = "/=/-/=/-/=/-/=/-/=/-/=/-/=/-/=/";

export default class ProjectSuki extends KeiSource {
  private _psPrefs?: ProjectSukiPreferences;
  private get psPreferences() {
    return (this._psPrefs ??= new ProjectSukiPreferences(this.preferences));
  }

  setupPreferenceScreen(screen: PreferenceScreen): void {
    addRandomUAPreference(screen);
    this.psPreferences.configure(screen);
  }

  protected configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2, 1000);
  }

  protected configureHeaders(headers: Headers): Headers {
    return setRandomUserAgent(headers, this.preferences, this.client);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = homepageUrl
      .newBuilder()
      .addPathSegment("browse")
      .addPathSegment(String(page - 1))
      .build();
    return this.searchMangaParse((await this.client.get(url.toString())).asJsoup());
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return this.searchMangaParse((await this.client.get(homepageUrl.toString())).asJsoup(), false);
  }

  private applyPSFilter<T extends ProjectSukiFilter>(builder: ReturnType<typeof homepageUrl.newBuilder>, from: FilterList, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cls: abstract new (...args: any[]) => T) {
    firstInstanceOrNull(from, cls)?.applyFilter(builder);
    return builder;
  }

  protected async getMangasByUrl(jurl: URL, _page: number): Promise<MangasPage> {
    const url = toHttpUrl(jurl.href);
    if (url.host !== homepageUrl.host) return new MangasPage([], false);

    const bookUrlMatch = matchAgainst(url, bookUrlPattern);
    const readUrlMatch = matchAgainst(url, chapterUrlPattern);

    let bookid: BookID | null = null;
    if (bookUrlMatch.doesMatch) bookid = bookUrlMatch.group(1);
    else if (readUrlMatch.doesMatch) bookid = readUrlMatch.group(1);

    if (bookid != null) {
      const rawSManga = SManga.create();
      rawSManga.url = rawRelative(bookIDToURL(bookid)) ?? reportErrorToUser(null, () => `Could not create relative url for bookID: ${bookid}`);
      const manga = (await this.fetchMangaUpdate(rawSManga, [], true, false)).manga;
      return new MangasPage([manga], false);
    }

    if (url.pathSegments[0] === "search") {
      const urlQuery = url.encodedQuery;
      if (!urlQuery?.trim()) throw new Error("Empty search query!");

      const searchUrl = `${homepageUrl.newBuilder().addPathSegment("search").build()}?${urlQuery}`;
      return this.searchMangaParse((await this.client.get(searchUrl)).asJsoup(), false);
    }

    return new MangasPage([], false);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const state = firstInstanceOrNull(filters, SearchModeFilter)?.state;
    const searchMode = state != null ? SearchMode.entries[state] : SearchMode.SMART;

    switch (searchMode) {
      case SearchMode.SMART:
        return new SmartBookSearchHandler(query, await ProjectSukiAPI.fetchBookSearch(this.client, this.headers)).mangasPage;
      case SearchMode.SIMPLE:
        return simpleSearchMangasPage(await ProjectSukiAPI.fetchBookSearch(this.client, this.headers), query);
      default: {
        let builder = homepageUrl
          .newBuilder()
          .addPathSegment("search")
          .addQueryParameter("page", String(page - 1))
          .addQueryParameter("q", query);
        builder = this.applyPSFilter(builder, filters, Origin);
        builder = this.applyPSFilter(builder, filters, Status);
        builder = this.applyPSFilter(builder, filters, Author);
        builder = this.applyPSFilter(builder, filters, Artist);
        return this.searchMangaParse((await this.client.get(builder.build().toString())).asJsoup());
      }
    }
  }

  getFilterList(_data: unknown = null): FilterList {
    return [...ProjectSukiFilters.headersSequence(this.psPreferences), ...ProjectSukiFilters.filtersSequence(this.psPreferences), ...ProjectSukiFilters.footersSequence(this.psPreferences)];
  }

  private searchMangaParse(document: Document, overrideHasNextPage: boolean | null = null): MangasPage {
    const extractor = new DataExtractor(document);
    const mangas = extractor.books.map((book) => {
      const manga = SManga.create();
      manga.url = rawRelative(book.bookUrl) ?? reportErrorToUser(null, () => `Could not relativize ${book.bookUrl}`);
      manga.title = book.rawTitle;
      manga.thumbnail_url = book.thumbnail.toString();
      return manga;
    });
    return new MangasPage(mangas, overrideHasNextPage ?? mangas.length >= 30);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const extractor = new DataExtractor(document);
    return new SMangaUpdate(this.mangaDetailsParse(manga, extractor), this.chapterListParse(extractor));
  }

  private mangaDetailsParse(manga: SManga, extractor: DataExtractor): SManga {
    const data = extractor.bookDetails;

    manga.title = data.book.rawTitle;
    manga.thumbnail_url = data.book.thumbnail.toString();
    manga.author = data.details.get(BookDetail.Author)?.detailData;
    manga.artist = data.details.get(BookDetail.Artist)?.detailData;
    switch (data.details.get(BookDetail.Status)?.detailData?.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      case "cancelled":
        manga.status = SManga.CANCELLED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }

    let d = "";
    const appendLine = (s = "") => (d += `${s}\n`);
    if (data.alertData.length) {
      appendLine("Alerts have been found, refreshing the book/manga later might help in removing them.");
      appendLine();
      for (const it of data.alertData) {
        appendLine(it);
        appendLine();
      }
      appendLine(DESCRIPTION_DIVIDER);
      appendLine();
      appendLine();
    }
    appendLine(data.description);
    appendLine();
    appendLine(DESCRIPTION_DIVIDER);
    appendLine();
    for (const { label, detailData } of data.details.values()) d += `${label}  ${detailData.trim()}\n`;
    manga.description = d;

    manga.genre = data.details.get(BookDetail.Genre)!.detailData;
    return manga;
  }

  getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  private chapterListParse(extractor: DataExtractor): SChapter[] {
    const blLangs = this.psPreferences.blacklistedLanguages();
    const wlLangs = this.psPreferences.whitelistedLanguages();

    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return [...extractor.bookChapters.values()]
      .flat()
      .filter((it) => !blLangs.has(it.chapterLanguage))
      .filter((it) => wlLangs.size === 0 || it.chapterLanguage === UNKNOWN_LANGUAGE || wlLangs.has(it.chapterLanguage))
      .sort((a: BookChapter, b: BookChapter) => {
        // compareByDescending: nulls sort last
        const an = a.chapterNumber;
        const bn = b.chapterNumber;
        const byNumber = an && bn ? compareChapterNumbers(bn, an) : an ? -1 : bn ? 1 : 0;
        return byNumber || cmp(a.chapterGroup, b.chapterGroup) || cmp(a.chapterLanguage, b.chapterLanguage);
      })
      .map((bookChapter) => {
        const chapter = SChapter.create();
        chapter.url = rawRelative(bookChapter.chapterUrl) ?? reportErrorToUser(null, () => `Could not relativize ${bookChapter.chapterUrl}`);
        chapter.name = bookChapter.chapterTitle;
        chapter.date_upload = bookChapter.chapterDateAdded;
        chapter.scanlator = `${bookChapter.chapterGroup} | ${bookChapter.chapterLanguage.charAt(0).toUpperCase()}${bookChapter.chapterLanguage.slice(1)}`;
        const { main, sub } = bookChapter.chapterNumber!;
        if (sub === 0) chapter.chapter_number = main;
        else {
          const digits = 1 + Math.floor(Math.log10(sub));
          chapter.chapter_number = main + sub / 10 ** digits;
        }
        return chapter;
      });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pathMatch = matchAgainst(toHttpUrl(this.baseUrl + chapter.url), chapterUrlPattern);
    if (!pathMatch.doesMatch) reportErrorToUser(null, () => `chapter url ${chapter.url} does not match expected pattern`);

    return ProjectSukiAPI.fetchChapterPages(this.client, this.host, this.headers, pathMatch.group(1)!, pathMatch.group(2)!);
  }
}
