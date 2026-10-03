// Port of keiyoushi/extensions-source src/en/scansgg/ScansGG.kt (+ Dto.kt, Filters.kt)
import { DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneId, firstInstanceOrNull, toHttpUrl } from "../../../sdk/index.ts";
import type { Response } from "../../../sdk/index.ts";

// Filters.kt
const types: [string, number][] = [
  ["Comic", 1],
  ["Manga", 2],
  ["Manhwa", 3],
  ["Manhua", 4],
  ["Webtoon", 5],
];
const statuses: [string, number][] = [
  ["Ongoing", 1],
  ["Completed", 2],
  ["Hiatus", 3],
  ["Cancelled", 4],
  ["Dropped", 5],
];
const tagsMap = new Map<number, string>([
  [49, "Regression"], [48, "Male Protagonist"], [47, "Survival"],
  [46, "Avant Garde"], [45, "Award Winning"], [44, "Lolicon"],
  [43, "Mahou Shoujo"], [42, "Doujinshi"], [41, "Girls Love"],
  [40, "Hentai"], [39, "Mecha"], [38, "Shotacon"], [37, "Ecchi"],
  [36, "Music"], [35, "Smut"], [34, "Erotica"], [33, "Adult"],
  [32, "Gourmet"], [31, "Yuri"], [30, "Shoujo Ai"], [29, "Yaoi"],
  [28, "Shounen Ai"], [27, "Boys Love"], [26, "Harem"], [25, "Tragedy"],
  [24, "Gender Bender"], [23, "Suspense"], [22, "Psychological"],
  [21, "Mature"], [20, "Horror"], [19, "Mystery"], [18, "Martial Arts"],
  [17, "Sci-fi"], [16, "Adventure"], [15, "Supernatural"], [14, "Sports"],
  [13, "Shounen"], [12, "Historical"], [11, "Seinen"], [10, "Action"],
  [9, "Josei"], [8, "Thriller"], [7, "School Life"], [6, "Slice Of Life"],
  [5, "Drama"], [4, "Comedy"], [3, "Shoujo"], [2, "Romance"], [1, "Fantasy"],
]);

class TypeCheckBox extends Filter.CheckBox {
  constructor(name: string, readonly id: number) {
    super(name);
  }
}
class TypeFilter extends Filter.Group<TypeCheckBox> {
  constructor() {
    super("Type", types.map(([n, id]) => new TypeCheckBox(n, id)));
  }
}
class StatusCheckBox extends Filter.CheckBox {
  constructor(name: string, readonly id: number) {
    super(name);
  }
}
class StatusFilter extends Filter.Group<StatusCheckBox> {
  constructor() {
    super("Status", statuses.map(([n, id]) => new StatusCheckBox(n, id)));
  }
}
class TagCheckBox extends Filter.CheckBox {
  constructor(name: string, readonly id: number) {
    super(name);
  }
}
class TagFilter extends Filter.Group<TagCheckBox> {
  constructor() {
    super("Tags", [...tagsMap].map(([id, name]) => new TagCheckBox(name, id)));
  }
}

// Dto.kt
interface ResponseDto<T> {
  data: T;
  meta?: { has_more?: boolean } | null;
}
interface SeriesDto {
  id: number;
  title: string;
  summary?: string | null;
  cover?: string | null;
  author?: string[] | null;
  artist?: string[] | null;
  tags?: number[] | null;
  status?: number | null;
}
interface ChapterDto {
  id: number;
  number: number;
  title?: string | null;
  created_at?: string | null;
  group_id?: number | null;
  group?: { title?: string | null } | null;
}
interface PageListDto {
  chapter?: { id?: number | null; pages?: { position: number; path: string }[] | null } | null;
}

