// Port of keiyoushi/extensions-source src/en/greedscans/GreedScans.kt
import { DateTimeFormatter, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, toHttpUrl, type FilterList, type Request, type Response } from "../../../sdk/index.ts";
import { GenreFilter, MinChaptersFilter, SortFilter, StatusFilter, TypeFilter, isUrlFilter } from "./filters.ts";

// Dto.kt
interface SeriesListResponse {
  data: PaginatedData;
}
interface PaginatedData {
  data: BrowseSeries[];
  current_page: number;
  last_page: number;
}
const hasNextPage = (d: PaginatedData) => d.current_page < d.last_page;
interface BrowseSeries {
  title: string;
  slug: string;
  cover_image?: string | null;
  status?: string | null;
}
interface SeriesDetailResponse {
  data: SeriesDetail;
}
interface SeriesDetail {
  title: string;
  slug: string;
  synopsis?: string | null;
  author?: string | null;
  studio?: string | null;
  cover_image?: string | null;
  status?: string | null;
  genres?: string[];
  alternative_titles?: string[];
  chapters?: Chapter[];
}
interface Chapter {
  title: string;
  slug: string;
  chapter_number: number;
  created_at?: string | null;
  published_at?: string | null;
}
interface ChapterDetailResponse {
  data: ChapterDetail;
}
interface ChapterDetail {
  chapter: ChapterImages;
}
interface ChapterImages {
  images?: PageImage[];
}
interface PageImage {
  image_url: string;
}

const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'", Locale.ENGLISH);

export default class GreedScans extends HttpSource {
  private readonly apiUrl = "https://api.gojoscans.com/api";
  override get supportsLatest() {
    return true;
  }

  // ==================== POPULAR ====================

  protected popularMangaRequest(page: number) {
    return this.searchMangaRequest(page, "", SortFilter.popular);
  }

  protected popularMangaParse(response: Response) {
    return this.searchMangaParse(response);
  }

  // ==================== LATEST ====================

  protected latestUpdatesRequest(page: number) {
    return this.searchMangaRequest(page, "", SortFilter.latest);
  }

  protected latestUpdatesParse(response: Response) {
    return this.searchMangaParse(response);
  }

  // ==================== SEARCH ====================

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const builder = toHttpUrl(`${this.apiUrl}/series`).newBuilder();
    builder.addQueryParameter("page", String(page));
    builder.addQueryParameter("per_page", "24");
    builder.addQueryParameter("sort_order", "desc");
    if (query.length > 0) builder.addQueryParameter("search", query);
    for (const it of filters) if (isUrlFilter(it)) it.addToUrl(builder);

    return GET(builder.build().toString(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const data = response.parseAs<SeriesListResponse>().data;

    const mangas = data.data.map((series) => {
      const manga = SManga.create();
      manga.url = `/series/${series.slug}`;
      manga.title = series.title;
      manga.thumbnail_url = series.cover_image ?? undefined;
      manga.status = toStatus(series.status);
      return manga;
    });

    return new MangasPage(mangas, hasNextPage(data));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [new SortFilter(), new StatusFilter(), new TypeFilter(), new MinChaptersFilter(), new GenreFilter()];
  }

  // ==================== MANGA DETAILS ====================

  override mangaDetailsRequest(manga: SManga): Request {
    const compatibleUrl = manga.url.replace("/manga/", "/series/");
    return GET(`${this.apiUrl}${compatibleUrl}`, this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const data = response.parseAs<SeriesDetailResponse>().data;

    const manga = SManga.create();
    manga.url = `/series/${data.slug}`;
    manga.title = data.title;
    manga.author = data.author ?? undefined;
    manga.artist = data.studio ?? undefined;
    manga.thumbnail_url = data.cover_image ?? undefined;
    manga.status = toStatus(data.status);
    manga.genre = (data.genres ?? []).join(", ");
    let description = "";
    if (data.synopsis != null) description += data.synopsis;
    const alternativeTitles = data.alternative_titles ?? [];
    if (alternativeTitles.length > 0) {
      description += "\n\nAlternative Titles:\n";
      description += alternativeTitles.join("\n");
    }
    manga.description = description;
    return manga;
  }

  // ==================== CHAPTER LIST ====================

  protected override chapterListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const data = response.parseAs<SeriesDetailResponse>().data;

    return [...(data.chapters ?? [])]
      .sort((a, b) => b.chapter_number - a.chapter_number)
      .map((chapter) => {
        const c = SChapter.create();
        c.url = `/series/${data.slug}/chapters/${chapter.slug}`;
        c.name = chapter.title;
        const date = chapter.published_at ?? chapter.created_at;
        c.date_upload = (date != null ? DATE_FORMAT.tryParseDateTime(date) : 0) || 0;
        return c;
      });
  }

  // ==================== PAGE LIST ====================

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(`${this.apiUrl}${chapter.url}`, this.headers);
  }

  protected pageListParse(response: Response): Page[] {
    const images = response.parseAs<ChapterDetailResponse>().data.chapter.images ?? [];

    return images.map((img, i) => new Page(i, "", img.image_url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("Not used");
  }
}

// ==================== HELPERS ====================

function toStatus(s: string | null | undefined): number {
  switch (s?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    default:
      return SManga.UNKNOWN;
  }
}
