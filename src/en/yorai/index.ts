// Port of keiyoushi/extensions-source src/en/yorai/Yorai.kt (+ Filters.kt, Dto.kt)
import {
  Filter,
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  extractNextJs,
  extractNextJsRsc,
  hasKeys,
  toHttpUrl,
  type FilterList as FilterListType,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// --- Dto.kt
interface Browse {
  comics: Comic[];
  page: number;
  totalPages: number;
}
interface Comic {
  slug: string;
  title: string;
  coverUrl: string;
}
interface Description {
  name: string;
  content: string;
}
interface Tag {
  name: string;
  slug: string;
}
interface Chapters {
  slug: string;
  chapters: { number: number; title: string; source_name: string }[];
  defaultSource: string;
}
interface ChapterPages {
  imageUrls: string[];
}

// --- Filters.kt
const getStatusList = ["All Status", "Ongoing", "Completed", "Hiatus"];
const getGenres = [
  "Action", "Adventure", "Fantasy", "Comedy", "Historical", "Martial Arts", "Seinen", "Shounen", "Supernatural", "Drama", "Harem",
  "School Life", "Mature", "Horror", "Psychological", "Romance", "Mystery", "Thriller", "Tragedy", "Award Winning", "Sci Fi", "Josei",
  "Ecchi", "Slice Of Life", "Sports", "Suspense", "Gourmet",
];
const getTypeList = ["All Types", "Manga", "Manhwa", "Manhua", "Webtoon"];
const getSortsList: [string, string][] = [
  ["Most Viewed", "views"],
  ["Recently Updated", "new"],
  ["Top Rated", "rating"],
  ["Alphabetical", "title"],
];

class StatusFilter extends Filter.Select<string> {
  constructor(name: string, readonly vals: string[], state = 0) {
    super(name, vals, state);
  }
  get selected() {
    return this.vals[this.state].replace("All Status", "");
  }
}
class TypeFilter extends Filter.Select<string> {
  constructor(name: string, readonly vals: string[], state = 0) {
    super(name, vals, state);
  }
  get selected() {
    return this.vals[this.state].replace("All Types", "");
  }
}
class CheckBoxFilter extends Filter.CheckBox {}
class GenreFilter extends Filter.Group<CheckBoxFilter> {
  constructor(name: string, genreList: string[]) {
    super(name, genreList.map((it) => new CheckBoxFilter(it)));
  }
}
class SortFilter extends Filter.Sort {
  constructor(name: string, state: { index: number; ascending: boolean }, private readonly vals: [string, string][]) {
    super(name, vals.map((it) => it[0]), state);
  }
  get selected() {
    return this.vals[this.state!.index][1];
  }
}

const getFilters = (): FilterListType =>
  FilterList(new SortFilter("Sort by", { index: 0, ascending: false }, getSortsList), new StatusFilter("Status", getStatusList), new TypeFilter("Types", getTypeList), new GenreFilter("Genre", getGenres));

// --- Yorai.kt
export default class Yorai extends HttpSource {
  get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  private get rscHeaders() {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  // Popular
  protected popularMangaRequest(page: number): Request {
    return GET(`${this.apiUrl}/comics/browse?page=${page}&sort=views`, this.headers);
  }

  // Latest
  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.apiUrl}/comics/browse?page=${page}`, this.headers);
  }

  // Search
  override getFilterList(_data: unknown = null): FilterListType {
    return getFilters();
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterListType): Request {
    const b = toHttpUrl(`${this.apiUrl}/comics/browse`)!.newBuilder();
    const genres: string[] = [];
    for (const filter of filters) {
      if (filter instanceof SortFilter) {
        b.addQueryParameter("sort", filter.selected);
        b.addQueryParameter("order", filter.state!.ascending ? "asc" : "desc");
      } else if (filter instanceof GenreFilter) {
        for (const it of filter.state.filter((s) => s.state)) genres.push(it.name.toLowerCase().replaceAll(" ", "_"));
      } else if (filter instanceof StatusFilter) {
        b.addQueryParameter("statuses", filter.selected);
      } else if (filter instanceof TypeFilter) {
        b.addQueryParameter("types", filter.selected);
      }
    }
    b.addQueryParameter("page", String(page));
    b.addQueryParameter("genres", genres.join(","));
    b.addQueryParameter("q", query);
    return GET(b.build(), this.headers);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comic/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const [slug, number] = chapter.url.split("|");
    return `${this.baseUrl}/comic/${slug}/chapter/${number}`;
  }

  protected searchMangaParse(response: Response): MangasPage {
    const data = response.parseAs<Browse>();
    const hasNextPage = data.page <= data.totalPages;
    return new MangasPage(
      data.comics.map((it) => {
        const m = SManga.create();
        m.url = it.slug;
        m.title = it.title;
        m.thumbnail_url = this.baseUrl + it.coverUrl;
        return m;
      }),
      hasNextPage,
    );
  }
  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }
  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(this.getMangaUrl(manga), this.rscHeaders);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const detailsBody = response.text();

    const desc = extractNextJsRsc<Description>(detailsBody, (it) => typeof it === "object" && it !== null && !Array.isArray(it) && (it as Record<string, unknown>)["name"] === "description");

    // List<Tag>: the first non-empty array of {name, slug} objects
    const tags = (extractNextJsRsc<Tag[]>(detailsBody, (it) => Array.isArray(it) && it.length > 0 && it.every(hasKeys("name", "slug"))) ?? []).map((t) => t.name);

    const manga = SManga.create();
    manga.status = detailsBody.includes("releasing") ? SManga.ONGOING : SManga.COMPLETED;
    manga.genre = tags.map((it) => `⟡${it}`).join(", ");
    manga.description = desc?.content;
    return manga;
  }

  // Chapters
  protected override chapterListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const chapters = extractNextJs<Chapters>(response, hasKeys("slug", "chapters", "defaultSource"))!;
    return chapters.chapters
      .filter((it) => it.source_name === chapters.defaultSource)
      .map((it) => {
        const c = SChapter.create();
        c.url = `${chapters.slug}|${it.number}`;
        c.name = it.title ? it.title : `Chapter ${Math.trunc(it.number)}`;
        c.chapter_number = it.number;
        c.scanlator = chapters.defaultSource;
        return c;
      });
  }

  // Pages
  protected override pageListRequest(chapter: SChapter): Request {
    return GET(this.getChapterUrl(chapter), this.rscHeaders);
  }

  protected pageListParse(response: Response): Page[] {
    const data = extractNextJs<ChapterPages>(response, hasKeys("imageUrls"));
    return data!.imageUrls.map((url, index) => new Page(index, "", this.baseUrl + url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
