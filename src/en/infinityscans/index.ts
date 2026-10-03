// Port of keiyoushi/extensions-source src/en/infinityscans/InfinityScans.kt
// (with Dto.kt and WebviewInterceptor.kt; the WebView captcha step is not ported: it throws upstream's message)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  extractNextJs,
  extractNextJsRsc,
  parseAs,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type Response,
} from "../../../sdk/index.ts";
import { AuthorFilter, GenreFilter, SortFilter, SortType, StatusFilter } from "./filters.ts";

// --- Dto.kt
interface SearchEntryDto {
  id: string;
  name: string;
  uri: string;
  cover: string;
  authors: string | null;
  genres: string | null;
  status: string | null;
}
interface SearchResultDto {
  titles: SearchEntryDto[];
}
interface MangaDetailsDto {
  name: string;
  uri: string;
  altNames?: string[] | null;
  description: { content: { content?: { text?: string }[] | null }[] };
  genres: { name: string }[];
  authors: { name: string }[];
  status: string;
  cover?: string | null;
}
interface FilterDto {
  id: string;
  name: string;
}
interface FiltersDto {
  genres: FilterDto[];
  authors: FilterDto[];
}
interface ChapterEntryDto {
  groups: { id: string; name: string }[] | null;
  id: string;
  name: string;
  sequence: string;
  uploaded: string;
}
interface ChapterListDto {
  chapters: ChapterEntryDto[];
  total: number;
}
interface PageEntryDto {
  path: string;
}

function searchEntryToSManga(e: SearchEntryDto, cdnHost: string): SManga {
  const manga = SManga.create();
  manga.title = e.name;
  manga.thumbnail_url = `https://${cdnHost}/${e.cover}`;
  // comic/mangaId/manga-slug
  manga.url = substringAfter(e.uri, "/");
  return manga;
}

/** Kotlin's String.toFloatOrNull() */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(s.trim()) && s.trim() === s ? Number.parseFloat(s) : null);

function chapterToSChapter(c: ChapterEntryDto, mangaPath: string): SChapter {
  const chapter = SChapter.create();
  chapter.name = c.name;
  // Things like prologues mess up the sequence number
  chapter.chapter_number = toFloatOrNull(substringAfter(c.name, "hapter ")) ?? Number(c.sequence);
  chapter.date_upload = tryParseInstant(c.uploaded);
  chapter.url = `${mangaPath}/chapter/${c.id}`;
  chapter.scanlator = c.groups?.map((it) => it.name).join(", ");
  return chapter;
}

const SESSION_COOKIE = "__Secure-infinityscans.data";
const DEFAULT_SLUG_HASH = "d806990541c8";
const PREF_SLUG_HASH = "pref_slug_hash";
const HASH_REGEX = /NEXT_REDIRECT.*https.+?-(\w+);/;

/** Response.hasDeleteSessionCookie(): the session cookie is set to an empty value. */
const hasDeleteSessionCookie = (response: Response): boolean =>
  (response.header("set-cookie") ?? "")
    .split(/,\s*(?=[^;,=\s]+=)/)
    .some((it) => it.startsWith(SESSION_COOKIE) && substringBefore(substringAfter(it, `${SESSION_COOKIE}=`), ";") === "");

export default class InfinityScans extends KeiSource {
  private readonly cdnHost = "cv.infinityscans.org";
  private readonly pageCdnHost = "ch.infinityscans.org";

