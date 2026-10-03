// Port of keiyoushi/extensions-source src/id/ryukomik/Ryukomik.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  isBlank,
  isNotBlank,
  parseAs,
  substringAfterLast,
  toHttpUrl,
  trimEnd,
  trimStart,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
} from "../../../sdk/index.ts";
import { GENRE_OPTIONS, GenreFilter, LETTER_OPTIONS, LetterFilter, ORDER_OPTIONS, OrderByFilter, STATUS_OPTIONS, StatusFilter, TYPE_OPTIONS, TypeFilter } from "./filters.ts";

// Dto.kt
interface ListResponseDto {
  data?: ItemDto[];
  meta?: MetaDto | null;
}

interface ItemDto {
  title?: string | null;
  slug?: string | null;
  detail_link?: string | null;
  link?: string | null;
  image?: string | null;
  cover_url?: string | null;
  source?: string | null;
  type?: string | null;
  status?: string | null;
}

interface MetaDto {
  currentPage?: number;
  totalPages?: number;
}

const lastSegment = (s: string | null | undefined) => (s == null ? null : substringAfterLast(trimEnd(s, "/"), "/") || null);

function toSManga(item: ItemDto, defaultSource: string): SManga | null {
  const s = (isNotBlank(item.slug) ? item.slug : null) ?? lastSegment(item.detail_link) ?? lastSegment(item.link);
  if (s == null) return null;
  const mangaSource = isNotBlank(item.source) ? item.source : defaultSource;
  const mangaTitle = isNotBlank(item.title) ? item.title : null;
  if (mangaTitle == null) return null;
  const thumb = item.image ?? item.cover_url;

  const manga = SManga.create();
  manga.title = mangaTitle;
  manga.thumbnail_url = thumb ?? undefined;
  manga.url = `/komik/${mangaSource}/${s}`;
  return manga;
}

const hasNext = (meta: MetaDto | null | undefined) => (meta ? (meta.currentPage ?? 1) < (meta.totalPages ?? 1) : false);

const IMAGES_REGEX = /\\?"images\\?"\s*:\s*(\[[^\]]+\])/;
const DATE_FORMATTER = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ROOT);

