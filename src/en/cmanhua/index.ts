// Port of keiyoushi/extensions-source src/en/cmanhua/CManhua.kt
import {
  Filter,
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  POST,
  Page,
  SChapter,
  SManga,
  DateTimeFormatter,
  Locale,
  ZoneOffset,
  firstInstanceOrNull,
  parseHtml,
  str,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { CHAPTER_OPTIONS, ChapterCountFilter, GENDER_OPTIONS, GENRES, GenderFilter, GenreFilter, SORT_OPTIONS, STATUS_OPTIONS, SortFilter, StatusFilter } from "./filters.ts";

const SORT_UPDATE_TIME = "0";
const SORT_TOP_VIEWS = "2";

const CHAPTER_NUMBER_REGEX = /chapter\s*([0-9]+(?:\.[0-9]+)?)/i;
const CHAPTER_TOKEN_REGEX = /var\s+ts\s*=\s*"([^"]+)/;

/** String.toIntOrNull() */
const toIntOrNull = (s: string): number | null => (/^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

export default class CManhua extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Referer", `${this.baseUrl}/`);
    return headers;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);

  // ============================== Popular =====================================

  protected override popularMangaRequest(page: number): Request {
    return this.listRequest(page, SORT_TOP_VIEWS);
  }

  protected override popularMangaParse(response: Response): MangasPage {
    return this.parseMangaList(response);
  }

  // ============================== Latest ======================================

  protected override latestUpdatesRequest(page: number): Request {
    return this.listRequest(page, SORT_UPDATE_TIME);
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    return this.parseMangaList(response);
  }

  // ============================== Search ======================================

  protected override searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (query.trim()) return this.searchRequest(page, query.trim());

    const status = firstInstanceOrNull(filters, StatusFilter)?.toUriPart() ?? STATUS_OPTIONS[0][1];
    const sort = firstInstanceOrNull(filters, SortFilter)?.toUriPart() ?? SORT_OPTIONS[0][1];
    const minChapters = firstInstanceOrNull(filters, ChapterCountFilter)?.toUriPart() ?? CHAPTER_OPTIONS[0][1];
    const gender = firstInstanceOrNull(filters, GenderFilter)?.toUriPart() ?? GENDER_OPTIONS[0][1];
    const genres =
      firstInstanceOrNull(filters, GenreFilter)
        ?.state.filter((it) => it.state)
        .map((it) => it.id)
        .join(", ") ?? "";

    return this.listRequest(page, sort, status, minChapters, gender, genres);
  }

  protected override searchMangaParse(response: Response): MangasPage {
    return this.parseMangaList(response);
  }

  // ============================== Manga Details ===============================

  protected override mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    const title = document.selectFirst("h1.title-detail")?.text();
    if (title === undefined) throw new Error("Title not found");
    manga.title = title;
    manga.author = document
      .select("li.author p.col-xs-8 a")
      .map((it) => it.text())
      .join(", ");
    manga.status = this.toStatus(document.selectFirst("li.status p.col-xs-8")?.text() ?? "");
    manga.genre = document
      .select("li.kind p.col-xs-8 a")
      .map((it) => it.text())
      .join(", ");
    manga.description = document.selectFirst("#descript")?.text();
    manga.thumbnail_url = document.selectFirst("div.col-image img")?.absUrl("src");
    return manga;
  }

  // ============================== Chapters ====================================

  protected override chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    return document.select("#listchap li.row").map((element) => {
      const link = element.selectFirst("div.chapter a");
      if (!link) throw new Error("Chapter link not found");
      const name = link.text();
      const date = element.selectFirst("time[datetime]")?.attr("datetime") ?? "";

      const chapter = SChapter.create();
      chapter.name = name;
      chapter.url = urlWithoutDomain(link.absUrl("href"));
      chapter.date_upload = this.dateFormat.tryParseDateTime(date, ZoneOffset.UTC);
      chapter.chapter_number = this.parseChapterNumber(name);
      return chapter;
    });
  }

  // ============================== Pages =======================================

  protected override async pageListParse(response: Response | Document): Promise<Page[]> {
    const res = response as Response;
    const document = res.asJsoup();
    let encoded: string | undefined;
    for (const it of document.select("script")) {
      encoded = CHAPTER_TOKEN_REGEX.exec(it.data())?.[1];
      if (encoded !== undefined) break;
    }
    if (encoded === undefined) throw new Error("Unable to find chapter token");

    return this.fetchChapterPages(encoded, res.url);
  }

  protected override imageUrlParse(_response: Response): string {
    throw new Error("Not used");
  }

  override imageRequest(page: Page): Request {
    return GET(page.imageUrl!, this.headers);
  }

  // ============================== Filters =====================================

  override getFilterList(): FilterList {
    return FilterList(new Filter.Header("Filters are ignored when searching by name."), new SortFilter(), new StatusFilter(), new ChapterCountFilter(), new GenderFilter(), new GenreFilter(GENRES));
  }

  // ============================== Request Builders ============================

  private listRequest(page: number, sort: string, status = STATUS_OPTIONS[0][1], minChapters = CHAPTER_OPTIONS[0][1], gender = GENDER_OPTIONS[0][1], genres = ""): Request {
    const url = toHttpUrl(this.baseUrl)
      .newBuilder()
      .addPathSegments(`danhsach/P${page}/index.html`)
      .addQueryParameter("status", status)
      .addQueryParameter("sort", sort)
      .addQueryParameter("chapter", minChapters)
      .addQueryParameter("gender", gender);
    if (genres) url.addQueryParameter("spec", genres);

    return GET(url.build(), this.headers);
  }

  private searchRequest(page: number, query: string): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment(query);
    if (page > 1) url.addPathSegment(`P${page}`);
    url.addPathSegment("tim-kiem.html");

    return GET(url.build(), this.headers);
  }

  private chapterApiRequest(encoded: string, referer: string): Request {
    const headers = this.headersBuilder();
    headers.append("X-Requested-With", "XMLHttpRequest");
    headers.set("Referer", referer);
    return POST(`${this.baseUrl}/Service.asmx/getchapter`, headers, JSON.stringify({ enc: encoded }), "application/json");
  }

  // ============================== Utilities ===================================

  private parseMangaList(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangaList: SManga[] = [];
    for (const element of document.select("ul.lst_story li.item")) {
      const titleElement = element.selectFirst("h3 a") ?? element.selectFirst("a[itemprop=url]");

      const url = titleElement?.absUrl("href");
      if (!titleElement || !url) continue;

      const title = titleElement.text();
      const image = element.selectFirst("img");
      const thumbnail = image ? image.absUrl("data-src") || image.absUrl("src") : "";

      const manga = SManga.create();
      manga.title = title;
      if (thumbnail) manga.thumbnail_url = thumbnail;
      manga.url = urlWithoutDomain(url);
      mangaList.push(manga);
    }

    const page = this.pageFromUrl(response.url);
    const hasNextPage = this.hasNextPage(document, page);
    return new MangasPage(mangaList, hasNextPage);
  }

  private pageFromUrl(url: string): number {
    const pageSegment = toHttpUrl(url).pathSegments.find((it) => it.startsWith("P") && it.length > 1);
    return (pageSegment ? toIntOrNull(pageSegment.substring(1)) : null) ?? 1;
  }

  private hasNextPage(document: Document, page: number): boolean {
    const pages = document
      .select("li.list-pager a")
      .map((it) => toIntOrNull(it.text()))
      .filter((it): it is number => it !== null);
    if (pages.length === 0) return false;

    return page < Math.max(...pages);
  }

  private async fetchChapterPages(encoded: string, referer: string): Promise<Page[]> {
    const request = this.chapterApiRequest(encoded, referer);
    const response = await this.client.execute(request);
    const body = response.text();
    const data = this.extractChapterPayload(body);
    const code = toIntOrNull(data.trim());
    if (code !== null) throw new Error(this.errorMessage(code));

    return parseHtml(this.host.load, data, this.baseUrl)
      .select("img")
      .map((image, index) => new Page(index, "", image.absUrl("src")));
  }

  private extractChapterPayload(body: string): string {
    const trimmed = body.trim().replace(/^﻿/, "");
    if (trimmed.length === 0) throw new Error("Failed to load chapter pages.");
    if (trimmed.startsWith("<") || trimmed.toLowerCase().includes("<img")) return trimmed;

    let jsonElement: unknown;
    try {
      jsonElement = JSON.parse(trimmed);
    } catch {
      throw new Error(this.errorMessageFromBody(trimmed));
    }

    if (jsonElement === null || typeof jsonElement !== "object" || Array.isArray(jsonElement)) {
      const primitive = str(jsonElement);
      if (primitive === undefined) throw new Error(this.errorMessageFromBody(trimmed));
      return primitive;
    }

    const o = jsonElement as Record<string, unknown>;
    const data = str(o.d) ?? str(o.data) ?? str(o.html);
    if (data === undefined) throw new Error(this.errorMessageFromBody(trimmed));

    return data;
  }

  private errorMessageFromBody(body: string): string {
    const code = toIntOrNull(body.trim());
    if (code !== null) return this.errorMessage(code);

    let error: string | undefined;
    try {
      const o = JSON.parse(body) as unknown;
      if (o !== null && typeof o === "object" && !Array.isArray(o)) error = str((o as Record<string, unknown>).error);
    } catch {
      // not JSON
    }

    return error ?? "Failed to load chapter pages. Unknown error.";
  }

  // ============================== Helpers =====================================

  private toStatus(s: string): number {
    switch (s.toLowerCase()) {
      case "on going":
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private parseChapterNumber(name: string): number {
    const n = Number.parseFloat(CHAPTER_NUMBER_REGEX.exec(name)?.[1] ?? "");
    return Number.isNaN(n) ? -1 : n;
  }

  private errorMessage(code: number): string {
    switch (code) {
      case 3:
        return "You do not have enough coins to unlock this chapter.";
      case -1:
        return "Chapter does not exist.";
      case -2:
        return "Chapter token expired.";
      case -3:
        return "Invalid parameters.";
      case -4:
        return "Login required to access this chapter.";
      case -5:
        return "Account is banned or does not exist.";
      default:
        return `Failed to load chapter pages. Unknown error (code: ${code}).`;
    }
  }
}
