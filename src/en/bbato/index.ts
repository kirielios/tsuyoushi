// Port of keiyoushi/extensions-source src/en/bbato/Bbato.kt
import {
  ClientBuilder,
  DateTimeFormatter,
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringAfterLast,
  substringBefore,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../../sdk/index.ts";
import { GenreFilter, MinChapterFilter, SortFilter, StatusFilter, TypeFilter, YearFilter, getFilters } from "./filters.ts";

// Port of Dto.kt
interface ChapterListResponse {
  data?: ChapterDto[];
}
interface ChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string | null;
}
function toSChapterList(response: ChapterListResponse, mangaSlug: string, dateTimeFormatter: DateTimeFormatter): SChapter[] {
  return (response.data ?? []).map((it) => {
    const chapter = SChapter.create();
    chapter.url = `/read/${mangaSlug}/${it.chapter_slug}`;
    chapter.name = it.chapter_name;
    chapter.date_upload = dateTimeFormatter.tryParseDateTime(it.updated_at);
    return chapter;
  });
}

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

export default class Bbato extends KeiSource {
  protected configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2);
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const path = page === 1 ? "/filter?sort=views" : `/filter?sort=views&page=${page}`;
    return this.parseMangasPage((await this.client.get(`${this.baseUrl}${path}`)).asJsoup());
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const path = page === 1 ? "/updated" : `/updated/page/${page}`;
    return this.parseMangasPage((await this.client.get(`${this.baseUrl}${path}`)).asJsoup());
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = HttpUrl.parse(`${this.baseUrl}/filter`).newBuilder();
    url.addQueryParameter("keyword", query);

    if (page > 1) {
      url.addQueryParameter("page", String(page));
    }

    firstInstanceOrNull(filters, TypeFilter)
      ?.state.filter((it) => it.state)
      .forEach((it) => url.addQueryParameter("type[]", it.value));
    firstInstanceOrNull(filters, GenreFilter)
      ?.state.filter((it) => it.state)
      .forEach((it) => url.addQueryParameter("genre[]", it.value));
    firstInstanceOrNull(filters, StatusFilter)
      ?.state.filter((it) => it.state)
      .forEach((it) => url.addQueryParameter("status[]", it.value));
    firstInstanceOrNull(filters, YearFilter)
      ?.state.filter((it) => it.state)
      .forEach((it) => url.addQueryParameter("year[]", it.value));

    const minChap = firstInstanceOrNull(filters, MinChapterFilter)?.selectedValue;
    if (minChap) url.addQueryParameter("minchap", minChap);

    const sort = firstInstanceOrNull(filters, SortFilter)?.selectedValue;
    if (sort != null) url.addQueryParameter("sort", sort);

    return this.parseMangasPage((await this.client.get(url.build().toString())).asJsoup());
  }

  private parseMangasPage(document: Document): MangasPage {
    const mangas = document.select(".original.card-lg .unit").flatMap((element) => {
      const poster = element.selectFirst("a.poster");
      if (!poster) return [];
      const title = element.selectFirst(".info > a")?.text();
      if (title == null) throw new Error("Missing title");
      const manga = SManga.create();
      manga.url = urlWithoutDomain(poster.attr("abs:href"));
      manga.title = title;
      manga.thumbnail_url = this.imageUrlOf(poster.selectFirst("img"));
      return [manga];
    });

    const hasNext = document.selectFirst(".pagination a[rel=next]") != null;
    return new MangasPage(mangas, hasNext);
  }

  protected async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url = HttpUrl.parse(u.toString());
    if (url.host.toLowerCase() !== new URL(this.baseUrl).host.toLowerCase() && url.host.toLowerCase() !== "bbato.com") return null;

    let mangaUrl: string;
    if (url.encodedPath.startsWith("/manga/")) mangaUrl = removeSuffix(url.encodedPath, "/");
    else if (url.encodedPath.startsWith("/read/")) {
      const slug = substringBefore(url.encodedPath.slice("/read/".length), "/");
      mangaUrl = `/manga/${slug}`;
    } else return null;

    const document = (await this.client.get(`${this.baseUrl}${mangaUrl}`)).asJsoup();
    const title = document.selectFirst("h1[itemprop=name]")?.text();
    if (title == null) return null;
    const manga = this.parseDetails(document, title);
    manga.url = urlWithoutDomain(mangaUrl);
    return manga;
  }

  // ============================== Details & Chapters ==============================

  private readonly dateTimeFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

  private parseDetails(document: Document, title: string): SManga {
    const manga = SManga.create();
    manga.title = title;
    manga.author = document
      .select(".meta div:has(span:contains(Author)) a")
      .map((it) => it.text())
      .join(", ");
    manga.description = document.selectFirst(".description")?.text();
    manga.genre = document
      .select(".meta div:has(span:contains(Genres)) a")
      .map((it) => it.text())
      .join(", ");
    manga.status = this.toStatus(document.selectFirst(".info > p")?.text());
    manga.thumbnail_url = this.imageUrlOf(document.selectFirst(".poster img"));
    manga.initialized = true;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let updatedManga = manga;
    if (fetchDetails) {
      const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
      const title = document.selectFirst("h1[itemprop=name]")?.text();
      if (title == null) throw new Error("Missing title");
      updatedManga = this.parseDetails(document, title);
      updatedManga.url = manga.url;
    }

    let updatedChapters = chapters;
    if (fetchChapters) {
      const slug = substringAfterLast(removeSuffix(manga.url, "/"), "/");
      const chapterHeaders = this.headersBuilder();
      chapterHeaders.append("X-Requested-With", "XMLHttpRequest");
      const responseDto = (await this.client.get(`${this.baseUrl}/get-chapter-list?slug=${slug}`, chapterHeaders)).parseAs<ChapterListResponse>();
      updatedChapters = toSChapterList(responseDto, slug, this.dateTimeFormat);
    }

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private toStatus(s: string | null | undefined): number {
    switch (s?.trim()?.toLowerCase()) {
      case "ongoing":
      case "releasing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      case "on hiatus":
      case "on_hiatus":
        return SManga.ON_HIATUS;
      case "discontinued":
      case "cancelled":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();

    return document.select(".pages .page:not(.notice-page) img").flatMap((img, index) => {
      const url = this.imageUrlOf(img);
      return url ? [new Page(index, "", url)] : [];
    });
  }

  // ============================== Filters ==============================

  getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  // ============================= Utilities =============================

  private imageUrlOf(element: Element | null): string | undefined {
    if (!element) return undefined;
    const url = element.attr("abs:data-src") || element.attr("abs:src");
    return url.length > 0 ? url : undefined;
  }
}