  private get slugHash(): string {
    return this.preferences.getString(PREF_SLUG_HASH, DEFAULT_SLUG_HASH) ?? DEFAULT_SLUG_HASH;
  }
  private set slugHash(value: string) {
    this.preferences.edit().putString(PREF_SLUG_HASH, value).apply();
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    // WebviewInterceptor: upstream resolves the captcha in a WebView and retries; there is none here
    return builder
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const response = await chain.proceed(request);
        if (hasDeleteSessionCookie(response)) throw new Error("Solve webview Captcha and refresh.");
        return response;
      })
      .rateLimit(5);
  }

  private get rscHeaders() {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  private get apiHeaders() {
    const h = this.headersBuilder();
    h.append("Accept", "application/json, text/javascript, */*; q=0.01");
    h.append("Sec-Fetch-Dest", "empty");
    h.append("Sec-Fetch-Mode", "cors");
    h.append("Sec-Fetch-Site", "same-origin");
    h.append("X-requested-with", "XMLHttpRequest");
    return h;
  }

  private jsonHeaders(headers: Headers): Headers {
    headers.set("Content-Type", "application/json");
    return headers;
  }

  // ============================== Popular + Latest ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getMangaList(page, SortType.Popularity);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getMangaList(page, SortType.Latest);
  }

  private async getMangaList(page: number, sort: string): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/api/comics?page=${page}&sort=${sort}`, this.apiHeaders);
    const data = response.parseAs<SearchResultDto>();
    const entries = data.titles.map((it) => searchEntryToSManga(it, this.cdnHost));
    return new MangasPage(entries, entries.length > 0);
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let response: Response;
    if (query.trim() === "") {
      const url = toHttpUrl(`${this.baseUrl}/api/comics`).newBuilder();
      url.addQueryParameter("page", String(page));
      for (const filter of filters) {
        if (filter instanceof SortFilter) {
          const s = filter.selected;
          if (s != null) url.addQueryParameter("sort", s);
        } else if (filter instanceof GenreFilter) filter.checked?.forEach((it) => url.addQueryParameter("genre", it));
        else if (filter instanceof AuthorFilter) filter.checked?.forEach((it) => url.addQueryParameter("author", it));
        else if (filter instanceof StatusFilter) {
          const s = filter.checked[0];
          if (s != null) url.addQueryParameter("status", s);
        }
      }
      response = await this.client.get(url.build().toString(), this.apiHeaders);
    } else {
      response = await this.client.post(`${this.baseUrl}/api/search`, this.jsonHeaders(this.apiHeaders), JSON.stringify({ search: query }));
    }

    if (query.length > 0) {
      const list = response.parseAs<{ result: SearchEntryDto[] }>().result;
      return new MangasPage(
        list.map((it) => searchEntryToSManga(it, this.cdnHost)),
        false,
      );
    }
    const data = response.parseAs<SearchResultDto>();
    const mangas = data.titles.map((it) => searchEntryToSManga(it, this.cdnHost));
    return new MangasPage(mangas, mangas.length > 0);
  }

  // ============================== Details ==============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments.length < 3) return null;

    const html = (await this.client.get(url, this.rscHeaders)).text();
    return this.parseMangaDetails(html);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comic/${manga.url}-${this.slugHash}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(m, c);
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const url = `${this.baseUrl}/comic/${manga.url}-${this.slugHash}`;
    const html = (await this.client.get(url, this.rscHeaders)).text();
    try {
      return this.parseMangaDetails(html);
    } catch {
      const newHash = HASH_REGEX.exec(html)?.[1];
      if (newHash == null) throw new Error("Failed to find slug hash");
      this.slugHash = newHash;
      const newHtml = (await this.client.get(`${this.baseUrl}/comic/${manga.url}-${this.slugHash}`, this.rscHeaders)).text();
      return this.parseMangaDetails(newHtml);
    }
  }

  private parseMangaDetails(responseHtml: string): SManga {
    // inferred predicate: the required (non-optional, non-null) keys of MangaDetailsDto
    const dto = extractNextJsRsc<MangaDetailsDto>(
      responseHtml,
      (it) => typeof it === "object" && it !== null && !Array.isArray(it) && ["name", "uri", "description", "genres", "authors", "status"].every((k) => k in it),
    );
    if (dto == null) throw new Error("Failed to extract manga details");
    const manga = SManga.create();
    manga.url = substringAfter(dto.uri, "/");
    manga.title = dto.name;
    let description = (dto.description.content[0]?.content?.map((it) => it.text ?? "").join(" ") ?? "");
    if (dto.altNames != null && dto.altNames.length) description += `\n\nAlternative Title: ${dto.altNames.join(" · ")}`;
    manga.description = description;
    manga.author = dto.authors.map((it) => it.name).join(", ");
    manga.genre = dto.genres.map((it) => it.name).join(", ");
    manga.status = this.parseStatus(dto.status);
    manga.thumbnail_url = `https://${this.cdnHost}/${dto.cover}`;
    return manga;
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const id = substringBefore(manga.url, "/");
    const first = (await this.client.get(`${this.baseUrl}/api/comic/${id}/chapters?page=0`)).parseAs<ChapterListDto>();

    const all = [...first.chapters];
    if (first.total > first.chapters.length) {
      const chunkSize = first.chapters.length;
      const totalPages = Math.floor((first.total + chunkSize - 1) / chunkSize);

      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) => i + 1).map(async (page) => (await this.client.get(`${this.baseUrl}/api/comic/${id}/chapters?page=${page}`)).parseAs<ChapterListDto>().chapters),
      );
      for (const r of rest) all.push(...r);
    }
    return all.map((it) => chapterToSChapter(it, `comic/${id}`));
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = substringAfterLast(chapter.url, "/");
    const mangaId = chapter.url.split("/")[1];

    const pageHeaders = this.headersBuilder();
    pageHeaders.set("next-action", "603b9ae64dc53c5457f77cf6a4ea08b361e2e36b2f");

    const body = JSON.stringify([mangaId, chapterId]);
    // Dummy slug for server to trigger empty set-cookie if expired, baseUrl alone doesn't.
    const pagesUrl = `${this.baseUrl}/comic/${mangaId}/dummy-slug/chapter/${chapterId}`;

    const response = await this.client.post(pagesUrl, this.jsonHeaders(pageHeaders), body);
    const pages = extractNextJs<PageEntryDto[]>(
      response,
      (it) => Array.isArray(it) && it.length > 0 && typeof it[0] === "object" && it[0] !== null && "path" in it[0],
    );
    return pages?.map((p, index) => new Page(index, "", `https://${this.pageCdnHost}/${p.path}`)) ?? [];
  }

  override imageRequest(page: Page) {
    const pageHeaders = this.headers;
    pageHeaders.append("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*");
    pageHeaders.append("Host", new URL(page.imageUrl!).host);
    return { url: page.imageUrl!, headers: pageHeaders };
  }

  // ============================== Filters ==============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    // load genre and author filters
    const response = await this.client.get(`${this.baseUrl}/api/comics/options`, this.apiHeaders);
    return response.parseAs<FiltersDto>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const dto = data as FiltersDto | null;
    const filters: Filter[] = [new Filter.Header("Filtering is ignored when searching by text."), new SortFilter(), new StatusFilter()];
    if (dto != null) {
      if (dto.genres.length) filters.push(new GenreFilter("Genres", dto.genres.map((it) => [it.name, it.id] as [string, string])));
      if (dto.authors.length) filters.push(new AuthorFilter("Authors", dto.authors.map((it) => [it.name, it.id] as [string, string])));
    }
    return FilterList(...filters);
  }

  // ============================= Utilities =============================

  private parseStatus(s: string | null): number {
    if (s == null) return SManga.UNKNOWN;
    const l = s.toLowerCase();
    if (["ongoing", "publishing"].some((it) => l.includes(it))) return SManga.ONGOING;
    if (l.includes("hiatus")) return SManga.ON_HIATUS;
    if (l.includes("completed")) return SManga.COMPLETED;
    if (["dropped", "cancelled"].some((it) => l.includes(it))) return SManga.CANCELLED;
    return SManga.UNKNOWN;
  }
}
