// Port of keiyoushi/extensions-source src/id/wurmz/Wurmz.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  extractNextJsRsc,
  parseAs,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
} from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

// Dto.kt
interface MangaDetailsDto {
  name: string;
  alternateName?: string | null;
  description?: string | null;
  image?: string | null;
  author?: AuthorDto | null;
  genre?: string[] | null;
}

function detailsToSManga(dto: MangaDetailsDto): SManga {
  const manga = SManga.create();
  manga.title = dto.name;
  let description = dto.description ?? "";
  if (dto.alternateName != null && dto.alternateName.trim() !== "") {
    if (description) description += "\n\n";
    description += `Nama Alternatif: ${dto.alternateName}`;
  }
  manga.description = description;
  manga.thumbnail_url = dto.image ?? undefined;
  manga.author = dto.author?.name;
  manga.genre = dto.genre?.join(", ");
  manga.initialized = true;
  return manga;
}

interface AuthorDto {
  name: string;
}

interface ChapterListDto {
  chapters: ChapterDto[];
  sourceSlug?: string | null;
}

interface ChapterDto {
  chapter_label: string;
  chapter_sort: number;
}

function chapterToSChapter(dto: ChapterDto, sourceSlug: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/detail/${sourceSlug}/chapter/${dto.chapter_label}`;
  chapter.name = `Chapter ${dto.chapter_label}`;
  chapter.chapter_number = dto.chapter_sort;
  return chapter;
}

interface PageListDto {
  images: string[];
}

type JsonObject = Record<string, unknown>;
const isObject = (it: unknown): it is JsonObject => typeof it === "object" && it !== null && !Array.isArray(it);
/** JsonElement.jsonPrimitive.content; non-primitives give undefined instead of throwing */
const content = (it: unknown): string | undefined => (it === null ? "null" : typeof it === "object" || it === undefined ? undefined : String(it));

export default class Wurmz extends KeiSource {
  private get rscHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("Rsc", "1");
    return h;
  }

  // ======================== Popular ========================
  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/semua-komik?sort=popular_all&page=${page}`)).asJsoup();
    return this.mangaListParse(document);
  }

  // ======================== Latest =========================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/semua-komik?sort=update&page=${page}`)).asJsoup();
    return this.mangaListParse(document);
  }

  // ======================== Search =========================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/semua-komik`).newBuilder();
    if (query) url.addQueryParameter("q", query);
    if (page > 1) url.addQueryParameter("page", String(page));
    for (const filter of filters) {
      if (filter instanceof SortFilter) url.addQueryParameter("sort", filter.toUriPart());
      else if (filter instanceof TypeFilter) {
        if (filter.toUriPart()) url.addQueryParameter("type", filter.toUriPart());
      } else if (filter instanceof StatusFilter) {
        if (filter.toUriPart()) url.addQueryParameter("status", filter.toUriPart());
      } else if (filter instanceof GenreFilter) {
        if (filter.toUriPart()) url.addQueryParameter("genre", filter.toUriPart());
      }
    }

    const document = (await this.client.get(url.build().toString())).asJsoup();
    return this.mangaListParse(document);
  }

  private mangaListParse(document: Document): MangasPage {
    const mangas: SManga[] = [];
    for (const element of document.select("article.comic-card")) {
      const link = element.selectFirst("a[href*=/detail/]");
      if (link == null) continue;
      const titleText = element.selectFirst("h2")?.text() || link.attr("aria-label") || null;
      if (titleText == null) continue;

      const manga = SManga.create();
      manga.url = urlWithoutDomain(link.attr("abs:href"));
      manga.title = titleText;
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      mangas.push(manga);
    }

    const hasNextPage = document.selectFirst("a:contains(Berikutnya)") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  // ======================== Details & Updates =============
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const bodyString = (await this.client.get(this.getMangaUrl(manga), this.rscHeaders)).text();
    const details = this.mangaDetailsParse(bodyString);
    details.url = manga.url;
    const chapterList = this.chapterListParse(bodyString, manga.url);

    return new SMangaUpdate(details, chapterList);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const baseHost = new URL(this.baseUrl).host.replace(/^www\./, "");
    if (url.host.replace(/^www\./, "").toLowerCase() !== baseHost.toLowerCase()) return null;

    const pathSegments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const detailIdx = pathSegments.indexOf("detail");
    if (detailIdx === -1 || pathSegments.length < detailIdx + 3) return null;

    const type = pathSegments[detailIdx + 1];
    const slug = pathSegments[detailIdx + 2];
    if (!type || !slug) return null;

    const manga = SManga.create();
    manga.url = `/detail/${type}/${slug}`;
    try {
      return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    } catch {
      return null;
    }
  }

  private mangaDetailsParse(bodyString: string): SManga {
    let details = extractNextJsRsc<MangaDetailsDto>(bodyString, (it) => isObject(it) && content(it["@type"]) === "ComicSeries");
    if (details == null) {
      const html = extractNextJsRsc<JsonObject>(
        bodyString,
        (it) => isObject(it) && "dangerouslySetInnerHTML" in it && isObject(it["dangerouslySetInnerHTML"]) && (content(it["dangerouslySetInnerHTML"]["__html"])?.includes("ComicSeries") ?? false),
      );
      const inner = html && isObject(html["dangerouslySetInnerHTML"]) ? content(html["dangerouslySetInnerHTML"]["__html"]) : undefined;
      details = inner != null ? parseAs<MangaDetailsDto>(inner) : null;
    }
    if (details == null) throw new Error("Gagal memproses detail komik");

    const statusText = content(extractNextJsRsc<JsonObject>(bodyString, (it) => isObject(it) && "className" in it && content(it["className"]) === "status-badge")?.["children"]);

    const manga = detailsToSManga(details);
    manga.status = this.parseStatus(statusText ?? "");
    return manga;
  }

  private parseStatus(status: string): number {
    switch (status.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "tamat":
      case "completed":
        return SManga.COMPLETED;
      case "hiatus":
        return SManga.ONGOING;
      case "drop":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ======================== Chapters =======================
  private chapterListParse(bodyString: string, mangaUrl: string): SChapter[] {
    const chapterList = extractNextJsRsc<ChapterListDto>(bodyString, (it) => isObject(it) && "chapters" in it);
    if (chapterList == null) throw new Error("Gagal memproses daftar chapter");

    const slug = chapterList.sourceSlug ?? substringBefore(mangaUrl.startsWith("/detail/") ? mangaUrl.slice("/detail/".length) : mangaUrl, "/chapter");

    return chapterList.chapters.map((it) => chapterToSChapter(it, slug));
  }

  // ======================== Pages ==========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const bodyString = (await this.client.get(this.getChapterUrl(chapter), this.rscHeaders)).text();
    const pageList = extractNextJsRsc<PageListDto>(bodyString, (it) => isObject(it) && "images" in it);
    if (pageList == null) throw new Error("Gagal memproses daftar gambar");

    return pageList.images.map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // ======================== Filters ========================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new TypeFilter(), new StatusFilter(), new GenreFilter());
  }
}