function seriesToSManga(s: SeriesDto, cdnUrl: string, tags: Map<number, string> | null = null): SManga {
  const manga = SManga.create();
  manga.url = String(s.id);
  manga.title = s.title;
  manga.thumbnail_url = s.cover ? `${cdnUrl}/covers/${s.cover}` : undefined;
  if (tags) {
    manga.description = s.summary ?? undefined;
    manga.author = s.author?.join(", ");
    manga.artist = s.artist?.join(", ");
    manga.genre = s.tags
      ?.map((it) => tags.get(it))
      .filter((it): it is string => it !== undefined)
      .join(", ");
    switch (s.status) {
      case 1:
        manga.status = SManga.ONGOING;
        break;
      case 2:
        manga.status = SManga.COMPLETED;
        break;
      case 3:
      case 4:
      case 5:
        manga.status = SManga.CANCELLED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
  }
  return manga;
}

function chapterToSChapter(c: ChapterDto, seriesIdStr: string, dateFormat: DateTimeFormatter): SChapter {
  const chapter = SChapter.create();
  // SChapter.url is used as a full API path to avoid passing multiple fields later
  chapter.url = `/chapter-navigation?series_id=${seriesIdStr}&chapter_id=${c.id}&group_id=${c.group_id ?? 0}`;
  let name = `Chapter ${String(c.number).replace(/\.0$/, "")}`;
  if (c.title) name += ` - ${c.title}`;
  chapter.name = name;
  chapter.date_upload = dateFormat.tryParseDateTime(c.created_at);
  chapter.scanlator = c.group?.title ?? undefined;
  return chapter;
}

function toPages(dto: PageListDto, cdnUrl: string): Page[] {
  const chapterId = dto.chapter?.id;
  if (chapterId == null) return [];
  return dto.chapter?.pages?.map((it) => new Page(it.position, "", `${cdnUrl}/pages/${chapterId}/${it.path}`)) ?? [];
}

const POPULAR_LIMIT = 21;
const LATEST_LIMIT = 14;
const CHAPTER_LIMIT = 100;

export default class ScansGG extends KeiSource {
  override get supportsLatest() {
    return true;
  }

  private readonly apiUrl = "https://api.scans.gg";
  private readonly cdnUrl = "https://cdn.scans.gg/uploads";

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT).withZone(ZoneId.of("UTC"));

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/series`)
      .newBuilder()
      .addQueryParameter("limit", String(POPULAR_LIMIT))
      .addQueryParameter("offset", String((page - 1) * POPULAR_LIMIT))
      .build();
    const response = await this.client.get(url.toString());
    return this.popularMangaParse(response);
  }

  private popularMangaParse(response: Response): MangasPage {
    const dto = response.parseAs<ResponseDto<SeriesDto[]>>();
    const mangas = dto.data.map((it) => seriesToSManga(it, this.cdnUrl));

    // The /series endpoint doesn't return the meta pagination object,
    // so we check if the returned items match our limit
    return new MangasPage(mangas, mangas.length === POPULAR_LIMIT);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/chapters`)
      .newBuilder()
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", String(LATEST_LIMIT))
      .addQueryParameter("chapters", "true")
      .addQueryParameter("series_details", "true")
      .addQueryParameter("group_details", "true")
      .addQueryParameter("sort", "date")
      .build();
    const response = await this.client.get(url.toString());
    return this.latestUpdatesParse(response);
  }

  private latestUpdatesParse(response: Response): MangasPage {
    const dto = response.parseAs<ResponseDto<SeriesDto[]>>();
    const mangas = dto.data.map((it) => seriesToSManga(it, this.cdnUrl));
    return new MangasPage(mangas, dto.meta?.has_more === true);
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.apiUrl}/series`).newBuilder();
    builder.addQueryParameter("limit", String(POPULAR_LIMIT));
    builder.addQueryParameter("offset", String((page - 1) * POPULAR_LIMIT));
    if (query.length > 0) builder.addQueryParameter("q", query);

    const ids = <T extends Filter.CheckBox & { id: number }>(f: Filter.Group<T> | null) => f?.state.filter((it) => it.state).map((it) => it.id) ?? [];
    const types = ids(firstInstanceOrNull(filters, TypeFilter));
    const statuses = ids(firstInstanceOrNull(filters, StatusFilter));
    const tags = ids(firstInstanceOrNull(filters, TagFilter));

    builder.addQueryParameter("q_type", `[${types.join(",")}]`);
    builder.addQueryParameter("q_status", `[${statuses.join(",")}]`);
    builder.addQueryParameter("q_tags", `[${tags.join(",")}]`);
    const response = await this.client.get(builder.build().toString());
    return this.popularMangaParse(response);
  }

  // ============================== Details + Chapters ===================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(m, c);
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const url = toHttpUrl(`${this.apiUrl}/series`).newBuilder().addQueryParameter("id", manga.url).addQueryParameter("trackers", "true").addQueryParameter("sources", "true").build();

    const dto = (await this.client.get(url.toString())).parseAs<ResponseDto<SeriesDto>>();
    return seriesToSManga(dto.data, this.cdnUrl, tagsMap);
  }

  override getChapterUrl(chapter: SChapter): string {
    // Parse the series_id that we constructed in Dto.kt to safely open the correct webview
    const url = toHttpUrl(this.apiUrl + chapter.url);
    const seriesId = url.queryParameter("series_id");
    if (seriesId == null) return this.baseUrl;
    return `${this.baseUrl}/series/${seriesId}`;
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = toHttpUrl(`${this.apiUrl}/chapters`)
        .newBuilder()
        .addQueryParameter("series_id", manga.url)
        .addQueryParameter("limit", String(CHAPTER_LIMIT))
        .addQueryParameter("page", String(page))
        .addQueryParameter("group_details", "true")
        .build();

      const dto = (await this.client.get(url.toString())).parseAs<ResponseDto<ChapterDto[]>>();

      chapters.push(...dto.data.map((it) => chapterToSChapter(it, manga.url, this.dateFormat)));
      hasMore = dto.meta?.has_more === true;
      page++;
    }
    return chapters;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.apiUrl + chapter.url);
    const dto = response.parseAs<ResponseDto<PageListDto>>();
    return toPages(dto.data, this.cdnUrl);
  }

  // ============================== Filters ==============================

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new TypeFilter(), new StatusFilter(), new TagFilter());
  }
}
