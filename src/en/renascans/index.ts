// Port of keiyoushi/extensions-source src/en/renascans/Renascans.kt (Iken theme upstream)
// Not upstream: in 2026-10 the site left Iken (api.renascans.net no longer resolves) for its own Next.js site with a
// JSON API at /api/v1 (manga list, manga with its chapters, chapter with its signed image paths).
import { Filter, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, parseHtml, substringAfterLast, substringBeforeLast, toHttpUrl, type FilterList } from "../../../sdk/index.ts";

const PER_PAGE = 20;

type MangaDto = {
  id: number;
  title: string;
  slug: string;
  cover?: string | null;
  status?: string | null;
  type?: string | null;
  genres?: string[] | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  chapters?: ChapterDto[] | null;
};
type ChapterDto = { id: number; title?: string | null; chapter_number: number; is_locked?: boolean; coins?: number; created_at?: string | null };
type ChapterContentDto = { content?: string[] | null };

class SortFilter extends Filter.Select<string> {
  static readonly values = [
    ["Latest", "latest"],
    ["Popular", "popular"],
  ];
  constructor(state = 0) {
    super("Sort", SortFilter.values.map((it) => it[0]), state);
  }
  get value() {
    return SortFilter.values[this.state][1];
  }
}

const parseStatus = (s: string | null | undefined) => {
  switch (s?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    case "dropped":
    case "cancelled":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
};

const tryParseInstant = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export default class Renascans extends KeiSource {
  private toSManga(dto: MangaDto): SManga {
    const manga = SManga.create();
    manga.url = `${dto.slug}#${dto.id}`;
    manga.title = dto.title;
    manga.thumbnail_url = dto.cover ?? undefined;
    manga.status = parseStatus(dto.status);
    manga.genre = [dto.type, ...(dto.genres ?? [])].filter((it) => it).join(", ");
    if (dto.description != null) manga.description = parseHtml(this.host.load, dto.description, this.baseUrl).text();
    if (dto.author) manga.author = dto.author;
    if (dto.artist) manga.artist = dto.artist;
    return manga;
  }

  private async mangaList(page: number, sort: string, query = ""): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/v1/manga`).newBuilder().addQueryParameter("limit", String(PER_PAGE)).addQueryParameter("offset", String((page - 1) * PER_PAGE));
    if (sort !== "latest") url.addQueryParameter("sort", sort);
    if (query.trim()) url.addQueryParameter("q", query.trim());
    const list = (await this.client.get(url.build().toString())).parseAs<MangaDto[]>();
    return new MangasPage(
      list.map((it) => this.toSManga(it)),
      list.length === PER_PAGE,
    );
  }

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.mangaList(page, "popular");
  }

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.mangaList(page, "latest");
  }

  override getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.mangaList(page, firstInstanceOrNull(filters, SortFilter)?.value ?? "latest", query);
  }

  override getFilterList(): FilterList {
    return [new SortFilter()];
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringBeforeLast(manga.url, "#");
    const dto = (await this.client.get(`${this.baseUrl}/api/v1/manga/${encodeURIComponent(slug)}`)).parseAs<MangaDto>();
    const chapterList = (dto.chapters ?? [])
      .map((c) => {
        const chapter = SChapter.create();
        chapter.url = `/manga/${dto.slug}/chapter-${c.chapter_number}#${c.id}`;
        chapter.name = `${c.is_locked ? "🔒 " : ""}${c.title?.trim() || `Chapter ${c.chapter_number}`}`;
        chapter.chapter_number = c.chapter_number;
        chapter.date_upload = tryParseInstant(c.created_at);
        return chapter;
      })
      .sort((a, b) => b.chapter_number - a.chapter_number);
    return new SMangaUpdate(fetchDetails ? this.toSManga(dto) : manga, fetchChapters ? chapterList : chapters);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${substringBeforeLast(manga.url, "#")}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + substringBeforeLast(chapter.url, "#");
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const id = substringAfterLast(chapter.url, "#");
    const dto = (await this.client.get(`${this.baseUrl}/api/v1/chapters/${id}`)).parseAs<ChapterContentDto>();
    // locked (coin) chapters come without content; paths are relative to /uploads/ as in the site's formatCover
    return (dto.content ?? []).map((path, i) => new Page(i, "", /^https?:/.test(path) ? path : `${this.baseUrl}/uploads/${path.replace(/^\//, "")}`));
  }
}
