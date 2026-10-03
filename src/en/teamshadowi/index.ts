// Port of keiyoushi/extensions-source src/en/teamshadowi/TeamShadowi.kt (+ Filters.kt, Dto.kt)
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
  substringAfterLast,
  toHttpUrl,
  tryParseInstant,
  type FilterList as FilterListType,
  type Response,
} from "../../../sdk/index.ts";

// --- Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}
class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["Rating", "rating"],
      ["Latest", "created"],
      ["Views", "views"],
      ["Title", "title"],
    ]);
  }
}
class GenreFilter extends UriPartFilter {
  constructor() {
    super("Genre", [
      ["All", "all"],
      ["Action", "action"],
      ["Adventure", "adventure"],
      ["Comedy", "comedy"],
      ["Drama", "drama"],
      ["Ecchi", "ecchi"],
      ["Fantasy", "fantasy"],
      ["Isekai", "isekai"],
      ["Romance", "romance"],
    ]);
  }
}

// --- Dto.kt
interface SeriesResponse {
  data: Series[];
  hasMore?: boolean;
}
interface SearchResponse {
  series?: Series[];
}
interface Series {
  title: string;
  slug: string;
  thumbnail_url?: string | null;
  status?: string | null;
  description?: string | null;
  genres?: string[] | null;
}
interface PublicDataSeries {
  series: SeriesDetails;
  chapters?: ChapterData[];
}
interface SeriesDetails {
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  status?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
}
interface ChapterData {
  id: string;
  number: number;
  title?: string | null;
  created_at?: string | null;
}
interface PublicDataChapter {
  pages: string[];
}

const parseStatus = (s: string | null | undefined) => (s?.toLowerCase() === "ongoing" ? SManga.ONGOING : s?.toLowerCase() === "completed" ? SManga.COMPLETED : SManga.UNKNOWN);

function seriesToSManga(s: Series): SManga {
  const manga = SManga.create();
  manga.title = s.title;
  manga.url = `/series/${s.slug}`;
  manga.thumbnail_url = s.thumbnail_url ?? undefined;
  manga.status = parseStatus(s.status);
  manga.description = s.description ?? undefined;
  manga.genre = s.genres?.join(", ");
  return manga;
}

const isObj = (e: unknown): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e);

// --- TeamShadowi.kt
export default class TeamShadowi extends KeiSource {
  // Reusable headers for fetching raw JSON React Server Component payloads
  private get rscHeaders() {
    const h = new Headers(this.headers);
    h.append("Rsc", "1");
    return h;
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const offset = (page - 1) * 20;
    const res = await this.client.get(`${this.baseUrl}/api/series/popular?timePeriod=all&genre=all&sortBy=rating&offset=${offset}&limit=20`);
    return this.parseMangasPage(res);
  }

  private parseMangasPage(response: Response): MangasPage {
    const res = response.parseAs<SeriesResponse>();
    const mangas = res.data.map((it) => seriesToSManga(it));
    return new MangasPage(mangas, res.hasMore ?? false);
  }

  // =============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const offset = (page - 1) * 20;
    const res = await this.client.get(`${this.baseUrl}/api/series/popular?timePeriod=all&genre=all&sortBy=created&offset=${offset}&limit=20`);
    return this.parseMangasPage(res);
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    if (query.trim()) {
      const url = toHttpUrl(`${this.baseUrl}/api/search`)!.newBuilder().addQueryParameter("q", query).build();

      const res = (await this.client.get(url.toString())).parseAs<SearchResponse>();
      const mangas = (res.series ?? []).map((it) => seriesToSManga(it));
      return new MangasPage(mangas, false);
    }
    const offset = (page - 1) * 20;

    const b = toHttpUrl(`${this.baseUrl}/api/series/popular`)!.newBuilder();
    b.addQueryParameter("offset", String(offset));
    b.addQueryParameter("limit", "20");
    b.addQueryParameter("timePeriod", "all");

    let genre = "all";
    let sort = "rating";

    for (const filter of filters) {
      if (filter instanceof GenreFilter) genre = filter.toUriPart();
      else if (filter instanceof SortFilter) sort = filter.toUriPart();
    }

    b.addQueryParameter("genre", genre);
    b.addQueryParameter("sortBy", sort);

    return this.parseMangasPage(await this.client.get(b.build().toString()));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || pathSegments[0] !== "series") return null;

    const mangaUrl = `/series/${pathSegments[1]}`;
    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  // =============================== Updates ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const data = extractNextJs<PublicDataSeries>(await this.client.get(this.baseUrl + manga.url, this.rscHeaders), (it) => isObj(it) && isObj(it.series) && "title" in it.series);
    if (data == null) throw new Error("Failed to extract data");

    const seriesData = data.series;
    const newManga = SManga.create();
    newManga.title = seriesData.title;
    newManga.description = seriesData.description ?? undefined;
    newManga.thumbnail_url = seriesData.thumbnail_url ?? undefined;
    newManga.status = parseStatus(seriesData.status);
    newManga.genre = [...new Set([...(seriesData.genres ?? []), ...(seriesData.tags ?? [])])].join(", ");

    const chaptersData = data.chapters ?? [];
    const slug = substringAfterLast(manga.url, "/");
    const chapters = chaptersData
      .map((chap) => {
        const numStr = String(chap.number);
        const c = SChapter.create();
        c.url = `/read/${slug}/${numStr}`;
        c.name = !chap.title || !chap.title.trim() ? `Chapter ${numStr}` : `Chapter ${numStr}: ${chap.title}`;
        c.date_upload = tryParseInstant(chap.created_at);
        c.chapter_number = chap.number;
        return c;
      })
      .sort((a, b) => b.chapter_number - a.chapter_number);

    return new SMangaUpdate(newManga, chapters);
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const data = extractNextJs<PublicDataChapter>(await this.client.get(this.baseUrl + chapter.url, this.rscHeaders), (it) => isObj(it) && Array.isArray(it.pages))?.pages;
    if (data == null) return [];

    return data.map((url, i) => new Page(i, "", url));
  }

  // ============================== Filters ===============================

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new SortFilter(), new GenreFilter());
  }
}
