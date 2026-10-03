// Port of keiyoushi/extensions-source src/id/comicaso/Comicaso.kt
import { ClientBuilder, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, isNotBlank, parseHtml, substringAfterLast, toHttpUrl, type Chain, type Response } from "../../../sdk/index.ts";
import { GenreFilter, SourceFilter, TypeFilter } from "./filters.ts";

// Dto.kt
interface HomeResponseDto {
  data?: MangaDto[];
  has_more?: boolean;
}
interface TrendingResponseDto {
  data?: MangaDto[];
}
interface MangaDto {
  slug: string;
  title: string;
  thumbnail?: string | null;
  source?: string | null;
}
interface MangaDetailResponseDto {
  data: MangaDetailDto;
}
interface MangaDetailDto {
  slug: string;
  title: string;
  thumbnail?: string | null;
  synopsis?: string | null;
  alternative?: string | null;
  status?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string[] | null;
  chapters?: ChapterDto[] | null;
}
interface ChapterDto {
  slug: string;
  title: string;
  chapter_token: string;
  date?: number | null;
}
interface ChapterResponseDto {
  data: ChapterImagesDto;
}
interface ChapterImagesDto {
  images?: string[] | null;
}

function mangaDtoToSManga(dto: MangaDto): SManga {
  const m = SManga.create();
  m.url = `${dto.source ?? "all"}/${dto.slug}`;
  m.title = dto.title;
  m.thumbnail_url = dto.thumbnail ?? undefined;
  return m;
}

function chapterDtoToSChapter(dto: ChapterDto, source: string, mangaSlug: string): SChapter {
  const c = SChapter.create();
  c.url = `${source}/${mangaSlug}/${dto.slug}?token=${dto.chapter_token}`;
  c.name = dto.title;
  c.date_upload = dto.date != null ? dto.date * 1000 : 0;
  return c;
}

const PAGE_SIZE = 60;
const chapterNumberRegex = /(?:bab|chapter|ch|ep|episode)\s*(?:[-:]\s*)?(\d+(?:\.\d+)?)/i;
const chapterNumberFallbackRegex = /\d+(?:\.\d+)?/;

const CDN_DOMAINS = ["basrat.online", "gurihnyoh.site", "jeletot.fun"];
const HOST_TO_PREFIX: Record<string, string> = {
  "ap.imgmanga.com": "tilu",
  "ap2.imgmanga.com": "opat",
  "cdn.imgmacha.com": "hiji",
  "cdn2.imgmacha.com": "dua",
};

const toFloatOrNull = (s: string | undefined) => (s != null && /^\d+(?:\.\d+)?$/.test(s) ? parseFloat(s) : null);

export default class Comicaso extends KeiSource {
  protected override configureHeaders(headers: Headers): Headers {
    headers.set("X-Comicaso-Platform", "web");
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor((chain) => this.authInterceptor(chain))
      .addChainInterceptor((chain) => this.cdnInterceptor(chain))
      .rateLimit(4);
  }

