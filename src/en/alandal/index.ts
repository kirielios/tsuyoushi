// Port of keiyoushi/extensions-source src/en/alandal/Alandal.kt (+ Dto.kt)
import {
  FilterList,
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  isBlank,
  parseHtml,
  substringAfter,
  toHttpUrl,
  type ClientBuilder,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, isUriFilter } from "./filters.ts";

// --- Dto.kt
interface ResponseDto<T> {
  data: { series: T };
}
interface SearchSeriesDto {
  current_page: number;
  last_page: number;
  data: { name: string; slug: string; cover: string }[];
}
interface NamedObject {
  name: string;
  type?: string | null;
}
interface MangaDetailsDto {
  name: string;
  summary: string;
  status: NamedObject;
  genres: NamedObject[];
  creators: NamedObject[];
  cover: string;
}
interface ChapterResponseDto {
  data: { name: string; published_at: string; access: boolean }[];
}
interface PagesResponseDto {
  data: { chapter: { chapter: { pages: string[] } } };
}

/** SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'"): local time zone, and SSSSSS is a millisecond count (so 6 digits overflow into seconds), as upstream. */
function parseChapterDate(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d+)Z$/.exec(text);
  if (!m) return 0;
  const [y, mo, d, h, mi, s, ms] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime() + ms;
}

export default class Alandal extends HttpSource {
  private readonly apiUrl = "https://qq.alandal.com/api";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1);
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    return h;
  }

  private get apiHeaders() {
    const h = this.headersBuilder();
    h.append("Accept", "application/json");
    h.append("Host", toHttpUrl(this.apiUrl).host);
    h.append("Origin", this.baseUrl);
    h.append("Sec-Fetch-Dest", "empty");
    h.append("Sec-Fetch-Mode", "cors");
    h.append("Sec-Fetch-Site", "same-origin");
    return h;
  }

  // ============================== Popular ===============================

  protected popularMangaRequest(page: number): Request {
    return this.searchMangaRequest(page, "", FilterList(new SortFilter("popular")));
  }

  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // =============================== Latest ===============================

  protected latestUpdatesRequest(page: number): Request {
    return this.searchMangaRequest(page, "", FilterList(new SortFilter("new")));
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // =============================== Search ===============================

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const b = toHttpUrl(this.apiUrl).newBuilder();
    b.addPathSegment("series");
    if (!isBlank(query)) b.addQueryParameter("name", query);
    b.addQueryParameter("type", "comic");

    const filterList = filters.length ? filters : this.getFilterList();
    filterList.filter(isUriFilter).forEach((it) => it.addToUri(b));

    b.addQueryParameter("page", String(page));

    return GET(b.build().toString(), this.apiHeaders);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const data = response.parseAs<ResponseDto<SearchSeriesDto>>().data.series;
    const mangaList = data.data.map((it) => {
      const manga = SManga.create();
      manga.title = it.name;
      manga.url = `/series/${it.slug}`;
      manga.thumbnail_url = it.cover;
      return manga;
    });
    const hasNextPage = data.current_page < data.last_page;
    return new MangasPage(mangaList, hasNextPage);
  }

  // =============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new GenreFilter(), new SortFilter(), new StatusFilter());
  }

  // =========================== Manga Details ============================

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url.replace("series/", "series/comic-");
  }

  override mangaDetailsRequest(manga: SManga): Request {
    const b = toHttpUrl(this.apiUrl).newBuilder();
    b.addPathSegments(substringAfter(manga.url, "/"));
    b.addQueryParameter("type", "comic");

    return GET(b.build().toString(), this.apiHeaders);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const dto = response.parseAs<ResponseDto<MangaDetailsDto>>().data.series;
    const manga = SManga.create();
    manga.title = dto.name;
    manga.thumbnail_url = dto.cover;
    manga.description = parseHtml(this.host.load, dto.summary, "").text();
    manga.genre = dto.genres.map((it) => it.name).join(", ");
    manga.author = dto.creators
      .filter((it) => it.type === "author")
      .map((it) => it.name)
      .join(", ");
    switch (dto.status.name.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  // ============================== Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url.replace("series/", "chapter/comic-").replace("chapters/", "");
  }

  protected override chapterListRequest(manga: SManga): Request {
    const b = toHttpUrl(`${this.apiUrl}${manga.url}`).newBuilder();
    b.addPathSegment("chapters");
    b.addQueryParameter("type", "comic");
    b.addQueryParameter("from", "0");
    b.addQueryParameter("to", "999");

    return GET(b.build().toString(), this.apiHeaders);
  }

  protected chapterListParse(response: Response): SChapter[] {
    // response.request.url without query, minus the first path segment ("/api")
    const slug = new URL(response.url).pathname.replace(/^\/[^/]*/, "");

    return response
      .parseAs<ChapterResponseDto>()
      .data.map((it) => {
        const chapter = SChapter.create();
        const prefix = it.access ? "" : "[LOCKED] ";
        chapter.name = `${prefix}Chapter ${it.name}`;
        chapter.date_upload = parseChapterDate(it.published_at);
        chapter.url = `${slug}/${it.name}`;
        return chapter;
      })
      .reverse();
  }

  // =============================== Pages ================================

  protected override pageListRequest(chapter: SChapter): Request {
    if (chapter.name.startsWith("[LOCKED]")) throw new Error("Log in and unlock chapter in webview, then refresh chapter list");

    const b = toHttpUrl(`${this.apiUrl}${chapter.url}`).newBuilder();
    b.addQueryParameter("type", "comic");
    b.addQueryParameter("traveler", "0");

    return GET(b.build().toString(), this.apiHeaders);
  }

  protected pageListParse(response: Response): Page[] {
    const data = response.parseAs<PagesResponseDto>().data.chapter.chapter;

    return data.pages.map((s, index) => new Page(index, "", s));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  override imageRequest(page: Page): Request {
    const pageHeaders = this.headersBuilder();
    pageHeaders.append("Accept", "image/avif,image/webp,*/*");
    pageHeaders.append("Host", toHttpUrl(page.imageUrl!).host);

    return GET(page.imageUrl!, pageHeaders);
  }
}
