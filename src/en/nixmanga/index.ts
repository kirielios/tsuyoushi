// Port of keiyoushi/extensions-source src/en/nixmanga/NixManga.kt (with Dto.kt)
import {
  ClientBuilder,
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  ZoneOffset,
  firstInstanceOrNull,
  substringAfter,
  substringAfterLast,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { DemographicFilter, GenreList, SortFilter, StatusFilter, TypeFilter, YearFilter, getGenreList } from "./filters.ts";

// --- Dto.kt
interface GenreDto {
  name: string;
}
interface ComicDto {
  slug: string;
  title: string;
  synopsis?: string | null;
  cover?: string | null;
  status?: string | null;
  genres?: GenreDto[];
}
interface PaginatedComicsDto {
  comics?: ComicDto[];
  results?: ComicDto[]; // @JsonNames("results")
  page?: number;
  total_pages?: number;
  total?: number;
}
interface ChapterDto {
  id: string;
  number?: number | null;
  title?: string | null;
  slug: string;
  published_at?: string | null;
  scanlator?: { name: string } | null;
}
interface PaginatedChaptersDto {
  chapters?: ChapterDto[];
  page?: number;
  total_pages?: number;
}
interface PagesDto {
  pages?: { image_url: string }[];
}

const comicHasNextPage = (dto: PaginatedComicsDto) => {
  const page = dto.page ?? 1;
  return page < (dto.total_pages ?? 1) || page * 24 < (dto.total ?? 0);
};

function parseComicStatus(status: string | null | undefined): number {
  switch (status?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    case "cancelled":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

function comicToSManga(c: ComicDto): SManga {
  const manga = SManga.create();
  manga.url = c.slug;
  manga.title = c.title;
  manga.thumbnail_url = c.cover ?? undefined;
  manga.status = parseComicStatus(c.status);
  manga.description = c.synopsis ?? undefined;
  manga.genre = (c.genres ?? []).map((it) => it.name).join(", ");
  return manga;
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);

function parseDate(dateStr: string | null | undefined): number {
  if (dateStr == null) return 0;
  let cleanDate: string;
  if (dateStr.includes(".")) {
    const split = dateStr.split(".");
    const decimals = split[1].replace(/Z$/, "").slice(0, 3).padEnd(3, "0");
    cleanDate = `${split[0]}.${decimals}Z`;
  } else {
    cleanDate = `${dateStr.replace(/Z$/, "")}.000Z`;
  }
  return dateFormat.tryParseDateTime(cleanDate, ZoneOffset.UTC);
}

/** Kotlin's Float.toString().removeSuffix(".0") */
const floatText = (n: number) => String(n);

function chapterToSChapter(c: ChapterDto, mangaSlug: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/read/${mangaSlug}/${c.slug}#${c.id}`;

  let chapterName = "";
  if (c.number != null) {
    chapterName += "Chapter ";
    chapterName += floatText(c.number);
  } else {
    chapterName += "Chapter";
  }
  if (c.title != null && c.title !== "") {
    chapterName += " - ";
    chapterName += c.title;
  }
  chapter.name = chapterName.trim();
  chapter.date_upload = parseDate(c.published_at);
  chapter.scanlator = c.scanlator?.name;
  return chapter;
}

const SITE_ID = "00000000-0000-0000-0000-000000000003";

const reverse = (s: string) => [...s].reverse().join("");
const rJoin = (arr: string[]) => arr.map(reverse).join("");
const removeSurrounding = (s: string, d: string) => (s.length >= 2 * d.length && s.startsWith(d) && s.endsWith(d) ? s.slice(d.length, s.length - d.length) : s);

export default class NixManga extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private readonly apiUrl = "https://api.nixmanga.com";

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const req = chain.request();

      if (new URL(req.url).hostname === new URL(this.apiUrl).hostname) {
        let response = await chain.proceed(req);
        if (response.code === 401) {
          const newReq: Request = { ...req, headers: await this.getApiHeaders(new URL(req.url).pathname, true) };
          response = await chain.proceed(newReq);
        }
        return response;
      }
      return chain.proceed(req);
    });
  }

  private cachedSlot = "";
  private cachedToken = "";
  private cachedSignature = "";

  private get signerJsUrl() {
    return `${this.apiUrl}/_nix/signer.js`;
  }
  private readonly signerJsRegex = /const z=\[(.*?)\],/;

  private async refreshAuthValues(endpoint: string): Promise<void> {
    const response = await this.client.execute(GET(this.signerJsUrl, this.headers));
    const body = response.text();

    const match = this.signerJsRegex.exec(body);
    const zArr = match![1].split(",").map((it) => removeSurrounding(it.trim(), '"'));

    const slot = reverse(zArr[0]);
    const token = rJoin(zArr.slice(4));
    const k = rJoin(zArr.slice(1, 4));

    const payload = `GET|${endpoint}|${SITE_ID}|${slot}|${token}|${k}`;
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
    // Base64.getUrlEncoder().withoutPadding()
    const sig = btoa(String.fromCharCode(...hash))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

    this.cachedSlot = slot;
    this.cachedToken = token;
    this.cachedSignature = sig;
  }

  private async getApiHeaders(endpoint: string, refresh = false): Promise<Headers> {
    if (refresh || this.cachedSlot === "") await this.refreshAuthValues(endpoint);

    const h = this.headersBuilder();
    h.set("x-web-token", this.cachedToken);
    h.set("x-web-signature", this.cachedSignature);
    h.set("x-web-slot", this.cachedSlot);
    h.set("x-site-id", SITE_ID);
    h.set("Accept", "*/*");
    h.set("Origin", this.baseUrl);
    h.set("Referer", `${this.baseUrl}/`);
    h.set("sec-fetch-site", "same-site");
    return h;
  }

  private async apiRequest(endpoint: string, path: string): Promise<Request> {
    return GET(`${this.apiUrl}/api/v1${path}`, await this.getApiHeaders(endpoint));
  }

  // ============================== Popular ==============================

  protected popularMangaRequest(page: number): Promise<Request> {
    const endpoint = "/api/v1/comics";
    const url = `/comics?page=${page}&per_page=24&sort=popular`;
    return this.apiRequest(endpoint, url);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const dto = response.parseAs<PaginatedComicsDto>();
    return new MangasPage((dto.comics ?? dto.results ?? []).map(comicToSManga), comicHasNextPage(dto));
  }

  // ============================== Latest ===============================

  protected latestUpdatesRequest(page: number): Promise<Request> {
    const endpoint = "/api/v1/comics";
    const url = `/comics?page=${page}&per_page=24&sort=latest`;
    return this.apiRequest(endpoint, url);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Search ===============================

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Promise<Request> {
    if (query.length > 0) {
      const endpoint = "/api/v1/comics/search";
      const url = `/comics/search?q=${query}&page=${page}`;
      return this.apiRequest(endpoint, url);
    }

    const endpoint = "/api/v1/comics";
    const b = toHttpUrl(`https://a.invalid/comics?page=${page}&per_page=24`).newBuilder();
    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    if (sortFilter != null) {
      const sortMode = ["latest", "popular", "rating", "name", "chapters", "oldest"][sortFilter.state?.index ?? -1] ?? "latest";
      b.addQueryParameter("sort", sortMode);
    } else {
      b.addQueryParameter("sort", "latest");
    }

    for (const [cls, name] of [
      [TypeFilter, "type"],
      [StatusFilter, "status"],
      [DemographicFilter, "demographic"],
    ] as const) {
      const part = firstInstanceOrNull(filters, cls)?.toUriPart();
      if (part) b.addQueryParameter(name, part);
    }
    const year = firstInstanceOrNull(filters, YearFilter)?.state;
    if (year) b.addQueryParameter("year", year);

    const genres = firstInstanceOrNull(filters, GenreList)
      ?.state.filter((it) => it.state)
      .map((it) => it.slug)
      .join(",");

    if (genres) b.addQueryParameter("genre", genres);

    // upstream builds the path from the absolute URL it parsed
    const built = b.build();
    return this.apiRequest(endpoint, built.encodedPath + (built.encodedQuery ? `?${built.encodedQuery}` : ""));
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ============================== Details ==============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override mangaDetailsRequest(manga: SManga): Promise<Request> {
    const slug = manga.url;
    const endpoint = `/api/v1/comics/slug/${slug}`;
    const url = `/comics/slug/${slug}`;
    return this.apiRequest(endpoint, url);
  }

  protected mangaDetailsParse(response: Response): SManga {
    return comicToSManga(response.parseAs<ComicDto>());
  }

  // ============================= Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + substringBeforeLast(chapter.url, "#");
  }

  protected override chapterListRequest(manga: SManga): Promise<Request> {
    return this.chapterListRequestPaginated(manga.url, 1);
  }

  private chapterListRequestPaginated(slug: string, page: number): Promise<Request> {
    const endpoint = `/api/v1/comics/slug/${slug}/chapters`;
    const url = `/comics/slug/${slug}/chapters?page=${page}&per_page=100&sort=newest`;
    return this.apiRequest(endpoint, url);
  }

  protected async chapterListParse(response: Response): Promise<SChapter[]> {
    let res = response;
    let dto = res.parseAs<PaginatedChaptersDto>();
    const chapters: SChapter[] = [];

    const mangaSlug = substringBefore(substringAfter(new URL(res.url).pathname, "/slug/"), "/");

    chapters.push(...(dto.chapters ?? []).map((it) => chapterToSChapter(it, mangaSlug)));

    let page = 1;
    while ((dto.page ?? 1) < (dto.total_pages ?? 1)) {
      page++;
      const nextReq = await this.chapterListRequestPaginated(mangaSlug, page);
      res = await this.client.execute(nextReq);
      dto = res.parseAs<PaginatedChaptersDto>();
      chapters.push(...(dto.chapters ?? []).map((it) => chapterToSChapter(it, mangaSlug)));
    }

    return chapters;
  }

  // =============================== Pages ===============================

  protected override pageListRequest(chapter: SChapter): Promise<Request> {
    const id = substringAfterLast(chapter.url, "#");
    const endpoint = `/api/v1/chapters/${id}`;
    const url = `/chapters/${id}?skip_view=true`;
    return this.apiRequest(endpoint, url);
  }

  protected pageListParse(response: Response): Page[] {
    return (response.parseAs<PagesDto>().pages ?? []).map((page, index) => new Page(index, "", page.image_url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new TypeFilter(), new StatusFilter(), new DemographicFilter(), new YearFilter(), new Filter.Separator(), new GenreList(getGenreList()));
  }
}