export default class Ryukomik extends KeiSource {
  private readonly apiUrl = "https://api.ryukomik.web.id";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/komiku/list`).newBuilder().addQueryParameter("page", String(page)).build();

    const response = (await this.client.get(url.toString())).parseAs<ListResponseDto>();
    const mangas = (response.data ?? []).map((it) => toSManga(it, "komiku")).filter((it) => it != null);
    return new MangasPage(mangas, hasNext(response.meta));
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    return new MangasPage(this.parseCoverCards(document), false);
  }

  private parseCoverCards(document: Document): SManga[] {
    const seen = new Set<string>();
    const out: SManga[] = [];
    for (const card of document.select("a.rk-cover-card[href^='/komik/']")) {
      const href = card.attr("abs:href");
      if (isBlank(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);

      const img = card.selectFirst("img");
      const alt = img?.attr("alt");
      const p = card.selectFirst("p")?.text();
      const title = isNotBlank(alt) ? alt : isNotBlank(p) ? p : null;
      if (title == null) continue;

      const manga = SManga.create();
      manga.title = title;
      manga.thumbnail_url = img?.attr("abs:src");
      manga.url = urlWithoutDomain(href);
      out.push(manga);
    }
    return out;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const pick = <T extends Filter.Select<string>>(cls: new (v: string[]) => T, options: [string, string][]) => {
      const f = filters.find((it): it is T => it instanceof cls);
      return f ? options[f.state][1] : "";
    };
    const typeValue = pick(TypeFilter, TYPE_OPTIONS);
    const orderValue = pick(OrderByFilter, ORDER_OPTIONS);
    const letterValue = pick(LetterFilter, LETTER_OPTIONS);
    const statusValue = pick(StatusFilter, STATUS_OPTIONS);
    const genreValue = pick(GenreFilter, GENRE_OPTIONS);

    if (isNotBlank(query)) {
      const sourcesToSearch = ["project", "komiku", "kiryuu", "komikid", "josei"];
      const results = distinctBy((await Promise.all(sourcesToSearch.map((src) => this.searchSource(src, query)))).flat(), (it) => it.url);
      return new MangasPage(results, false);
    }

    if (isNotBlank(genreValue)) {
      if (page > 1) return new MangasPage([], false);
      const document = (await this.client.get(toHttpUrl(`${this.baseUrl}/genre/${genreValue}`).toString())).asJsoup();
      return new MangasPage(this.parseCoverCards(document), false);
    }

    const urlBuilder = toHttpUrl(`${this.apiUrl}/komiku/list`).newBuilder().addQueryParameter("page", String(page));

    if (isNotBlank(typeValue)) urlBuilder.addQueryParameter("tipe", typeValue);
    if (isNotBlank(orderValue)) urlBuilder.addQueryParameter("orderby", orderValue);
    if (isNotBlank(letterValue)) urlBuilder.addQueryParameter("huruf", letterValue);
    if (isNotBlank(statusValue)) urlBuilder.addQueryParameter("status", statusValue);

    const response = (await this.client.get(urlBuilder.build().toString())).parseAs<ListResponseDto>();
    const mangas = (response.data ?? []).map((it) => toSManga(it, "komiku")).filter((it) => it != null);
    return new MangasPage(mangas, hasNext(response.meta));
  }

  private async searchSource(source: string, query: string): Promise<SManga[]> {
    const url = (source === "project" ? toHttpUrl(`${this.baseUrl}/api/project/search`) : toHttpUrl(`${this.apiUrl}/${source}/search`)).newBuilder().addQueryParameter("q", query).build();

    const response = (await this.client.get(url.toString())).parseAs<ListResponseDto>();
    return (response.data ?? []).map((it) => toSManga(it, source)).filter((it) => it != null);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    try {
      if (url.host !== new URL(this.baseUrl).host) return null;
      const pathSegments = url.pathname.slice(1).split("/");
      if (pathSegments.length < 3 || pathSegments[0] !== "komik") return null;
      return this.mangaDetailsParse((await this.client.get(url)).asJsoup());
    } catch {
      return null;
    }
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(doc), this.chapterListParse(doc));
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    manga.title = document.selectFirst("h1")!.text().trim();
    manga.thumbnail_url = document.selectFirst("div.rk-shell img[alt=Poster], div.rk-shell div.flex-shrink-0 img")?.attr("abs:src");
    const author = document.selectFirst("div.rk-shell span.text-white\\/60.truncate")?.text()?.trim();
    manga.author = author === "-" ? undefined : author;

    const genres: string[] = [];
    const chip = document.selectFirst("span.rk-chip")?.text()?.trim();
    if (isNotBlank(chip)) genres.push(chip);
    document.select("a[href*='/genre/']").forEach((it) => {
      const g = it.text().trim();
      if (isNotBlank(g) && !genres.includes(g)) genres.push(g);
    });
    manga.genre = genres.join(", ");

    manga.description = document.selectFirst("p.text-sm.leading-relaxed.text-white\\/70")?.text()?.trim();

    const statusText = document.selectFirst("div.rk-shell div.flex.gap-3 span:last-child")?.text();
    manga.status = this.parseStatus(statusText);
    manga.initialized = true;
    return manga;
  }

  private chapterListParse(document: Document): SChapter[] {
    return document.select("a[href*='/chapter/']").map((el) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(el.attr("abs:href"));
      chapter.name = el.selectFirst("span.text-\\[13px\\], span.font-medium")?.text()?.trim() ?? el.selectFirst("div > div > span")?.text()?.trim() ?? el.text().trim();
      const dateStr = el.selectFirst("span.text-\\[11px\\] > span:first-child")?.text();
      if (isNotBlank(dateStr)) chapter.date_upload = this.parseDate(dateStr);
      return chapter;
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const html = (await this.client.get(chapterUrl)).text();

    const imagesMatch = IMAGES_REGEX.exec(html)?.[1];
    if (imagesMatch == null) return [];

    const imagesJson = imagesMatch.replaceAll('\\"', '"').replaceAll("\\\\", "\\");

    const images = parseAs<string[]>(imagesJson);

    return images.map((imgUrl, index) => {
      const fullUrl = imgUrl.startsWith("http://") || imgUrl.startsWith("https://") ? imgUrl : `${trimEnd(this.baseUrl, "/")}/${trimStart(imgUrl, "/")}`;
      return new Page(index, "", fullUrl);
    });
  }

  private parseDate(dateStr: string): number {
    const cleanDate = dateStr.trim().toLowerCase();
    const num = (unit: string) => {
      const n = cleanDate.split(unit)[0].trim();
      return /^[+-]?\d+$/.test(n) ? Number(n) : 1; // toIntOrNull() ?: 1
    };
    // Calendar.getInstance(): local time
    const calendar = new Date();
    if (cleanDate.includes("detik")) calendar.setSeconds(calendar.getSeconds() - num("detik"));
    else if (cleanDate.includes("menit")) calendar.setMinutes(calendar.getMinutes() - num("menit"));
    else if (cleanDate.includes("jam")) calendar.setHours(calendar.getHours() - num("jam"));
    else if (cleanDate.includes("hari")) calendar.setDate(calendar.getDate() - num("hari"));
    else if (cleanDate.includes("minggu")) calendar.setDate(calendar.getDate() - num("minggu") * 7);
    else if (cleanDate.includes("bulan")) calendar.setMonth(calendar.getMonth() - num("bulan"));
    else if (cleanDate.includes("tahun")) calendar.setFullYear(calendar.getFullYear() - num("tahun"));
    else if (cleanDate.includes("/")) return DATE_FORMATTER.tryParseDate(cleanDate);
    else return 0;
    return calendar.getTime();
  }

  private parseStatus(statusStr: string | undefined): number {
    switch (statusStr?.trim()?.toLowerCase()) {
      case "ongoing":
      case "berjalan":
        return SManga.ONGOING;
      case "completed":
      case "tamat":
      case "complete":
        return SManga.COMPLETED;
      case "hiatus":
        return SManga.ON_HIATUS;
      case "dropped":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new TypeFilter(TYPE_OPTIONS.map((it) => it[0])),
      new StatusFilter(STATUS_OPTIONS.map((it) => it[0])),
      new OrderByFilter(ORDER_OPTIONS.map((it) => it[0])),
      new LetterFilter(LETTER_OPTIONS.map((it) => it[0])),
      new Filter.Separator(),
      new GenreFilter(GENRE_OPTIONS.map((it) => it[0])),
    );
  }
}
