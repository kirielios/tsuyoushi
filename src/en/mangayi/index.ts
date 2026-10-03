// Port of keiyoushi/extensions-source src/en/mangayi/MangaYi.kt (+ Dto.kt)
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, ZoneId, urlWithoutDomain, type ClientBuilder, type Document, type FilterList } from "../../../sdk/index.ts";

interface SearchRequestDto {
  p?: number;
  s?: string;
  t?: number;
}

interface MangaDto {
  i: string; // slug
  t: string; // title
}

interface SearchResponseDto {
  results: MangaDto[];
  total: number;
}

const mangaToSManga = (dto: MangaDto): SManga => {
  const manga = SManga.create();
  manga.url = dto.i;
  manga.title = dto.t;
  manga.thumbnail_url = `https://scp.keterfoundation.com/cover/${dto.i}.jpg`;
  return manga;
};

const dateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH).withZone(ZoneId.of("UTC"));

export default class MangaYi extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2);
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const payload: SearchRequestDto = { p: page, t: 1 };
    return this.fetchMangasPage(payload, page);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const payload: SearchRequestDto = { p: page, s: query };
    return this.fetchMangasPage(payload, page);
  }

  private async fetchMangasPage(payload: SearchRequestDto, page: number): Promise<MangasPage> {
    // payload.toJsonRequestBody(): the source headers plus the JSON media type
    const headers = new Headers(this.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    const response = await this.client.post(`${this.baseUrl}/api/search`, headers, JSON.stringify(payload));
    const dto = response.parseAs<SearchResponseDto>();

    this.pageSize = Math.max(this.pageSize, dto.results.length);

    const mangas = dto.results.map(mangaToSManga);
    const hasNextPage = page * this.pageSize < dto.total;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Updates ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(`${this.baseUrl}/read/${manga.url}/`)).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.m-title")!.text();
    manga.author = document.selectFirst(".m-authors")?.text();
    manga.description = document
      .select(".m-summary p")
      .map((it) => it.text())
      .join("\n");
    manga.genre = document
      .select(".m-genres .pill")
      .map((it) => it.text())
      .join(", ");
    manga.status = this.parseStatus(document.selectFirst(".m-stat:contains(Status) .value")?.text());
    manga.thumbnail_url = document.selectFirst(".cover-wrap img.cover-image")?.absUrl("src");
    return manga;
  }

  private parseChapterList(document: Document): SChapter[] {
    return document.select("div.chapters-list a.c:not(.unreleased)").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = element.selectFirst(".t")!.text();
      chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".chapter-d")?.text());
      return chapter;
    });
  }

  private parseStatus(s: string | undefined): number {
    switch (s?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      case "hiatus":
      case "on hiatus":
        return SManga.ON_HIATUS;
      case "cancelled":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.c-images img").map((img, index) => new Page(index, "", img.absUrl("src")));
  }

  // ============================= Utilities =============================

  private pageSize = 24;
}
