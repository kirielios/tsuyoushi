// Port of keiyoushi/extensions-source src/id/holotoon/Holotoon.kt
import {
  Base64,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isBlank,
  isNotBlank,
  substringBefore,
  toHttpUrl,
  toHttpUrlOrNull,
  trimEnd,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

const AUTHOR_REGEX = /Author:\s*(.*?)\s+Artist:/i;
const ARTIST_REGEX = /Artist:\s*(.*?)\s+(?:Year:|Views:|Uploaded by:)/i;
const CHAPTER_NUMBER_REGEX = /\d+(?:\.\d+)?/;
const NUMBER_REGEX = /\d+/;
const STATUS_VALUES = new Set(["ongoing", "completed", "hiatus", "dropped"]);

/** kotlin.Pair's JSON shape, as upstream's toJsonElement() writes it */
type PairJson = { first: string; second: string };

export default class Holotoon extends KeiSource {
  getPopularManga(page: number): Promise<MangasPage> {
    return this.getBrowsePage(page, "popular");
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getBrowsePage(page, "latest");
  }

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sort = filters.find((it) => it instanceof SortFilter)?.value ?? "latest";
    const type = filters.find((it) => it instanceof TypeFilter)?.value ?? "";
    const status = filters.find((it) => it instanceof StatusFilter)?.value ?? "";
    const genre = filters.find((it) => it instanceof GenreFilter)?.value ?? "";

    return this.getBrowsePage(page, sort, query, type, status, genre);
  }

  private async getBrowsePage(page: number, sort: string, query = "", type = "", status = "", genre = ""): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    url.addPathSegment("browse");
    url.addQueryParameter("sort", sort);
    url.addQueryParameter("media", "comic");
    if (isNotBlank(query)) url.addQueryParameter("q", query);
    if (isNotBlank(type)) url.addQueryParameter("type", type);
    if (isNotBlank(status)) url.addQueryParameter("status", status);
    if (isNotBlank(genre)) url.addQueryParameter("genre", genre);
    if (page > 1) url.addQueryParameter("page", String(page));

    return this.parseMangasPage((await this.client.get(url.build().toString())).asJsoup(), page);
  }

  private parseMangasPage(document: Document, page: number): MangasPage {
    // The site contains scraper honeypots. Restrict parsing to the real catalogue grid.
    const container = document.select("div.grid:has(a[href^='/comic/'])").last();
    if (container == null) return new MangasPage([], false);
    const seen = new Set<string>();

    const mangas: SManga[] = [];
    for (const card of container.select("a.group[href^='/comic/']")) {
      const pathSegments = toHttpUrl(this.baseUrl).resolve(card.attr("href"))?.pathSegments ?? [];
      if (pathSegments[0] !== "comic" || isBlank(pathSegments[1])) continue;
      const path = "/" + pathSegments.filter(isNotBlank).join("/");
      const title = card.selectFirst("h3")?.text()?.trim() ?? "";
      if (isBlank(title) || seen.has(path)) continue;
      seen.add(path);

      const manga = SManga.create();
      manga.title = title;
      manga.url = urlWithoutDomain(path);
      manga.thumbnail_url = card.selectFirst("img")?.absUrl("src") || undefined;
      mangas.push(manga);
    }

    const hasNextPage = document.select("a[href*='page=']").some((it) => it.attr("href").includes(`page=${page + 1}`));

    return new MangasPage(mangas, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const path = this.normalizeMangaPath(manga.url);
    const document = (await this.client.get(`${this.baseUrl}${path}`)).asJsoup();

    return new SMangaUpdate(this.parseDetails(document, path), this.parseChapters(document));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${this.normalizeMangaPath(manga.url)}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${this.normalizeChapterPath(chapter.url)}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const path = this.normalizeMangaPath(url.pathname);
    if (!path.startsWith("/comic/")) return null;
    return this.parseDetails((await this.client.get(`${this.baseUrl}${path}`)).asJsoup(), path);
  }

  private parseDetails(document: Document, path: string): SManga {
    const titleElement = document.selectFirst("h1");
    const title = titleElement?.text()?.trim() ?? "";
    const detailsRoot = this.findDetailsRoot(titleElement);
    const metadata = detailsRoot?.text() ?? "";

    const descriptionElement = document.selectFirst("#synopsis-wrapper div[data-sr], div[data-sr][class*=synopsis], div.prose, div[class*=description]");
    let description: string | undefined;
    const encoded = descriptionElement?.attr("data-sr");
    if (isNotBlank(encoded)) {
      try {
        description = new TextDecoder().decode(Base64.decode(encoded));
      } catch {
        description = undefined;
      }
    }
    if (description == null) {
      const text = descriptionElement?.text()?.trim();
      description = isNotBlank(text) ? text : undefined;
    }

    const genreElements = detailsRoot?.select("a[href*='genre=']") ?? [];

    const manga = SManga.create();
    manga.url = urlWithoutDomain(path);
    manga.title = title;
    const author = AUTHOR_REGEX.exec(metadata)?.[1]?.trim();
    manga.author = isNotBlank(author) ? author : undefined;
    const artist = ARTIST_REGEX.exec(metadata)?.[1]?.trim();
    manga.artist = isNotBlank(artist) ? artist : undefined;
    manga.genre = [...new Set(genreElements.map((it) => it.text().trim()).filter(isNotBlank))].join(", ");
    manga.description = description;
    manga.status = this.parseStatus(detailsRoot ?? document);
    manga.thumbnail_url =
      document
        .select("img")
        .find((it) => it.attr("alt").trim().toLowerCase() === title.toLowerCase())
        ?.absUrl("src") || undefined;
    return manga;
  }

  private findDetailsRoot(titleElement: Element | null): Element | null {
    let element = titleElement?.parent() ?? null;
    for (let i = 0; i < 6; i++) {
      if (element == null) return null;
      if (element.select("a[href*='genre=']").length) return element;
      element = element.parent();
    }
    return titleElement?.parent() ?? null;
  }

  private parseStatus(root: Element): number {
    const value = root
      .select("span")
      .map((it) => it.text().trim().toLowerCase())
      .find((it) => STATUS_VALUES.has(it));

    switch (value) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      case "hiatus":
        return SManga.ON_HIATUS;
      case "dropped":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private parseChapters(document: Document): SChapter[] {
    const out: SChapter[] = [];
    for (const element of document.select("a[href^='/read/'][data-chapter]")) {
      const path = substringBefore(substringBefore(element.attr("href"), "#"), "?");
      if (isBlank(path)) continue;

      const rawChapter = element.attr("data-chapter");
      const numMatch = CHAPTER_NUMBER_REGEX.exec(rawChapter)?.[0];
      const number = numMatch != null ? Number(numMatch) : null;
      const label = element.selectFirst("span.font-semibold")?.text()?.trim();
      let subtitle: string | undefined = element.selectFirst("span.truncate")?.text()?.trim();
      if (subtitle != null) {
        subtitle = (subtitle.startsWith("—") ? subtitle.slice(1) : subtitle).trim();
        if (isBlank(subtitle)) subtitle = undefined;
      }

      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(path);
      if (isNotBlank(label) && subtitle != null) chapter.name = `${label} - ${subtitle}`;
      else if (isNotBlank(label)) chapter.name = label;
      else if (subtitle != null) chapter.name = subtitle;
      else if (number != null) chapter.name = `Chapter ${String(number)}`; // Float.toString().removeSuffix(".0")
      else chapter.name = isBlank(rawChapter) ? "Chapter" : rawChapter;
      chapter.chapter_number = number ?? -1;
      chapter.date_upload = this.parseRelativeDate(element.selectFirst("span.text-right, span[class*=tabular-nums]:last-child")?.text());
      out.push(chapter);
    }
    return out;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const readerImages = document.select("#reader-pages img");
    const images = readerImages.length ? readerImages : document.select("main img[src*='/image/comic/'], main img[data-src*='/image/comic/']");
    const seen = new Set<string>();

    const pages: Page[] = [];
    for (const image of images) {
      const imageUrl = image.absUrl("src") || image.absUrl("data-src");
      if (isBlank(imageUrl) || imageUrl.includes("/chapter-header/") || imageUrl.includes("/chapter-footer/") || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      pages.push(new Page(seen.size - 1, "", imageUrl));
    }
    return pages;
  }

  private normalizeMangaPath(url: string): string {
    const path = toHttpUrlOrNull(url)?.encodedPath ?? substringBefore(substringBefore(url, "?"), "#");
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
    return trimEnd(withLeadingSlash.startsWith("/komik/") ? withLeadingSlash.replace("/komik/", "/comic/") : withLeadingSlash, "/");
  }

  private normalizeChapterPath(url: string): string {
    const path = toHttpUrlOrNull(url)?.encodedPath ?? substringBefore(substringBefore(url, "?"), "#");
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
    if (!withLeadingSlash.startsWith("/komik/")) return trimEnd(withLeadingSlash, "/");

    const parts = withLeadingSlash.replace(/^\/+|\/+$/g, "").split("/");
    return parts.length >= 3 ? trimEnd(`/read/${parts[1]}/${parts.slice(2).join("/")}`, "/") : trimEnd(withLeadingSlash, "/");
  }

  private parseRelativeDate(text: string | null | undefined): number {
    if (isBlank(text)) return 0;
    const normalized = text.trim().toLowerCase();
    if (normalized === "baru saja" || normalized === "just now") return Date.now();

    const amountStr = NUMBER_REGEX.exec(normalized)?.[0];
    if (amountStr == null) return 0;
    const amount = Number(amountStr);
    if (!Number.isSafeInteger(amount) || amount > 2147483647) return 0; // toIntOrNull
    // Calendar.getInstance(): local time
    const calendar = new Date();
    const has = (...w: string[]) => w.some((it) => normalized.includes(it));

    if (has("detik", "second")) calendar.setSeconds(calendar.getSeconds() - amount);
    else if (has("menit", "minute")) calendar.setMinutes(calendar.getMinutes() - amount);
    else if (has("jam", "hour")) calendar.setHours(calendar.getHours() - amount);
    else if (has("hari", "day")) calendar.setDate(calendar.getDate() - amount);
    else if (has("minggu", "week")) calendar.setDate(calendar.getDate() - amount * 7);
    else if (has("bulan", "month")) calendar.setMonth(calendar.getMonth() - amount);
    else if (has("tahun", "year")) calendar.setFullYear(calendar.getFullYear() - amount);
    else return 0;

    return calendar.getTime();
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/browse`)).asJsoup();
    const out: PairJson[] = [];
    for (const option of document.select("select[name=genre] option")) {
      const value = option.attr("value").trim();
      const name = option.text().trim();
      if (isBlank(value) || isBlank(name)) continue;
      out.push({ first: name, second: value });
    }
    return out;
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = ((data as PairJson[] | null) ?? []).map((it): [string, string] => [it.first, it.second]);

    const list: FilterList = [new SortFilter(), new TypeFilter(), new StatusFilter()];
    if (genres.length) list.push(new GenreFilter(genres));
    return list;
  }
}
