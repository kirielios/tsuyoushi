// Port of keiyoushi/extensions-source src/en/fairyscans/FairyScans.kt (and Dto.kt)
import {
  HttpSource, MangasPage, Page, SChapter, SManga, SwitchPreferenceCompat, firstInstanceOrNull, parseHtml, substringAfter, substringBeforeLast, urlWithoutDomain, FilterList,
  type PreferenceScreen, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET, POST } from "../../../sdk/httpsource.ts";
import { GENRE_VALUES, GenreFilter, SORT_VALUES, STATUS_VALUES, SortFilter, StatusFilter, TYPE_VALUES, TypeFilter } from "./filters.ts";

// Dto.kt
interface BrowseResponseDto {
  success: boolean;
  data?: BrowseDataDto | null;
  html?: string | null;
  has_more?: boolean | null;
}
interface BrowseDataDto {
  grid_html?: string | null;
  has_more?: boolean | null;
}
const hasMore = (d: BrowseResponseDto) => d.has_more ?? d.data?.has_more ?? false;
const gridHtml = (d: BrowseResponseDto) => d.data?.grid_html ?? d.html ?? "";
interface ReaderDto {
  sources: { images: string[] }[];
}
const images = (d: ReaderDto) => d.sources[0]?.images ?? [];

const PREF_HIDE_PREMIUM_CHAPTERS = "pref_hide_premium_chapters";
const chapterNumberRegex = /(?:chapter|ch)\s*(\d+(?:\.\d+)?)/i;
const NONCE_REGEX = /"nonce"\s*:\s*"([^"]+)"/;
const AUTHOR_REGEX = /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/;

const toFloatOrNull = (s: string | null | undefined): number | null => (s != null && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s.trim()) ? Number(s) : null);

