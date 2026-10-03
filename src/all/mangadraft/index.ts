// Port of keiyoushi/extensions-source src/all/mangadraft/MangaDraft.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  DateTimeFormatter,
  Locale,
  firstInstance,
  isBlank,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Element,
  type Response,
} from "../../../sdk/index.ts";

// --- MangaDraftCatalogRequestDto.kt / MangaDraftPagesRequestDto.kt / MangaDraftProjectDto.kt
interface MangaDraftCatalogResponseDto {
  data?: MangaDraftCatalogProjectDto[];
}
interface MangaDraftCatalogProjectDto {
  name: string;
  avatar?: string | null;
  genres?: string | null;
  description?: string | null;
  url: string;
}
interface MangaDraftPageDTO {
  id: number;
  number: number;
  url: string;
}
type PagesByCategory = Record<string, MangaDraftPageDTO[]>;
interface MangaDraftProjectDto {
  name: string;
  description: string;
  genres?: { name: string }[];
  project_status_id: number;
}

// --- Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      state,
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

// sort is only applied when all has been selected in order
class SortFilter extends UriPartFilter {
  constructor(state = 0) {
    super("Sort", [["Likes", "likes"], ["Comments", "comments"], ["Views", "views"], ["Name", "name"]], state);
  }
}
class TypeFilter extends UriPartFilter {
  constructor(state = 0) {
    super("Type", [["All", "all"], ["Manga-Comics", "bd.manga"], ["Webtoons", "webtoons"], ["Light Novels", "novels"], ["ArtBooks", "artbooks"]], state);
  }
}
class OrderFilter extends UriPartFilter {
  constructor(state = 0) {
    super("Order", [["All", "all"], ["Popularity", "popular"], ["Trending", "trending"], ["Recently Released", "news"]], state);
  }
}
class SectionFilter extends UriPartFilter {
  constructor(state = 0) {
    super("Section", [["All", ""], ["Neoville", "neoville"], ["Original", "original"], ["Indepolis", "indepolis"], ["Recently Released", "news"]], state);
  }
}
class StatusFilter extends UriPartFilter {
  constructor(state = 0) {
    super("Status", [["All", ""], ["In Progress", "0"], ["Completed", "1"], ["On Break", "2"]], state);
  }
}
class GenreFilter extends UriPartFilter {
  constructor(state = 0) {
    super(
      "Genre",
      [
        ["All", ""],
        ["Action", "action"],
        ["Adventure", "Adventure"],
        ["BL", "boys-love-yaoi"],
        ["Drama", "drama"],
        ["Geek", "geek"],
        ["Yuri", "girls-love-yuri"],
        ["Historic", "historic"],
        ["Horror", "horror"],
        ["Humor", "humor"],
        ["Teens", "teens"],
        ["Thriller", "thriller"],
        ["Psychological", "psychological"],
        ["Romance", "romance"],
        ["Fantasy", "fantasy"],
        ["Sport", "sport"],
        ["Super-hero", "super-hero"],
        ["Slice-of-life", "slice-of-life"],
        ["Western", "western"],
      ],
      state,
    );
  }
}
class FormatFilter extends UriPartFilter {
  constructor(state = 0) {
    super("Format", [["All", ""], ["Series", "serie"], ["One-Shot", "oneshot"]], state);
  }
}
class LanguageFilter extends UriPartFilter {
  constructor(state = 0) {
    super(
      "Language",
      [["All", ""], ["Deutsch", "de"], ["English", "en"], ["Spanish", "es"], ["French", "fr"], ["Italian", "it"], ["Polski", "pl"], ["Portuguese", "pt"], ["Suomen kieli", "fi"], ["Japanese", "jp"]],
      state,
    );
  }
}

const dateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.FRENCH);

