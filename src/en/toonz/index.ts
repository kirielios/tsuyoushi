// Port of keiyoushi/extensions-source src/en/toonz/Toonz.kt (+ Dto.kt, Filters.kt)
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
  firstInstanceOrNull,
  hasKeys,
  isBlank,
  toHttpUrl,
  tryParseInstant,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type Request,
} from "../../../sdk/index.ts";

// Dto.kt
interface ChapterListDto {
  chapters?: ChapterDto[];
}
interface ChapterDto {
  chapterNumber: string;
  title?: string | null;
  slug: string;
  date?: string | null;
}
interface ChapterImagesDto {
  images: { filename: string }[];
}
interface GenreDto {
  name: string;
  slug: string;
}

const FLOAT_REGEX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function chapterToSChapter(c: ChapterDto, mangaUrl: string): SChapter {
  const chapter = SChapter.create();
  const chNum = FLOAT_REGEX.test(c.chapterNumber) ? Number(c.chapterNumber) : -1;
  chapter.chapter_number = chNum;
  const cleanNum = chNum >= 0 ? String(chNum).replace(/\.0$/, "") : c.chapterNumber;
  const chTitle = c.title != null && c.title.trim().length > 0 ? c.title : null;
  if (chTitle != null) {
    const lower = chTitle.toLowerCase();
    chapter.name = lower.startsWith("chapter") || lower.startsWith("ch.") ? chTitle : `Chapter ${cleanNum}: ${chTitle}`;
  } else {
    chapter.name = `Chapter ${cleanNum}`;
  }
  chapter.url = c.slug.startsWith("chapter-") ? c.slug.slice("chapter-".length) : c.slug;
  chapter.memo = { mangaUrl };
  chapter.date_upload = tryParseInstant(c.date);
  return chapter;
}

// Filters.kt
class CatalogFilter extends Filter.Select<string> {
  constructor(
    private readonly options: [string, string][] = [
      ["All", "comics"],
      ["Manhwa", "manhwa/browse"],
      ["Manga", "manga/browse"],
      ["Western", "western/browse"],
      ["Adult", "adult/browse"],
    ],
  ) {
    super("Catalog", options.map((it) => it[0]));
  }
  getValue(): string {
    return this.options[this.state][1];
  }
}

class SortFilter extends Filter.Select<string> {
  constructor(
    private readonly options: [string, string][] = [
      ["Popular", "popular"],
      ["Latest updates", "latest"],
    ],
  ) {
    super("Sort", options.map((it) => it[0]));
  }
  getValue(): string {
    return this.options[this.state][1];
  }
}

class GenreFilter extends Filter.Select<string> {
  constructor(private readonly options: [string, string][]) {
    super("Genre", options.map((it) => it[0]));
  }
  getValue(): string {
    return this.options[this.state][1];
  }
}

const VALID_TYPES = new Set(["manhwa", "manga", "western", "comic"]);
const PATH_PATTERN = /^\/(?:manhwa|manga|western|comic)\/([^/]+)$/;
const COMIC_ID_REGEX = /comicId[^:]*:(\d+)/;

/** Jsoup's Element.closest(css): the element itself or its nearest ancestor matching. */
function closest(el: Element, css: string): Element | null {
  for (let cur: Element | null = el; cur; cur = cur.parent()) if (cur.is(css)) return cur;
  return null;
}

