// Port of keiyoushi/extensions-source src/all/manhwa18net/Manhwa18Net.kt
import { FilterList, HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, parseHtml, substringAfterLast, tryParseInstant, type ClientBuilder, type Response } from "../../../sdk/index.ts";
import type { PageDto } from "./dto.ts";
import { SortFilter, StatusFilter, getFilters } from "./filters.ts";

export default class Manhwa18Net extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  private extractPageDto(response: Response): PageDto {
    const document = response.asJsoup();
    const app = document.selectFirst("#app");
    if (app == null) throw new Error("Could not find #app element");
    const data = app.attr("data-page");
    if (data.trim() === "") throw new Error("data-page attribute is empty");
    return JSON.parse(data) as PageDto;
  }

  // ============================================================
  // LISTS
  // ============================================================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseList(await this.client.get(`${this.baseUrl}/manga-list?sort=top&page=${page}`));
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseList(await this.client.get(`${this.baseUrl}/manga-list?sort=update&page=${page}`));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = query.length > 0 ? HttpUrl.parse(`${this.baseUrl}/tim-kiem`).newBuilder().addQueryParameter("q", query) : HttpUrl.parse(`${this.baseUrl}/manga-list`).newBuilder();

    builder.addQueryParameter("page", String(page));

    for (const filter of filters) {
      if (filter instanceof SortFilter) builder.addQueryParameter("sort", filter.toUriPart());
      else if (filter instanceof StatusFilter) {
        for (const status of filter.state) if (status.state) builder.addQueryParameter(status.uriParam, "1");
      }
    }

    return this.parseList(await this.client.get(builder.build().toString()));
  }

  private parseList(response: Response): MangasPage {
    const props = this.extractPageDto(response).props;

    const listing = props.paginate ?? props.popularManga ?? props.mangas ?? props.latestManhwaMain;
    if (listing == null) throw new Error("No manga listing found in response");

    const mangas = listing.data.map((m) => {
      const manga = SManga.create();
      manga.title = m.name;
      manga.url = `/manga/${m.slug}`;
      manga.thumbnail_url = this.fixImageUrl(m.cover_url ?? m.thumb_url) ?? undefined;
      return manga;
    });

    return new MangasPage(mangas, listing.next_page_url != null);
  }

  // ============================================================
  // FILTERS
  // ============================================================

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  // ============================================================
  // DETAILS + CHAPTER LIST
  // ============================================================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const props = this.extractPageDto(await this.client.get(this.getMangaUrl(manga))).props;

    if (fetchDetails && props.manga == null) throw new Error("Manga details not found");
    if (fetchChapters && props.chapters == null) throw new Error("Chapters not found");

    let newManga = manga;
    const mangaDto = props.manga;
    if (mangaDto != null) {
      newManga = SManga.create();
      newManga.title = mangaDto.name;

      const html = mangaDto.pilot ?? mangaDto.description;
      newManga.description = html != null ? parseHtml(this.host.load, html, "").text() : undefined;

      newManga.thumbnail_url = this.fixImageUrl(mangaDto.cover_url ?? mangaDto.thumb_url) ?? undefined;

      newManga.genre = mangaDto.genres?.map((it) => it.name).join(", ");

      const author = mangaDto.artists?.map((it) => it.name).join(", ");
      newManga.author = author == null || author.length === 0 ? undefined : author;

      newManga.artist = newManga.author;

      switch (mangaDto.status_id) {
        case 0:
          newManga.status = SManga.ONGOING;
          break;
        case 1:
        case 2:
          newManga.status = SManga.COMPLETED;
          break;
        default:
          newManga.status = SManga.UNKNOWN;
      }
    }

    const mangaSlug = props.manga?.slug ?? substringAfterLast(manga.url, "/");
    const newChapters =
      props.chapters?.map((c) => {
        const chapter = SChapter.create();
        chapter.name = c.name;
        chapter.url = `/manga/${mangaSlug}/${c.slug}`;
        chapter.date_upload = tryParseInstant(c.created_at);
        return chapter;
      }) ?? chapters;

    return new SMangaUpdate(newManga, newChapters);
  }

  // ============================================================
  // PAGE LIST
  // ============================================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const props = this.extractPageDto(await this.client.get(this.getChapterUrl(chapter))).props;
    const chapterContent = props.chapterContent;
    if (chapterContent == null) throw new Error("Chapter content not found");

    const contentDoc = parseHtml(this.host.load, chapterContent, "");
    const images = contentDoc.select("img");

    const pages: Page[] = [];
    images.forEach((img, index) => {
      let src = img.attr("src");
      if (src.trim() === "") src = img.attr("data-src");
      if (src.trim() === "") src = img.attr("data-lazy-src");

      const fixed = this.fixImageUrl(src);
      if (fixed != null) pages.push(new Page(index, "", fixed));
    });
    return pages;
  }

  // ============================================================
  // UTIL
  // ============================================================

  private fixImageUrl(url: string | null | undefined): string | null {
    if (url == null || url.trim() === "") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return this.baseUrl + url;
    return `${this.baseUrl}/${url}`;
  }
}