export default class MangaDraft extends KeiSource {
  private catalogUrl(params: [string, string][]) {
    const b = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("api").addPathSegment("catalog").addPathSegment("projects");
    params.forEach(([k, v]) => b.addQueryParameter(k, v));
    return b.build().toString();
  }

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.catalogParse(await this.client.get(this.catalogUrl([["order", "popular"], ["type", "all"], ["page", String(page)], ["number", "20"]])));
  }

  private catalogParse(response: Response): MangasPage {
    const result = response.parseAs<MangaDraftCatalogResponseDto>();

    const mangas = result.data ?? [];
    return new MangasPage(
      mangas.map((it) => {
        const manga = SManga.create();
        manga.url = urlWithoutDomain(it.url);
        manga.title = it.name;
        manga.thumbnail_url = it.avatar ?? undefined;
        manga.description = it.description ?? undefined;
        manga.genre = it.genres ?? undefined;
        return manga;
      }),
      // if there is less than 20 received there won't be a next page
      mangas.length >= 20,
    );
  }

  // latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.catalogParse(await this.client.get(this.catalogUrl([["order", "news"], ["type", "all"], ["page", String(page)], ["number", "20"]])));
  }

  // Search
  async getSearchMangaList(page: number, _query: string, filters: FilterList): Promise<MangasPage> {
    const typeFilter = firstInstance(filters, TypeFilter);
    const orderFilter = firstInstance(filters, OrderFilter);
    const sectionFilter = firstInstance(filters, SectionFilter);
    const genreFilter = firstInstance(filters, GenreFilter);
    const formatFilter = firstInstance(filters, FormatFilter);
    const languageFilter = firstInstance(filters, LanguageFilter);
    const statusFilter = firstInstance(filters, StatusFilter);
    const sortFilter = firstInstance(filters, SortFilter);

    return this.catalogParse(
      await this.client.get(
        this.catalogUrl([
          ["type", typeFilter.toUriPart()],
          ["order", orderFilter.toUriPart()],
          ["section", sectionFilter.toUriPart()],
          ["genre", genreFilter.toUriPart()],
          ["format", formatFilter.toUriPart()],
          ["language", languageFilter.toUriPart()],
          ["status", statusFilter.toUriPart()],
          ["order_all", sortFilter.toUriPart()],
          ["page", String(page)],
          ["number", "20"],
        ]),
      ),
    );
  }

  // filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new TypeFilter(), new OrderFilter(), new SectionFilter(), new GenreFilter(), new FormatFilter(), new LanguageFilter(), new StatusFilter());
  }

  protected regexWindowProject = /window\.project\s*=\s*(\{.*?\})\s*;/s;

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document), this.chapterListParse(document));
  }

  // Details
  private mangaDetailsParse(doc: Element): SManga {
    // Find the <script> containing window.project
    const scriptContent = doc.selectFirst("script:containsData(window.project)")?.data();
    if (scriptContent == null) throw new Error("Unable to find project script");

    // get the project part in the script
    const projectJson = this.regexWindowProject.exec(scriptContent)?.[1];
    if (projectJson == null) throw new Error("window.project not found");

    const project = JSON.parse(projectJson) as MangaDraftProjectDto;

    const manga = SManga.create();
    manga.title = project.name;
    manga.description = project.description;
    manga.author = doc.select("[title=Auteur]").text();
    manga.artist = doc.select("[title=créateur]").text();
    manga.genre = (project.genres ?? []).map((it) => it.name).join(", ");
    manga.status = this.parseStatus(project.project_status_id);
    return manga;
  }

  parseStatus(status: number | null | undefined) {
    switch (status) {
      case 0:
        return SManga.ONGOING;
      case 1:
        return SManga.COMPLETED;
      case 2:
        return SManga.ON_HIATUS;
      default:
        return SManga.UNKNOWN;
    }
  }

  chapterListSelector() {
    return "div.mt-7 div a:not(:has(img))";
  }

  private chapterListParse(document: Element): SChapter[] {
    const chapterElements = document.select(this.chapterListSelector());

    const isNotOneShot = chapterElements[0].attr("href").includes("c.");
    if (isNotOneShot) return chapterElements.map((it, i) => this.chapterFromElement(it, i)).reverse();
    return [this.chapterFromElement(chapterElements[0], 0)];
  }

  private chapterFromElement(element: Element, index: number): SChapter {
    const chapter = SChapter.create();
    chapter.chapter_number = index;
    // Kotlin Float.toString: "3.0"
    chapter.name = `${index}.0. ${element.selectFirst(".group-hover\\:text-secondary")?.text() ?? ""}`;

    chapter.url = element.absUrl("href");

    const dateText = element.selectFirst("div>span")?.text();
    if (!isBlank(dateText)) {
      chapter.name = substringBefore(chapter.name, dateText!);
      chapter.date_upload = dateFormat.tryParseDate(dateText!);
    }
    return chapter;
  }

  // chapter urls are stored as absolute urls
  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    let firstPage: string;
    if (chapter.url.includes("c.")) {
      // the reader redirects to the id of the first page of the chapter
      const response = await this.client.get(chapter.url);
      firstPage = substringAfterLast(response.url, "/").replace(/\D/g, "");
    } else {
      firstPage = substringAfterLast(chapter.url, "/").replace(/\D/g, "");
    }

    const result = (await this.client.get(`${this.baseUrl}/api/reader/listPages?first_page=${firstPage}&grouped_by_category=true`)).parseAs<PagesByCategory>();

    const pageList = this.findCategoryByPageId(result, Number(firstPage));
    return pageList.map((it) => new Page(it.number, `${it.url}?size=full`, `${it.url}?size=full`));
  }

  findCategoryByPageId(pagesByCategory: PagesByCategory, pageId: number): MangaDraftPageDTO[] {
    const found = Object.values(pagesByCategory).find((pageList) => pageList.some((it) => it.id === pageId));
    if (!found) throw new Error("Collection contains no element matching the predicate.");
    return found;
  }
}