  private async authInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const response = await chain.proceed(request);
    if (response.code === 403) {
      const peekBody = new TextDecoder().decode(response.bytes().slice(0, 1024));
      if (peekBody.includes('"locked":true')) throw new Error("Login wajib untuk membuka konten ini. Buka di WebView dan login dengan Google.");
    }
    return response;
  }

  private async cdnInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const response = await chain.proceed(request);

    if (response.isSuccessful || response.code === 403 || response.code === 401) return response;

    const url = new URL(request.url);
    const prefix = HOST_TO_PREFIX[url.hostname];
    if (prefix == null) return response;

    for (const domain of CDN_DOMAINS) {
      const newUrl = new URL(request.url);
      newUrl.hostname = `${prefix}.${domain}`;
      const newResponse = await chain.proceed({ ...request, url: newUrl.href });
      if (newResponse.isSuccessful) return newResponse;
    }

    return chain.proceed(request);
  }

  // ============================== Popular ==============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/api/trending.php?period=all&limit=${PAGE_SIZE}`);
    const res = response.parseAs<TrendingResponseDto>();
    return new MangasPage((res.data ?? []).map(mangaDtoToSManga), false);
  }

  // ============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const offset = (page - 1) * PAGE_SIZE;
    const url = toHttpUrl(`${this.baseUrl}/api/home.php`)
      .newBuilder()
      .addQueryParameter("source", "all")
      .addQueryParameter("q", "")
      .addQueryParameter("mode", "update")
      .addQueryParameter("type", "all")
      .addQueryParameter("limit", String(PAGE_SIZE))
      .addQueryParameter("offset", String(offset))
      .build();

    const res = (await this.client.get(String(url))).parseAs<HomeResponseDto>();
    return new MangasPage((res.data ?? []).map(mangaDtoToSManga), res.has_more ?? false);
  }

  // ============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const offset = (page - 1) * PAGE_SIZE;
    const source = firstInstanceOrNull(filters, SourceFilter)?.toUriPart() ?? "all";
    const type = firstInstanceOrNull(filters, TypeFilter)?.toUriPart() ?? "all";
    const genre = firstInstanceOrNull(filters, GenreFilter)?.toUriPart() ?? "";

    const url = toHttpUrl(`${this.baseUrl}/api/home.php`)
      .newBuilder()
      .addQueryParameter("source", source)
      .addQueryParameter("q", query)
      .addQueryParameter("mode", "update")
      .addQueryParameter("type", type)
      .addQueryParameter("genre", genre)
      .addQueryParameter("limit", String(PAGE_SIZE))
      .addQueryParameter("offset", String(offset))
      .build();

    const res = (await this.client.get(String(url))).parseAs<HomeResponseDto>();
    return new MangasPage((res.data ?? []).map(mangaDtoToSManga), res.has_more ?? false);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    let slug: string | null;
    if (url.searchParams.get("page") === "manga") slug = url.searchParams.get("slug");
    else if (segments.length >= 2) slug = segments[1] || null;
    else slug = null;
    if (slug == null) return null;

    const source = url.searchParams.get("source") ?? segments[0] ?? "all";
    const manga = SManga.create();
    manga.url = `${source}/${slug}`;
    try {
      return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    } catch {
      return null;
    }
  }

  // ============================== Details & Chapters ===================
  override getMangaUrl(manga: SManga): string {
    const segments = this.urlSegments(manga.url);
    const source = segments[0] ?? "all";
    const slug = segments[1] ?? "";
    return `${this.baseUrl}/?page=manga&source=${source}&slug=${slug}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const segments = this.urlSegments(chapter.url);
    const source = segments[0] ?? "all";
    const manga = segments[1] ?? "";
    const slug = segments[2] ?? "";
    return `${this.baseUrl}/?page=chapter&source=${source}&manga=${manga}&chapter=${slug}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const segments = this.urlSegments(manga.url);
    const source = segments[0] ?? "all";
    const slug = segments[1] ?? "";
    const res = (await this.client.get(`${this.baseUrl}/api/manga.php?source=${source}&slug=${slug}&platform=web`)).parseAs<MangaDetailResponseDto>();
    const key = (chapter: SChapter) =>
      toFloatOrNull(chapterNumberRegex.exec(chapter.name)?.[1]) ??
      toFloatOrNull(chapterNumberFallbackRegex.exec(chapter.name)?.[0]) ??
      toFloatOrNull(chapterNumberFallbackRegex.exec(substringAfterLast(chapter.url, "/"))?.[0]) ??
      -1;
    const parsedChapters = (res.data.chapters ?? [])
      .map((it) => chapterDtoToSChapter(it, source, res.data.slug))
      .map((c) => ({ c, k: key(c) }))
      .sort((a, b) => b.k - a.k || (a.c.name < b.c.name ? 1 : a.c.name > b.c.name ? -1 : 0))
      .map((it) => it.c);
    return new SMangaUpdate(this.detailToSManga(res.data, source), parsedChapters);
  }

  private detailToSManga(d: MangaDetailDto, source: string): SManga {
    const m = SManga.create();
    m.url = `${source}/${d.slug}`;
    m.title = d.title;
    m.thumbnail_url = d.thumbnail ?? undefined;
    let description = "";
    if (d.synopsis != null) description += parseHtml(this.host.load, d.synopsis, "").text();
    if (isNotBlank(d.alternative)) {
      if (description.length > 0) description += "\n\n";
      description += `Alternative: ${d.alternative}`;
    }
    m.description = description;
    m.author = d.author ?? undefined;
    m.artist = d.artist ?? undefined;
    m.genre = d.genres?.join(", ");
    switch (d.status?.toLowerCase()) {
      case "on-going":
      case "ongoing":
        m.status = SManga.ONGOING;
        break;
      case "end":
      case "completed":
        m.status = SManga.COMPLETED;
        break;
      default:
        m.status = SManga.UNKNOWN;
    }
    m.initialized = true;
    return m;
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = toHttpUrl(`${this.baseUrl}/${chapter.url}`);
    const source = url.pathSegments[0] ?? "all";
    const manga = url.pathSegments[1] ?? "";
    const slug = url.pathSegments[2] ?? "";
    const token = url.queryParameter("token")!;

    const apiUri = toHttpUrl(`${this.baseUrl}/api/chapter.php`).newBuilder().addQueryParameter("source", source).addQueryParameter("manga", manga).addQueryParameter("chapter", slug).addQueryParameter("token", token).build();

    const res = (await this.client.get(String(apiUri))).parseAs<ChapterResponseDto>();
    return (res.data.images ?? []).map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // ============================== Filters ==============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SourceFilter(), new TypeFilter(), new GenreFilter());
  }

  // ============================= Utilities =============================
  private urlSegments(url: string): string[] {
    return toHttpUrl(`${this.baseUrl}/${url}`).pathSegments;
  }
}