export default class Toonz extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2, 1000).addInterceptor((request) =>
      this.addCookie(request, [
        ["adult_ok", "1"],
        ["reader_prefs", "%7B%22rating%22%3A%22pornographic%22%7D"],
      ]),
    );
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the base host on every matching request, which then sends them. */
  private addCookie(request: Request, cookies: [string, string][]): Request {
    const d = toHttpUrl(this.baseUrl).host;
    const host = new URL(request.url).hostname;
    if (host === d || host.endsWith(`.${d}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${d}/`, `${key}=${value}; Domain=${d}; Path=/`);
    }
    return request;
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getMangaList(`${this.baseUrl}/comics?sort=popular&page=${page}`, page);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getMangaList(`${this.baseUrl}/comics?sort=latest&page=${page}`, page);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (!isBlank(query)) {
      // URLEncoder.encode(..., "UTF-8"): form encoding, spaces become "+"
      const encodedQuery = new URLSearchParams({ q: query.trim() }).toString().slice(2);
      return this.getMangaList(`${this.baseUrl}/search?q=${encodedQuery}&page=${page}`, page);
    }

    const sort = firstInstanceOrNull(filters, SortFilter)?.getValue() ?? "popular";

    const genre = firstInstanceOrNull(filters, GenreFilter)?.getValue() ?? "";
    if (!isBlank(genre)) return this.getMangaList(`${this.baseUrl}/genre/${genre}?sort=${sort}&page=${page}`, page);

    const catalog = firstInstanceOrNull(filters, CatalogFilter)?.getValue() ?? "comics";
    return this.getMangaList(`${this.baseUrl}/${catalog}?sort=${sort}&page=${page}`, page);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host) return null;
    const segments = url.pathname.slice(1).split("/");
    const type = segments[0];
    if (!type || !VALID_TYPES.has(type)) return null;
    const slug = segments[1];
    if (!slug) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(`${this.baseUrl}/${type}/${slug}`);
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const comicId = manga.memo["comicId"] as string | undefined;
    if (comicId != null) {
      const [updatedManga, updatedChapters] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : manga, fetchChapters ? this.fetchChapters(manga, comicId) : chapters]);
      return new SMangaUpdate(updatedManga, updatedChapters);
    }

    const updatedManga = await this.fetchMangaDetails(manga);
    const resolvedComicId = updatedManga.memo["comicId"];
    if (typeof resolvedComicId !== "string") throw new Error("Key comicId is missing in the map.");
    const updatedChapters = fetchChapters ? await this.fetchChapters(manga, resolvedComicId) : chapters;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const mangaUrl = this.getMangaUrl(manga);
    const document = (await this.client.get(mangaUrl)).asJsoup();
    let comicId = manga.memo["comicId"] as string | undefined;
    if (comicId == null) {
      for (const script of document.select("script")) {
        const m = COMIC_ID_REGEX.exec(script.data())?.[1];
        if (m !== undefined) {
          comicId = m;
          break;
        }
      }
    }
    if (comicId == null) throw new Error(`Could not find comic ID for ${manga.title}`);

    manga.title = document.selectFirst("h1")?.text() ?? manga.title;
    manga.thumbnail_url = (document.selectFirst("img[data-cover]")?.absUrl("src") ?? document.selectFirst("div.group img[src]")?.absUrl("src")) || manga.thumbnail_url;
    manga.description = document.selectFirst("div.prose")?.text() ?? document.selectFirst("meta[name=description]")?.attr("content").trim();
    const author = document.select("a[href^=/author/]").map((it) => it.text()).join(", ");
    manga.author = isBlank(author) ? undefined : author;
    manga.artist = manga.author;
    const genre = document.select("a[href^=/genre/]").map((it) => it.text()).join(", ");
    manga.genre = isBlank(genre) ? undefined : genre;
    manga.status = this.parseStatus(document.selectFirst("dt:contains(Status) + dd")?.text());
    manga.memo = { comicId };
    return manga;
  }

  private async fetchChapters(manga: SManga, comicId: string): Promise<SChapter[]> {
    const chapterListDto = (await this.client.get(`${this.baseUrl}/api/comics/${comicId}/chapters`)).parseAs<ChapterListDto>();
    return (chapterListDto.chapters ?? []).map((it) => chapterToSChapter(it, manga.url));
  }

  override getChapterUrl(chapter: SChapter): string {
    const mangaUrl = chapter.memo["mangaUrl"];
    if (typeof mangaUrl !== "string") throw new Error("Key mangaUrl is missing in the map.");
    return `${this.baseUrl}${mangaUrl}/chapter/${chapter.url}`;
  }

  private get rscHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("rsc", "1");
    return h;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const images = extractNextJs<ChapterImagesDto>(await this.client.get(chapterUrl, this.rscHeaders), hasKeys("images"))?.images;
    if (images == null) return [];

    return images.map((image, index) => {
      const filename = image.filename.replace(/^\//, "");
      return new Page(index, "", `${this.baseUrl}/uploads/${filename}`);
    });
  }

  override get supportsFilterFetching(): boolean {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.baseUrl}/api/genres`)).parseAs<unknown>();
  }

  getFilterList(data: unknown = null): FilterList {
    const genres = (data as GenreDto[] | null)?.map((it): [string, string] => [it.name, it.slug]) ?? [];

    const genreOptions: [string, string][] = [["None", ""], ...genres];

    return FilterList(new CatalogFilter(), new SortFilter(), new Filter.Separator(), new GenreFilter(genreOptions));
  }

  private async getMangaList(url: string, page: number): Promise<MangasPage> {
    const document = (await this.client.get(url)).asJsoup();
    const seen = new Set<string>();
    const mangas: SManga[] = [];

    for (const a of document.select("a[href]")) {
      const absUrl = a.absUrl("href");
      const path = absUrl.startsWith(this.baseUrl) ? absUrl.slice(this.baseUrl.length) : absUrl;
      if (!PATH_PATTERN.test(path) || seen.has(path) || path.includes("browse")) continue;
      seen.add(path);

      const card = closest(a, "div.group") ?? a;
      const label = a.attr("aria-label").trim();
      const title = card.selectFirst("h3")?.text() ?? (label.length > 0 ? label : null) ?? (a.text().length > 0 ? a.text() : null);
      if (title == null) continue;

      const manga = SManga.create();
      manga.url = urlWithoutDomain(absUrl);
      manga.title = title;
      manga.thumbnail_url = card.selectFirst("img[src]")?.absUrl("src");
      mangas.push(manga);
    }

    const hasNextPage = document.selectFirst(`a[href*="page=${page + 1}"]`) != null;

    return new MangasPage(mangas, hasNextPage);
  }

  private parseStatus(status: string | undefined): number {
    switch (status?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }
}
