// Port of keiyoushi/extensions-source src/en/luminaretranslations/LuminareTranslations.kt (+ Filters.kt, Dto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  toHttpUrl,
  type FilterList as FilterListType,
} from "../../../sdk/index.ts";

// --- Dto.kt
interface EntryResponse {
  data: EntryData[];
  meta: { total: number };
}
interface EntryData {
  title: string;
  slug: string;
  type: string | null;
  cover_image: string | null;
}
function entryToSManga(e: EntryData): SManga {
  const manga = SManga.create();
  manga.url = e.slug;
  manga.title = e.title;
  manga.thumbnail_url = e.cover_image ?? undefined;
  return manga;
}

interface InfoRow {
  label: string;
  value: string;
}

interface ChapterData {
  id: number;
  number: number;
  title: string | null;
  subtitle: string | null;
  published_at: string | null;
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss[XXX][XX]", Locale.ROOT);

function chapterToSChapter(c: ChapterData, entrySlug: string): SChapter {
  const chapterNum = c.number % 1 === 0 ? Math.trunc(c.number) : c.number;
  const chapter = SChapter.create();
  chapter.url = String(c.id);
  chapter.memo = { seriesSlug: entrySlug };
  chapter.name = (c.title && c.title.trim() ? c.title : `Chapter ${chapterNum}`) + (c.subtitle && c.subtitle.trim() ? ` - ${c.subtitle}` : "");
  chapter.chapter_number = c.number;
  chapter.date_upload = dateFormat.tryParseZonedDateTime(c.published_at);
  return chapter;
}

interface FilterResponse {
  genres: Filters[];
  tags: Filters[];
  authors: Filters[];
  artists: Filters[];
  statuses: Filters[];
  sorts: Filters[];
}
// @JsonNames("label") name / @JsonNames("value") slug: the API sends label/value, our cached data is name/slug
interface Filters {
  name: string;
  slug: string;
}
const normalize = (list: { name?: string; label?: string; slug?: string; value?: string }[]): Filters[] => list.map((it) => ({ name: (it.name ?? it.label)!, slug: (it.slug ?? it.value)! }));

// --- Filters.kt
class CheckBoxItem extends Filter.CheckBox {
  constructor(name: string, readonly slug: string) {
    super(name);
  }
}

abstract class SlugGroupFilter extends Filter.Group<CheckBoxItem> {
  constructor(name: string, entries: Filters[]) {
    super(name, entries.map((it) => new CheckBoxItem(it.name, it.slug)));
  }
}
class GenreFilter extends SlugGroupFilter {
  constructor(genres: Filters[]) {
    super("Genres", genres);
  }
}
class TagFilter extends SlugGroupFilter {
  constructor(tags: Filters[]) {
    super("Tags", tags);
  }
}

abstract class SlugSelectFilter extends Filter.Select<string> {
  private readonly slugs: string[];
  constructor(name: string, entries: Filters[]) {
    super(name, ["Any", ...entries.map((it) => it.name)]);
    this.slugs = ["", ...entries.map((it) => it.slug)];
  }
  get selected() {
    return this.slugs[this.state];
  }
}
class AuthorFilter extends SlugSelectFilter {
  constructor(authors: Filters[]) {
    super("Author", authors);
  }
}
class ArtistFilter extends SlugSelectFilter {
  constructor(artists: Filters[]) {
    super("Artist", artists);
  }
}

abstract class TypeStatusSortFilter extends Filter.Select<string> {
  private readonly options: string[];
  constructor(name: string, entries: Filters[], withAny = false) {
    super(name, [...(withAny ? ["Any"] : []), ...entries.map((it) => it.name)]);
    this.options = [...(withAny ? [""] : []), ...entries.map((it) => it.slug)];
  }
  get selected() {
    return this.options[this.state];
  }
}
class SortFilter extends TypeStatusSortFilter {
  constructor(sorts: Filters[]) {
    super("Sort", sorts);
  }
}
class StatusFilter extends TypeStatusSortFilter {
  constructor(statuses: Filters[]) {
    super("Status", statuses, true);
  }
}

const EXCLUDED_TYPES = new Set(["novel", "light_novel", "web_novel"]);

// --- LuminareTranslations.kt
export default class LuminareTranslations extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/wp-json/yarnovel/v1`;
  }
  private readonly pageSize = 24;

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter([{ name: "Popular", slug: "popular" }])));
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter([{ name: "Latest", slug: "latest" }])));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/series`)!
      .newBuilder()
      .addQueryParameter("page", String(page))
      .addQueryParameter("per_page", String(this.pageSize))
      .addQueryParameter("type", "manga");

    if (query.trim()) url.addQueryParameter("search", query);

    const sort = firstInstanceOrNull(filters, SortFilter)?.selected;
    if (sort != null) url.addQueryParameter("sort", sort);

    const genres = firstInstanceOrNull(filters, GenreFilter)?.state.filter((it) => it.state).map((it) => it.slug).join(",");
    if (genres) url.addQueryParameter("genres", genres);

    const tags = firstInstanceOrNull(filters, TagFilter)?.state.filter((it) => it.state).map((it) => it.slug).join(",");
    if (tags) url.addQueryParameter("tags", tags);

    const author = firstInstanceOrNull(filters, AuthorFilter)?.selected;
    if (author) url.addQueryParameter("author", author);

    const artist = firstInstanceOrNull(filters, ArtistFilter)?.selected;
    if (artist) url.addQueryParameter("artist", artist);

    const status = firstInstanceOrNull(filters, StatusFilter)?.selected;
    if (status) url.addQueryParameter("status", status);

    const result = (await this.client.get(url.build().toString())).parseAs<EntryResponse>();
    const mangas = result.data.filter((it) => !(it.type != null && EXCLUDED_TYPES.has(it.type))).map((it) => entryToSManga(it));
    const hasNextPage = page * this.pageSize < result.meta.total;
    return new MangasPage(mangas, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    // The series and chapters API endpoints fail with a server-side PHP memory error, so parse the series page
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const xData = document.selectFirst("section[x-data*=chapters:]")!.attr("x-data").split(/\r\n|\r|\n/).map((it) => it.trim());
    const xDataArray = (key: string) => {
      const line = xData.find((it) => it.startsWith(`${key}:`));
      if (line === undefined) throw new Error("NoSuchElementException: Collection contains no element matching the predicate.");
      let v = line.slice(`${key}:`.length).trim();
      if (v.endsWith(",")) v = v.slice(0, -1);
      return v;
    };

    const info = new Map((JSON.parse(xDataArray("infoRows")) as InfoRow[]).map((it) => [it.label, it.value]));

    const updatedManga = manga;
    updatedManga.title = document.selectFirst("h1")!.text();
    updatedManga.thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content");
    updatedManga.description = document.selectFirst("#series-description")?.wholeText().trim();
    updatedManga.author = info.get("Author");
    updatedManga.artist = info.get("Artist");
    updatedManga.genre = info.get("Genre");
    switch (info.get("Status")?.toLowerCase()) {
      case "ongoing":
        updatedManga.status = SManga.ONGOING;
        break;
      case "completed":
        updatedManga.status = SManga.COMPLETED;
        break;
      case "hiatus":
        updatedManga.status = SManga.ON_HIATUS;
        break;
      case "dropped":
        updatedManga.status = SManga.CANCELLED;
        break;
      default:
        updatedManga.status = SManga.UNKNOWN;
    }

    const chapterList = (JSON.parse(xDataArray("chapters")) as ChapterData[]).map((it) => chapterToSChapter(it, manga.url)).sort((a, b) => b.chapter_number - a.chapter_number);

    return new SMangaUpdate(updatedManga, chapterList);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/series/${chapter.memo["seriesSlug"] as string}/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const images = (await this.client.get(this.getChapterUrl(chapter))).asJsoup().select("img.reader-page[data-src]");
    const server = images[0]?.attr("data-server-id");
    return images.filter((it) => it.attr("data-server-id") === server).map((img, i) => new Page(i, "", img.absUrl("data-src")));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const r = (await this.client.get(`${this.apiUrl}/explore/filters`)).parseAs<Record<keyof FilterResponse, { name?: string; label?: string; slug?: string; value?: string }[]>>();
    const out: FilterResponse = {
      genres: normalize(r.genres),
      tags: normalize(r.tags),
      authors: normalize(r.authors),
      artists: normalize(r.artists),
      statuses: normalize(r.statuses),
      sorts: normalize(r.sorts),
    };
    return out;
  }

  override getFilterList(data: unknown = null): FilterListType {
    if (data == null) return FilterList();
    const filterData = data as FilterResponse;
    return FilterList(
      new Filter.Header("Note: Search and active filters are applied together"),
      new SortFilter(filterData.sorts),
      new StatusFilter(filterData.statuses),
      new Filter.Separator(),
      new GenreFilter(filterData.genres),
      new TagFilter(filterData.tags),
      new AuthorFilter(filterData.authors),
      new ArtistFilter(filterData.artists),
    );
  }
}
