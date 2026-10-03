// Port of keiyoushi/extensions-source src/id/narasininja/NarasiNinja.kt
import { DateTimeFormatter, Filter, FilterList, HttpException, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneId, distinctBy, isBlank, substringAfterLast, urlWithoutDomain, type Document } from "../../../sdk/index.ts";
import { GenreFilter, OrderFilter, StatusFilter, TypeFilter } from "./filters.ts";

// Dto.kt
interface FilterResponse {
  data: MangaDto[];
  meta: MetaDto;
}
interface MangaDto {
  title: string;
  slug: string;
  detail?: DetailDto | null;
}
interface DetailDto {
  description?: string | null;
  status?: string | null;
  author?: string | null;
  artist?: string | null;
}
interface MetaDto {
  current_page: number;
  last_page: number;
}

const STATUS_ONGOING = /ongoing/i;
const STATUS_COMPLETED = /completed|finished|tamat/i;
const STATUS_HIATUS = /hiatus|on.hold/i;
const STATUS_CANCELLED = /cancelled|canceled|dropped/i;

function toStatus(s: string | null | undefined): number {
  if (s == null) return SManga.UNKNOWN;
  if (STATUS_ONGOING.test(s)) return SManga.ONGOING;
  if (STATUS_COMPLETED.test(s)) return SManga.COMPLETED;
  if (STATUS_HIATUS.test(s)) return SManga.ON_HIATUS;
  if (STATUS_CANCELLED.test(s)) return SManga.CANCELLED;
  return SManga.UNKNOWN;
}

const takeUnlessBlankOrDash = (a: string | null | undefined) => (isBlank(a) || a === "-" ? undefined : a);

function mangaDtoToSManga(dto: MangaDto, baseUrl: string): SManga {
  const m = SManga.create();
  m.title = dto.title;
  m.url = `/komik/${dto.slug}`;
  m.thumbnail_url = `${baseUrl}/storage/comic/image-bg/${dto.slug}.jpg`;
  const it = dto.detail;
  if (it) {
    m.description = it.description ?? undefined;
    m.status = toStatus(it.status);
    m.author = takeUnlessBlankOrDash(it.author);
    m.artist = takeUnlessBlankOrDash(it.artist);
  }
  return m;
}

