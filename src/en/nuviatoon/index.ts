// Port of keiyoushi/extensions-source src/en/nuviatoon/NuviaToon.kt (+ Filters.kt, Dto.kt)
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, substringAfter, substringBefore, toHttpUrl, tryParseInstant } from "../../../sdk/index.ts";

// --- Filters.kt
class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["All", "Ongoing", "Completed", "Hiatus"]);
  }
  toUriPart(): string | null {
    switch (this.state) {
      case 1:
        return "ongoing";
      case 2:
        return "completed";
      case 3:
        return "hiatus";
      default:
        return null;
    }
  }
}

class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort By", ["Popular", "Latest", "A-Z"], { index: 0, ascending: false }); // Defaults to "Popular" descending
  }
  toUriPart(): string {
    switch (this.state?.index) {
      case 1:
        return "created_at";
      case 2:
        return "title";
      default:
        return "views";
    }
  }
  toDirPart(): string {
    return this.state?.ascending === true ? "asc" : "desc";
  }
}

class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genre", ["All", "Action", "Romance", "Fantasy", "Comedy", "Adventure", "Drama", "Mystery", "Supernatural", "School Life", "Shounen", "Shoujo", "Magic"]);
  }
  toUriPart(): string | null {
    return this.state === 0 ? null : this.values[this.state];
  }
}

// --- Dto.kt
interface PaginatedResponse<T> {
  data: T[];
  meta: { current_page: number; last_page: number };
}

interface SeriesDto {
  title: string;
  slug: string;
  cover_url?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string[] | null;
}

function seriesToSManga(dto: SeriesDto): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.url = dto.slug;
  manga.thumbnail_url = dto.cover_url ?? undefined;
  manga.author = dto.author ?? undefined;
  manga.artist = dto.artist ?? undefined;
  manga.description = dto.description ?? undefined;
  manga.genre = dto.genres?.join(", ");
  manga.status = parseStatus(dto.status);
  return manga;
}

function parseStatus(status: string | null | undefined): number {
  switch (status?.toLowerCase()) {
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

interface ChapterDto {
  id: string;
  title?: string | null;
  number?: number | null;
  created_at?: string | null;
}

function chapterToSChapter(dto: ChapterDto, slug: string): SChapter {
  const chapter = SChapter.create();
  const numberString = dto.number != null ? String(dto.number) : "";
  chapter.name = dto.title ?? `Chapter ${numberString}`.trim();
  chapter.url = `${slug}/chapter/${numberString}?id=${dto.id}`;
  chapter.chapter_number = dto.number ?? -1;
  chapter.date_upload = tryParseInstant(dto.created_at);
  return chapter;
}

export default class NuviaToon extends KeiSource {
  protected override configureHeaders(headers: Headers): Headers {
    headers.append("Accept", "application/json");
    return headers;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/nuvia-api/series?per_page=18&page=${page}&sort=views&dir=desc`);
    return this.parseMangasPage(response.parseAs<PaginatedResponse<SeriesDto>>());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.client.get(`${this.baseUrl}/nuvia-api/series?per_page=18&page=${page}&sort=created_at&dir=desc`);
    return this.parseMangasPage(response.parseAs<PaginatedResponse<SeriesDto>>());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/nuvia-api/series`).newBuilder();
    url.addQueryParameter("per_page", "18");
    url.addQueryParameter("page", String(page));

    if (query.length > 0) url.addQueryParameter("q", query);

    const statusFilter = firstInstanceOrNull(filters, StatusFilter)?.toUriPart();
    const genreFilter = firstInstanceOrNull(filters, GenreFilter)?.toUriPart();
    const sortFilter = firstInstanceOrNull(filters, SortFilter);

    if (statusFilter != null) url.addQueryParameter("status", statusFilter);
    if (genreFilter != null) url.addQueryParameter("genre", genreFilter);

    if (sortFilter != null) {
      url.addQueryParameter("sort", sortFilter.toUriPart());
      url.addQueryParameter("dir", sortFilter.toDirPart());
    } else {
      url.addQueryParameter("sort", "views");
      url.addQueryParameter("dir", "desc");
    }

    const response = await this.client.get(url.build().toString());
    return this.parseMangasPage(response.parseAs<PaginatedResponse<SeriesDto>>());
  }

  private parseMangasPage(dto: PaginatedResponse<SeriesDto>): MangasPage {
    return new MangasPage(
      dto.data.map((it) => seriesToSManga(it)),
      dto.meta.current_page < dto.meta.last_page,
    );
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.hostname !== toHttpUrl(this.baseUrl).host || segments[0] !== "series") return null;
    const slug = segments[1];
    if (slug == null) return null;

    const manga = await this.fetchMangaDetails(slug);
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/series/${substringBefore(chapter.url, "?")}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga.url) : manga, fetchChapters ? this.fetchChapterList(manga.url) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(slug: string): Promise<SManga> {
    return seriesToSManga((await this.client.get(`${this.baseUrl}/nuvia-api/series/${slug}`)).parseAs<SeriesDto>());
  }

  private async fetchChapterList(slug: string): Promise<SChapter[]> {
    return (await this.client.get(`${this.baseUrl}/nuvia-api/series/${slug}/chapters`))
      .parseAs<ChapterDto[]>()
      .map((it) => chapterToSChapter(it, slug))
      .reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const id = substringAfter(chapter.url, "id=");
    return (await this.client.get(`${this.baseUrl}/nuvia-api/chapters/${id}/pages`)).parseAs<{ image_url: string }[]>().map((dto, index) => new Page(index, "", dto.image_url));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new StatusFilter(), new GenreFilter(), new SortFilter());
  }
}
