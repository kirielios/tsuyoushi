// Port of keiyoushi/extensions-source src/en/hyakuro/Hyakuro.kt (+ Dto.kt)
import { DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, isBlank, substringAfter, toHttpUrl, tryParseInstant } from "../../../sdk/index.ts";

// Dto.kt
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);

interface ChapterInListDto {
  id: number;
  Chapter: number;
  Title: string | null;
  TranslatedOn: string | null;
  Pages: { data: { attributes: { url: string } }[] } | null;
}
interface MangaAttributes {
  Title: string;
  slug: string;
  Synopsis: string | null;
  Artist: string | null;
  Author: string | null;
  Status: string | null;
  Cover: { data: { attributes: { url: string } } } | null;
  Chapters: ChapterInListDto[] | null;
  Categories: string[] | null;
  Longstrip: boolean | null;
  Oneshot: boolean | null;
  publishedAt: string | null;
}
interface PaginatedResponse {
  data: { attributes: MangaAttributes }[];
  meta: { pagination: { page: number; pageCount: number } };
}

function mangaToSManga(a: MangaAttributes, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = a.Title;
  manga.url = `/manga/${a.slug}`;
  const coverUrl = a.Cover?.data?.attributes?.url;
  manga.thumbnail_url = coverUrl != null ? `${baseUrl}/backend${coverUrl}` : undefined;
  manga.author = a.Author ?? undefined;
  manga.artist = a.Artist ?? undefined;
  switch (a.Status) {
    case "Ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "Completed":
      manga.status = SManga.COMPLETED;
      break;
    case "Dropped":
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.description = a.Synopsis ?? undefined;
  manga.genre = a.Categories
    ? [...a.Categories, ...(a.Longstrip === true ? ["Longstrip"] : []), ...(a.Oneshot === true ? ["Oneshot"] : [])].join(", ")
    : undefined;
  return manga;
}

// Kotlin's Float.toString(): whole numbers keep ".0"
const floatToString = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function chapterToSChapter(c: ChapterInListDto, mangaSlug: string, parent: MangaAttributes): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${mangaSlug}#${floatToString(c.Chapter)}#${c.id}`;
  const chapterStr = c.Chapter % 1 === 0 ? String(Math.trunc(c.Chapter)) : String(c.Chapter);
  const title = c.Title;
  if (title == null && parent.Oneshot === true) chapter.name = "Oneshot";
  else if (title == null && parent.Oneshot === false) chapter.name = `Chapter ${chapterStr}`;
  else if (title != null && parent.Oneshot === true) chapter.name = `Oneshot - ${title}`;
  else if (title != null && parent.Oneshot === false) chapter.name = `Chapter ${chapterStr} - ${title}`;
  else chapter.name = `Chapter ${chapterStr}`;
  const date = c.TranslatedOn ?? parent.publishedAt;
  chapter.date_upload = date?.includes("T") === true ? tryParseInstant(date) : dateFormat.tryParseDate(date);
  chapter.chapter_number = c.Chapter;
  return chapter;
}

// Filters
class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["All", "Ongoing", "Completed", "Dropped", "Oneshot"]);
  }
}
class Category extends Filter.CheckBox {}
class CategoryFilter extends Filter.Group<Category> {
  constructor(categories: Category[]) {
    super("Categories", categories);
  }
}

