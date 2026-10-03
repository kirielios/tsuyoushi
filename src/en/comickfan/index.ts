// Port of keiyoushi/extensions-source src/en/comickfan/ComicKFan.kt
import { FilterList, HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, tryParseInstant, urlWithoutDomain, type Document, type Element, type Response } from "../../../sdk/index.ts";
import { ContentGenreFilter, FormatGenreFilter, GenreGenreFilter, SortFilter, StatusFilter, ThemeGenreFilter, TypeFilter } from "./filters.ts";

// Port of ComicKFanDto.kt
interface ComicKFanChapterListResponseDto {
  data: ComicKFanChapterDto[];
}
interface ComicKFanChapterDto {
  hash_id: string;
  chapter: string;
  title: string | null;
  group_names?: string[];
  published_at: string | null;
  created_at: string | null;
}

export default class ComicKFan extends KeiSource {
  // Popular
  getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.POPULAR);
  }

  // Latest
  getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.LATEST);
  }

  // Search
  protected async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url = HttpUrl.parse(u.toString());
    if (url.host !== new URL(this.baseUrl).host) return null;
    const slug = url.pathSegments[1];
    if (slug == null) return null;
    // Rewrite to strip suffixes after slug
    const newUrl = `${this.baseUrl}/manga/${slug}`;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(newUrl);
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let genres = "";
    let status = "";
    let type = "";
    let sort = "";

    filters.forEach((filter) => {
      if (filter instanceof FormatGenreFilter) genres += filter.selected;
      else if (filter instanceof ContentGenreFilter) genres += filter.selected;
      else if (filter instanceof ThemeGenreFilter) genres += filter.selected;
      else if (filter instanceof GenreGenreFilter) genres += filter.selected;
      else if (filter instanceof StatusFilter) status = filter.toUriPart();
      else if (filter instanceof TypeFilter) type = filter.toUriPart();
      else if (filter instanceof SortFilter) sort = filter.toUriPart();
    });
    const url = HttpUrl.parse(`${this.baseUrl}/advanced-search`)
      .newBuilder()
      .addQueryParameter("genres", genres)
      .addQueryParameter("status", status)
      .addQueryParameter("type", type)
      .addQueryParameter("sort", sort)
      .addQueryParameter("name", query)
      .addQueryParameter("page", String(page))
      .build();

    return this.parseSearch(await this.client.get(url.toString()));
  }

  private parseSearch(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("div:has(> form) + div.grid > a").map((it) => this.searchMangaFromElement(it));

    const hasNextPage = document.selectFirst("a:has(img[alt=Next])") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.absUrl("href"));

    const img = element.selectFirst("img")!;
    manga.title = img.attr("alt");
    manga.thumbnail_url = img.absUrl("src");
    return manga;
  }

  // Details + Chapters
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(this.getMangaUrl(manga)).then((it) => this.parseDetails(it.asJsoup())) : manga,
      fetchChapters ? this.getChapters(manga) : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  private parseDetails(document: Document): SManga {
    const infoRoot = document.selectFirst("div[class=bg-card-section]");

    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    manga.title = document.selectFirst("h1")!.text();
    manga.description = document.selectFirst("div.comic-content.desk")?.text();
    manga.author = infoRoot ? this.getValue(infoRoot, "Author")?.split(",").join(", ") : undefined;
    manga.artist = infoRoot ? this.getValue(infoRoot, "Artist")?.split(",").join(", ") : undefined;
    manga.genre = infoRoot
      ?.select("div.font-medium:contains(Genres) + div a")
      .map((it) => it.text())
      .join(", ");

    switch (infoRoot ? this.getValue(infoRoot, "Status")?.toLowerCase() : undefined) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      // "cancelled" -> SManga.CANCELLED // Shows as '❓ Unknown'
      case "hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    manga.thumbnail_url = infoRoot?.selectFirst("div.thumb-cover img")?.absUrl("src");
    return manga;
  }

  private getValue(element: Element, label: string): string | undefined {
    const value = element
      .select("div.flex-row.gap-4")
      .find((it) => it.selectFirst("> div.text-sm")?.text() === label)
      ?.selectFirst("> div.text-sm:nth-child(2):last-child");
    if (!value || ["", "-", "_"].includes(value.text())) return undefined;
    return value.text();
  }

  private async getChapters(manga: SManga): Promise<SChapter[]> {
    const comicId = HttpUrl.parse(`${this.baseUrl}${manga.url}`).pathSegments[1];
    if (comicId == null) throw new Error(`Invalid manga URL: ${manga.url}`);

    const response = await this.client.get(`${this.baseUrl}/api/comics/${comicId}/chapter-list?translation_group_id=`);

    return response.parseAs<ComicKFanChapterListResponseDto>().data.map((it) => this.toSChapter(it, comicId));
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pages = document.select("div.w-full > img[loading=lazy]");
    return pages.map((element, index) => new Page(index, "", element.absUrl("src")));
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new FormatGenreFilter(), new ContentGenreFilter(), new ThemeGenreFilter(), new GenreGenreFilter(), new StatusFilter(), new TypeFilter(), new SortFilter());
  }

  private toSChapter(dto: ComicKFanChapterDto, comicId: string): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(`/manga/${comicId}/chapter-${dto.chapter}-${dto.hash_id}`);
    chapter.name = `Chapter ${dto.chapter}`;
    chapter.scanlator = (dto.group_names ?? []).join(", ");
    if (dto.chapter.trim() !== "" && !isNaN(Number(dto.chapter))) chapter.chapter_number = Number(dto.chapter);
    chapter.date_upload = tryParseInstant(dto.created_at ?? dto.published_at);
    return chapter;
  }
}