export default class NarasiNinja extends KeiSource {
  // ======================== CSRF & Headers =================
  private csrfToken: string | null = null;

  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken != null) return this.csrfToken;

    const token = (await this.client.get(`${this.baseUrl}/komik`)).asJsoup().selectFirst("meta[name=csrf-token]")?.attr("content");
    if (token == null) throw new Error("CSRF token tidak ditemukan");

    this.csrfToken = token;
    return token;
  }

  private async filterHeaders(): Promise<Headers> {
    const h = this.headersBuilder();
    h.append("X-CSRF-TOKEN", await this.getCsrfToken());
    h.append("X-Requested-With", "XMLHttpRequest");
    h.set("Referer", `${this.baseUrl}/komik`);
    return h;
  }

  private async postFilter(page: number, body: URLSearchParams): Promise<FilterResponse> {
    const url = `${this.baseUrl}/komik/filter?page=${page}`;
    let response = await this.client.post(url, await this.filterHeaders(), body, { ensureSuccess: false });
    if (response.code === 419) {
      this.csrfToken = null;
      response = await this.client.post(url, await this.filterHeaders(), body, { ensureSuccess: false });
    }
    if (!response.isSuccessful) throw new HttpException(response.code, url);
    return response.parseAs<FilterResponse>();
  }

  override get supportsLatest(): boolean {
    return false;
  }

  // ======================== Popular ========================
  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new OrderFilter()));
  }

  // ======================== Latest =========================
  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("Unsupported operation");
  }

  // ======================== Search =========================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let status = "";
    let type = "";
    let order = "";
    const genres: string[] = [];

    for (const filter of filters) {
      if (filter instanceof StatusFilter) status = filter.selectedValue();
      else if (filter instanceof TypeFilter) type = filter.selectedValue();
      else if (filter instanceof OrderFilter) order = filter.selectedValue();
      else if (filter instanceof GenreFilter) filter.state.filter((it) => it.state).forEach((it) => genres.push(it.value));
    }

    const body = new URLSearchParams();
    body.append("search", query);
    body.append("status", status);
    body.append("type", type);
    body.append("order", order);
    genres.forEach((it) => body.append("genre[]", it));

    const result = await this.postFilter(page, body);
    const mangas = result.data.map((it) => mangaDtoToSManga(it, this.baseUrl));
    const hasNextPage = result.meta.current_page < result.meta.last_page;

    return new MangasPage(mangas, hasNextPage);
  }

  // ======================== Details & Chapters =============
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.mangaDetailsParse(document);
    details.url = manga.url;
    const chapterList = this.chapterListParse(document);

    return new SMangaUpdate(details, chapterList);
  }

  private mangaDetailsParse(document: Document): SManga {
    const m = SManga.create();
    const title = document.selectFirst("h1.entry-title")?.text();
    if (title == null) throw new Error("Judul komik tidak ditemukan");
    m.title = title;
    m.thumbnail_url = document.selectFirst(".thumb img")?.attr("abs:src");
    m.description = document.selectFirst(".entry-content.entry-content-single p")?.text();
    m.status = toStatus(document.selectFirst(".infotable tr:contains(Status) td:last-child")?.text());
    m.genre = document
      .select(".seriestugenre a")
      .map((it) => it.text())
      .join(", ");
    m.author = takeUnlessBlankOrDash(document.selectFirst(".infotable tr:contains(Author) td:last-child")?.text());
    m.artist = takeUnlessBlankOrDash(document.selectFirst(".infotable tr:contains(Artist) td:last-child")?.text());
    m.initialized = true;
    return m;
  }

  private readonly chapterNumberRegex = /(\d+)(?:[._-](\d+))?/;

  private parseChapterNumber(raw: string): number {
    const match = this.chapterNumberRegex.exec(raw.trim());
    if (!match) return -1;
    const major = parseInt(match[1], 10);
    const minor = match[2] != null ? parseInt(match[2], 10) : null;
    return minor != null ? parseFloat(`${major}.${minor}`) : major;
  }

  private chapterListParse(document: Document): SChapter[] {
    const list: SChapter[] = [];
    for (const li of document.select("#chapterlist li, .eplister li")) {
      const link = li.selectFirst("a");
      if (!link) continue;
      const nameText = li.selectFirst(".chapternum")?.text() || link.text() || null;
      if (nameText == null) continue;

      const c = SChapter.create();
      c.url = urlWithoutDomain(link.attr("abs:href"));
      c.name = nameText;
      const date = li.selectFirst(".chapterdate")?.text();
      c.date_upload = date != null ? this.dateFormat.tryParseDate(date, this.zoneJakarta) : 0;
      c.chapter_number = this.parseChapterNumber(li.attr("data-num") || substringAfterLast(c.name, " "));
      list.push(c);
    }
    return distinctBy(list, (it) => it.url).sort((a, b) => b.chapter_number - a.chapter_number);
  }

  // ======================== Pages ==========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const urls = document
      .select("#readerarea img.ts-main-image, #readerarea img")
      .map((img) => img.attr("abs:src") || img.attr("abs:data-src") || null)
      .filter((it): it is string => it != null);
    return [...new Set(urls)].map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // ======================== Deep Link =======================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const baseHost = new URL(this.baseUrl).hostname.replace(/^www\./, "");
    if (url.hostname.replace(/^www\./, "").toLowerCase() !== baseHost.toLowerCase()) return null;

    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const komikIdx = segments.indexOf("komik");
    if (komikIdx === -1 || segments.length < komikIdx + 2) return null;

    const slug = segments[komikIdx + 1];
    if (slug.length === 0) return null;

    const manga = SManga.create();
    manga.url = `/komik/${slug}`;
    try {
      return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    } catch {
      return null;
    }
  }

  // ======================== Helpers & Filters ==============
  private readonly zoneJakarta = ZoneId.of("Asia/Jakarta");
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new OrderFilter(), new StatusFilter(), new TypeFilter(), new Filter.Separator(), new GenreFilter());
  }
}
