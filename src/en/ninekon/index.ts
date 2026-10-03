// Port of keiyoushi/extensions-source src/en/ninekon/Ninekon.kt (+ Filters.kt, Dto.kt)
import { DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, isBlank, toHttpUrl } from "../../../sdk/index.ts";

// --- Filters.kt
class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort", ["Date", "Title", "Rate", "Views"], { index: 0, ascending: false });
  }
}

class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

// Sourced from tags API HAR response
const genres: [string, string][] = [
  ["Action", "action"],
  ["Adult", "adult"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Cooking", "cooking"],
  ["Doujinshi", "doujinshi"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Erotica", "erotica"],
  ["Fantasy", "fantasy"],
  ["Gender bender", "gender-bender"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Manhua", "manhua"],
  ["Manhwa", "manhwa"],
  ["Martial Arts", "martial-arts"],
  ["Mature", "mature"],
  ["Mecha", "mecha"],
  ["Medical", "medical"],
  ["Mystery", "mystery"],
  ["One Shot", "one-shot"],
  ["Psychological", "psychological"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shoujo Ai", "shoujo-ai"],
  ["Shounen", "shounen"],
  ["Shounen Ai", "shounen-ai"],
  ["Slice of life", "slice-of-life"],
  ["Smut", "smut"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Tragedy", "tragedy"],
  ["Webtoons", "webtoons"],
  ["Yaoi", "yaoi"],
  ["Yuri", "yuri"],
];

class GenreFilter extends Filter.Group<GenreCheckBox> {
  constructor() {
    super(
      "Genres",
      genres.map((it) => new GenreCheckBox(it[0], it[1])),
    );
  }
}

// --- Dto.kt
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT);

interface BooksResponse {
  pages?: number;
  books?: BookDto[];
}

interface BookDto {
  gid: string;
  title: string;
  cover?: string | null;
  host?: string | null;
}

function bookToSManga(dto: BookDto): SManga {
  const manga = SManga.create();
  manga.url = dto.gid;
  manga.title = dto.title;
  manga.thumbnail_url = dto.host != null && dto.cover != null ? dto.host + dto.cover : undefined;
  return manga;
}

interface ChapterDto {
  gid: string;
  ordinal?: number | null;
}

function chapterToSChapter(dto: ChapterDto, mangaId: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/books/${mangaId}/chapters/${dto.gid}/pages`;
  chapter.name = `Chapter ${dto.ordinal != null ? String(dto.ordinal) : "Unknown"}`;
  chapter.chapter_number = dto.ordinal ?? -1;
  return chapter;
}

interface BookDetailsDto {
  gid: string;
  title: string;
  summary?: string | null;
  author?: string | null;
  tags?: string | null;
  status?: string | null;
  host?: string | null;
  cover?: string | null;
  dt_updated?: string | null;
  chapters?: ChapterDto[];
}

function detailsToSManga(dto: BookDetailsDto): SManga {
  const manga = SManga.create();
  manga.url = dto.gid;
  manga.title = dto.title;
  manga.author = dto.author ?? undefined;
  manga.description = dto.summary ?? undefined;
  manga.genre = dto.tags
    ?.split("|")
    .filter((it) => !isBlank(it))
    .join(", ");
  switch (dto.status) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.thumbnail_url = dto.host != null && dto.cover != null ? dto.host + dto.cover : undefined;
  manga.initialized = true;
  return manga;
}

function detailsChapters(dto: BookDetailsDto): SChapter[] {
  const sChapters = (dto.chapters ?? []).map((it) => chapterToSChapter(it, dto.gid)).reverse();
  if (sChapters.length > 0 && dto.dt_updated) sChapters[0].date_upload = dateFormat.tryParseDateTime(dto.dt_updated);
  return sChapters;
}

export default class Ninekon extends KeiSource {
  private readonly apiUrl = "https://api.ninekon.com/1.0";

  // ============================== Popular ==============================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchBooks(toHttpUrl(`${this.apiUrl}/books?sort=views&page=${page}`).toString(), page);
  }

  private async fetchBooks(url: string, page: number): Promise<MangasPage> {
    const data = (await this.client.get(url)).parseAs<BooksResponse>();
    return new MangasPage((data.books ?? []).map((it) => bookToSManga(it)), page < (data.pages ?? 0));
  }

  // ============================== Latest ===============================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchBooks(toHttpUrl(`${this.apiUrl}/books?sort=dt&order=desc&page=${page}`).toString(), page);
  }

  // ============================== Search ===============================

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/books`).newBuilder().addQueryParameter("page", String(page));

    if (!isBlank(query)) {
      url.addQueryParameter("field", "title");
      url.addQueryParameter("query", query);
    }

    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const selected = firstInstanceOrNull(filters, GenreFilter)
      ?.state.filter((it) => it.state)
      .map((it) => it.value);

    if (selected && selected.length > 0) url.addQueryParameter("tags", selected.join(","));

    if (sortFilter != null) {
      const sorts = ["dt", "title", "rates", "views"];
      const state = sortFilter.state;
      if (state != null) {
        url.addQueryParameter("sort", sorts[state.index]);
        url.addQueryParameter("order", state.ascending ? "asc" : "desc");
      }
    } else {
      url.addQueryParameter("sort", "dt");
      url.addQueryParameter("order", "desc");
    }

    return this.fetchBooks(url.build().toString(), page);
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const data = (await this.client.get(`${this.apiUrl}/books/${manga.url}`)).parseAs<BookDetailsDto>();
    return new SMangaUpdate(detailsToSManga(data), detailsChapters(data));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/book/${manga.url}`;
  }

  // ============================= Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url.replaceAll("/books/", "/book/").replaceAll("/chapters/", "/chapter/");
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const data = (await this.client.get(this.apiUrl + chapter.url)).parseAs<{ host: string; pages?: string[] }>();
    return (data.pages ?? []).map((it) => data.host + it).map((url, index) => new Page(index, "", url));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new GenreFilter());
  }
}