/** MultipartBody.Builder().setType(FORM) with text parts only; returns the body and its Content-Type. */
function multipartForm(parts: [string, string][]): { body: string; contentType: string } {
  const boundary = `----FairyScans${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const body = `${parts.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join("")}--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export default class FairyScans extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    h.append("Origin", this.baseUrl);
    return h;
  }

  private filterNonce: string | null = null;
  private loadMoreNonce: string | null = null;

  private async getNonce(page: number): Promise<string> {
    if (this.filterNonce == null || this.loadMoreNonce == null) {
      const html = (await this.client.execute(GET(`${this.baseUrl}/manga/`, this.headers))).text();

      this.filterNonce = NONCE_REGEX.exec(substringAfter(html, "greedArchiveBrowse"))?.[1] ?? null;
      this.loadMoreNonce = NONCE_REGEX.exec(substringAfter(html, "greedArchiveMore"))?.[1] ?? null;
    }
    const nonce = page === 1 ? this.filterNonce : this.loadMoreNonce;
    if (nonce == null) throw new Error("Could not find required nonces for filtering");
    return nonce;
  }

  // ============================== Popular ==============================

  protected popularMangaRequest(page: number): Promise<Request> {
    const sortFilter = new SortFilter();
    sortFilter.state = { index: 1, ascending: false };
    return this.searchMangaRequest(page, "", FilterList(sortFilter));
  }

  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ============================== Latest ===============================

  protected latestUpdatesRequest(page: number): Promise<Request> {
    const sortFilter = new SortFilter();
    sortFilter.state = { index: 0, ascending: false };
    return this.searchMangaRequest(page, "", FilterList(sortFilter));
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ============================== Search ===============================

  protected async searchMangaRequest(page: number, query: string, filters: FilterList): Promise<Request> {
    const nonce = await this.getNonce(page);
    const action = page === 1 ? "greed_filter_series" : "greed_archive_load_more";

    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const statusFilter = firstInstanceOrNull(filters, StatusFilter);
    const typeFilter = firstInstanceOrNull(filters, TypeFilter);
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);

    const sort = sortFilter?.state != null ? SORT_VALUES[sortFilter.state.index] : "latest";
    const order = sortFilter?.state != null ? (sortFilter.state.ascending ? "asc" : "desc") : "desc";
    const status = statusFilter != null ? STATUS_VALUES[statusFilter.state] : "all";
    const type = typeFilter != null ? TYPE_VALUES[typeFilter.state] : "all";
    const genre = genreFilter != null ? GENRE_VALUES[genreFilter.state] : "";

    const { body, contentType } = multipartForm([
      ["action", action],
      ["nonce", nonce],
      ["page", String(page)],
      ["per_initial", "20"],
      ["per_more", "10"],
      ["filters[sort]", sort],
      ["filters[order]", order],
      ["filters[status]", status],
      ["filters[type]", type],
      ["filters[genre]", genre],
      ["filters[creator]", ""],
      ["filters[s]", query],
    ]);

    return POST(`${this.baseUrl}/wp-admin/admin-ajax.php`, this.headers, body, contentType);
  }

  protected searchMangaParse(response: Response): MangasPage {
    let dto: BrowseResponseDto;
    try {
      dto = response.parseAs<BrowseResponseDto>();
    } catch (e) {
      // Nullify nonces if response breaks, they could have expired.
      this.filterNonce = null;
      this.loadMoreNonce = null;
      throw e;
    }

    if (!dto.success) {
      this.filterNonce = null;
      this.loadMoreNonce = null;
      throw new Error("Failed to fetch search results from the source");
    }

    const document = parseHtml(this.host.load, gridHtml(dto), this.baseUrl);
    const mangas: SManga[] = [];
    for (const element of document.select("article")) {
      const isNovel = element.selectFirst(".greed-browse-card-format-badge--novel") != null || element.selectFirst(".greed-browse-card-format-badge")?.text().toLowerCase() === "novel";

      if (isNovel) continue;

      const manga = SManga.create();
      const a = element.selectFirst("h2 a, a.greed-browse-card-image, a.greed-archive-cover")!;
      manga.url = urlWithoutDomain(a.absUrl("href"));
      manga.title = element.selectFirst("h2")!.text();
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      mangas.push(manga);
    }
    return new MangasPage(mangas, hasMore(dto));
  }

  // ============================== Details ==============================

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst(".greed-series-title, h1")!.text();

    const jsonLd = document.selectFirst("script[type=application/ld+json]")?.data();
    if (jsonLd != null) manga.author = AUTHOR_REGEX.exec(jsonLd)?.[1];

    manga.description = document.selectFirst(".greed-series-description")?.text();
    manga.thumbnail_url = document.selectFirst(".greed-series-cover-img")?.absUrl("src");

    manga.genre = document
      .select(".greed-series-genre")
      .map((it) => it.text())
      .join(", ");

    const statusText = document.selectFirst(".fairy-series-clean__meta-item--status .fairy-series-clean__meta-v")?.text().toLowerCase();
    if (statusText == null) manga.status = SManga.UNKNOWN;
    else if (statusText.includes("ongoing")) manga.status = SManga.ONGOING;
    else if (statusText.includes("completed")) manga.status = SManga.COMPLETED;
    else if (statusText.includes("hiatus")) manga.status = SManga.ON_HIATUS;
    else if (statusText.includes("dropped")) manga.status = SManga.CANCELLED;
    else manga.status = SManga.UNKNOWN;
    return manga;
  }

  // ============================= Chapters ==============================

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const hidePremium = this.preferences.getBoolean(PREF_HIDE_PREMIUM_CHAPTERS, true);

    const list: [number, SChapter][] = [];
    for (const element of document.select(".greed-series-chapter")) {
      const isLocked = element.hasClass("is-locked");

      if (isLocked && hidePremium) continue;

      const rawName = element.selectFirst(".greed-series-chapter-title")!.text();

      // Site gives us an accurate sort index inside the data-chapter-order attribute
      const orderAttr = toFloatOrNull(element.attr("data-chapter-order"));
      const orderFallback = toFloatOrNull(chapterNumberRegex.exec(rawName)?.[1]) ?? -1;
      const finalOrder = orderAttr ?? orderFallback;

      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = isLocked ? `🔒 ${rawName}` : rawName;
      chapter.chapter_number = finalOrder;
      chapter.date_upload = this.parseRelativeDate(element.selectFirst(".greed-series-chapter-date")?.text());
      list.push([finalOrder, chapter]);
    }
    // Fixes site's out-of-order problem (stable, like sortedByDescending)
    return list.sort((a, b) => b[0] - a[0]).map((it) => it[1]);
  }

  // =============================== Pages ===============================

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const scriptData = document.selectFirst("script:containsData(ts_reader.run)")?.data();
    if (scriptData == null) throw new Error("Reader script not found");

    const jsonStr = substringBeforeLast(substringAfter(scriptData, "ts_reader.run("), ");");
    const dto = JSON.parse(jsonStr) as ReaderDto;

    return images(dto).map((url, i) => new Page(i, "", url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new StatusFilter(), new TypeFilter(), new GenreFilter());
  }

  // ============================= Utilities =============================

  private parseRelativeDate(dateStr: string | null | undefined): number {
    if (dateStr == null) return 0;
    const split = dateStr.split(" ");
    if (split.length < 2) return 0;
    if (!/^[+-]?\d+$/.test(split[0])) return 0;
    const count = Number(split[0]);
    const unit = split[1].toLowerCase();
    const cal = new Date();

    if (unit.includes("year")) cal.setFullYear(cal.getFullYear() - count);
    else if (unit.includes("month")) cal.setMonth(cal.getMonth() - count);
    else if (unit.includes("week")) cal.setDate(cal.getDate() - count * 7);
    else if (unit.includes("day")) cal.setDate(cal.getDate() - count);
    else if (unit.includes("hour")) cal.setHours(cal.getHours() - count);
    else if (unit.includes("minute") || unit.includes("min")) cal.setMinutes(cal.getMinutes() - count);
    else if (unit.includes("second") || unit.includes("sec")) cal.setSeconds(cal.getSeconds() - count);
    else return 0;
    return cal.getTime();
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_PREMIUM_CHAPTERS;
    p.title = "Hide premium chapters";
    p.summary = "Hide chapters that require coins/payment to read. If disabled, premium chapters will be marked with 🔒.";
    p.setDefaultValue(true);
    screen.addPreference(p);
  }
}