export default class Hyakuro extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/backend/api`;
  }

  // Popular/A-Z
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/mangas`)
      .newBuilder()
      .addQueryParameter("populate", "Cover,Chapters")
      .addQueryParameter("sort", "Title:asc")
      .addQueryParameter("pagination[page]", String(page))
      .build();
    return this.parseMangaList((await this.client.get(url.toString())).parseAs<PaginatedResponse>());
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/mangas`)
      .newBuilder()
      .addQueryParameter("populate", "Cover,Chapters")
      .addQueryParameter("sort", "updatedAt:desc")
      .addQueryParameter("pagination[page]", String(page))
      .build();
    return this.parseMangaList((await this.client.get(url.toString())).parseAs<PaginatedResponse>());
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.apiUrl}/mangas`).newBuilder();
    builder.addQueryParameter("pagination[page]", String(page));
    builder.addQueryParameter("populate", "Cover,Chapters");
    builder.addQueryParameter("sort", "updatedAt:desc");

    if (!isBlank(query)) builder.addQueryParameter("filters[Title][$containsi]", query);

    for (const filter of filters) {
      if (filter instanceof StatusFilter) {
        if (filter.state !== 0) {
          const status = filter.values[filter.state];
          if (status === "Oneshot") builder.addQueryParameter("filters[Oneshot][$eq]", "true");
          else builder.addQueryParameter("filters[Status][$eq]", status);
        }
      } else if (filter instanceof CategoryFilter) {
        filter.state
          .filter((it) => it.state)
          .forEach((checkbox, index) => builder.addQueryParameter(`filters[$and][${index + 1}][Categories][$containsi]`, checkbox.name));
      }
    }
    return this.parseMangaList((await this.client.get(builder.build().toString())).parseAs<PaginatedResponse>());
  }

  private parseMangaList(result: PaginatedResponse): MangasPage {
    const mangas = result.data.map((it) => mangaToSManga(it.attributes, this.baseUrl));
    const hasNextPage = result.meta.pagination.page < result.meta.pagination.pageCount;
    return new MangasPage(mangas, hasNextPage);
  }

  // Details and chapters come from the same response
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringAfter(manga.url, "/manga/");
    const url = toHttpUrl(`${this.apiUrl}/mangas`).newBuilder().addQueryParameter("filters[slug][$eq]", slug).addQueryParameter("populate", "Cover,Chapters").build();
    const attributes = (await this.client.get(url.toString())).parseAs<PaginatedResponse>().data[0].attributes;
    return new SMangaUpdate(
      mangaToSManga(attributes, this.baseUrl),
      // Array.sort is stable, like sortedByDescending
      [...attributes.Chapters!].sort((a, b) => b.Chapter - a.Chapter).map((it) => chapterToSChapter(it, slug, attributes)),
    );
  }

  override getChapterUrl(chapter: SChapter): string {
    const parts = chapter.url.split("#");
    return `${this.baseUrl}/manga/${parts[0]}/read/${parts[1]}/1`;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const parts = chapter.url.split("#");
    const slug = parts[0];
    const chapterId = Number.parseInt(parts[2], 10);
    const url = toHttpUrl(`${this.apiUrl}/mangas`).newBuilder().addQueryParameter("filters[slug][$eq]", slug).addQueryParameter("populate[Chapters][populate]", "*").build();
    const attributes = (await this.client.get(url.toString())).parseAs<PaginatedResponse>().data[0].attributes;
    const chapterData = attributes.Chapters!.find((it) => it.id === chapterId)!;

    return [...chapterData.Pages!.data]
      .sort((a, b) => (a.attributes.url < b.attributes.url ? -1 : a.attributes.url > b.attributes.url ? 1 : 0))
      .map((pageData, index) => new Page(index, "", `${this.baseUrl}/backend${pageData.attributes.url}`));
  }

  // Filters
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("NOTE: Search query will be applied to filters"), new StatusFilter(), new CategoryFilter(this.getCategoryList()));
  }

  private getCategoryList() {
    return [
      "Action", "Adult", "Adventure", "Comedy", "Doujinshi", "Drama", "Ecchi", "Fantasy", "Gender Bender", "Harem", "Hentai", "Historical",
      "Horror", "Josei", "Lolicon", "Martial Arts", "Mature", "Mecha", "Mystery", "Psychological", "Romance", "School Life", "Sci-fi",
      "Seinen", "Shotacon", "Shoujo", "Shoujo Ai", "Shounen", "Shounen Ai", "Slice of Life", "Smut", "Sports", "Supernatural", "Tragedy",
      "Webtoon", "Yaoi", "Yuri",
    ].map((n) => new Category(n));
  }
}
