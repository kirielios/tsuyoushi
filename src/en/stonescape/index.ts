// Port of keiyoushi/extensions-source src/en/stonescape/StoneScape.kt (+ Dto.kt)
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  type Response,
} from "../../../sdk/index.ts";
import { GenreFilter, StatusFilter, findGenre, genreLabel, getGenreList } from "./filters.ts";

// --- Dto.kt
interface SeriesResponse {
  data: SeriesDto[];
  pagination?: PaginationDto | null;
}
interface PaginationDto {
  page?: number | null;
  totalPages?: number | null;
}
interface SeriesDto {
  title: string;
  slug: string;
  coverUrl?: string | null;
  description?: string | null;
  publicationStatus?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string[] | null;
}

function seriesToSManga(dto: SeriesDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = `/series/${dto.slug}`;
  manga.title = dto.title;
  manga.thumbnail_url = dto.coverUrl != null ? baseUrl + dto.coverUrl : undefined;
  return manga;
}

function seriesToSMangaDetails(dto: SeriesDto, baseUrl: string): SManga {
  const manga = seriesToSManga(dto, baseUrl);
  manga.description = dto.description ?? undefined;

  switch (dto.publicationStatus?.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "dropped":
    case "cancelled":
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }

  manga.author = dto.author ?? undefined;
  manga.artist = dto.artist ?? undefined;
  manga.genre = dto.genres?.map((it) => genreLabel(it)).join(", ");
  manga.initialized = true;
  return manga;
}

interface ChapterListResponse {
  chapters: ChapterDto[];
}
interface ChapterDto {
  chapterId: string;
  chapterNumber: string;
  title?: string | null;
  createdAt?: string | null;
}

/** String.toFloatOrNull() */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim()) ? Number(s) : null);

function chapterToSChapter(dto: ChapterDto, seriesSlug: string): SChapter {
  const chapter = SChapter.create();
  const n = toFloatOrNull(dto.chapterNumber);
  const formattedNumber = n != null ? String(n).replace(/\.0$/, "") : dto.chapterNumber;

  chapter.url = `/series/${seriesSlug}/ch-${formattedNumber}#${dto.chapterId}`;
  chapter.name = `Chapter ${formattedNumber}${dto.title ? ` - ${dto.title}` : ""}`;
  chapter.date_upload = tryParseInstant(dto.createdAt);
  chapter.chapter_number = toFloatOrNull(formattedNumber) ?? -1;
  return chapter;
}

interface ChapterDetailsDto {
  pages?: PageDto[];
  images?: PageDto[];
}
interface PageDto {
  pageNumber?: number;
  url: string;
}

export default class StoneScape extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(`${this.apiUrl}/series/popular?page=${page}&period=week&contentType=manhwa&limit=24`));
  }

  private toMangasPage(response: Response): MangasPage {
    const result = response.parseAs<SeriesResponse>();

    const mangas = result.data.map((it) => seriesToSManga(it, this.baseUrl));

    const hasNextPage = (result.pagination?.page ?? 1) < (result.pagination?.totalPages ?? 1);

    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(`${this.apiUrl}/series?page=${page}&limit=24&contentType=manhwa`));
  }

  // ============================== Search ===============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) return null;

    const segments = url.pathname.slice(1).split("/");
    const typeIndex = segments.findIndex((it) => it === "series");

    if (typeIndex === -1 || typeIndex + 1 >= segments.length) return null;

    const slug = segments[typeIndex + 1];

    return seriesToSManga((await this.client.get(`${this.apiUrl}/series/by-slug/${slug}`)).parseAs<SeriesDto>(), this.baseUrl);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/series`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("limit", "24").addQueryParameter("contentType", "manhwa");

    const statusFilter = firstInstanceOrNull(filters, StatusFilter);
    if (statusFilter && statusFilter.state !== 0) url.addQueryParameter("status", statusFilter.toUriPart());

    const selectedGenres = (firstInstanceOrNull(filters, GenreFilter)?.state ?? []).filter((it) => it.state).map((it) => it.slug);

    if (query.length > 0) {
      const matchedGenre = findGenre(query);
      if (matchedGenre != null) {
        if (!selectedGenres.includes(matchedGenre.slug)) selectedGenres.push(matchedGenre.slug);
      } else {
        url.addQueryParameter("search", query);
      }
    }

    if (selectedGenres.length > 0) url.addQueryParameter("genres", selectedGenres.join(","));

    return this.toMangasPage(await this.client.get(url.build().toString()));
  }

  // ============================== Details ==============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringAfterLast(manga.url, "/");

    const details = (async () => (fetchDetails ? seriesToSMangaDetails((await this.client.get(`${this.apiUrl}/series/by-slug/${slug}`)).parseAs<SeriesDto>(), this.baseUrl) : manga))();

    const chapterList = (async () =>
      fetchChapters
        ? (await this.client.get(`${this.apiUrl}/series/by-slug/${slug}/chapters`))
            .parseAs<ChapterListResponse>()
            .chapters.map((it) => chapterToSChapter(it, slug))
            .reverse()
        : chapters)();

    return new SMangaUpdate(await details, await chapterList);
  }

  // ============================= Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${substringBefore(chapter.url, "#")}`;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = substringAfter(chapter.url, "#");

    const result = (await this.client.get(`${this.apiUrl}/chapters/${chapterId}/pages`)).parseAs<ChapterDetailsDto>();
    const allPages = result.pages?.length ? result.pages : (result.images ?? []);

    return allPages.map((page, index) => new Page((page.pageNumber ?? 0) > 0 ? page.pageNumber! - 1 : index, "", this.baseUrl + page.url));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new StatusFilter(), new GenreFilter(getGenreList()));
  }
}
