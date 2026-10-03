// Port of keiyoushi/extensions-source src/en/mgreadio/MgreadIo.kt
import {
  Filter,
  KeiSource,
  MangasPage,
  Page,
  SManga,
  SMangaUpdate,
  distinctBy,
  isBlank,
  parseHtml,
  substringAfter,
  substringBefore,
  toHttpUrl,
  type Document,
  type Element,
  type FilterList,
  type SChapter,
} from "../../../sdk/index.ts";
import { toSChapter, type ChapterListDto, type MgreadSearchDto } from "./dto.ts";
import { AgeRatingFilter, GenreFilter, RatingMaxFilter, RatingMinFilter, SortFilter, StatusFilter, TypeFilter, addFilters, type GenreOption } from "./filters.ts";

const MANGA_ID_MEMO = "mangaId";

export default class MgreadIo extends KeiSource {
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.mangasPageFromHtml((await this.client.get(this.pageUrl("manga-ranking", page))).asJsoup());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.mangasPageFromHtml((await this.client.get(this.pageUrl("recently-updated", page))).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (!isBlank(query)) {
      const url = toHttpUrl(`${this.baseUrl}/wp-json/initlise/v1/search`).newBuilder().addQueryParameter("term", query.trim()).addQueryParameter("page", String(page)).build();
      const dtos = (await this.client.get(url.toString())).parseAs<MgreadSearchDto[]>();
      return this.withoutAnimeEntries(new MangasPage(dtos.map((it) => this.mangaFromSearchDto(it)).filter((it): it is SManga => it !== null), false));
    }

    const builder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("advanced-filter");
    if (page > 1) {
      builder.addPathSegment("page");
      builder.addPathSegment(String(page));
    }
    builder.addPathSegment("");
    addFilters(builder, filters);
    const url = builder.build();

    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = distinctBy(
      document.select(".manga-item-grid, .manga-item-details").map((it) => this.mangaFromGridElement(it)),
      (it) => it.url,
    );
    return this.withoutAnimeEntries(new MangasPage(mangas, document.selectFirst("li:not(.uk-disabled) > a[aria-label='Next page']") != null));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname || !url.pathname.startsWith("/manga/")) return null;
    return this.mangaDetailsFromHtml((await this.client.get(url)).asJsoup());
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    return (await this.client.get(this.getMangaUrl(manga)))
      .asJsoup()
      .select(".manga-block:has(> h2:contains(Related Manga)) .manga-item-slider")
      .map((it) => this.mangaFromRelatedElement(it));
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const mangaId = manga.memo[MANGA_ID_MEMO];
    if (typeof mangaId !== "number") {
      const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
      const updatedManga = this.mangaDetailsFromHtml(document);
      return new SMangaUpdate(updatedManga, fetchChapters ? await this.fetchChapterList(this.mangaIdOf(updatedManga), manga.url) : chapters);
    }

    const [updated, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(this.getMangaUrl(manga)).then((r) => this.mangaDetailsFromHtml(r.asJsoup())) : manga,
      fetchChapters ? this.fetchChapterList(mangaId, manga.url) : chapters,
    ]);
    return new SMangaUpdate(updated, chapterList);
  }

  private mangaDetailsFromHtml(document: Document): SManga {
    const manga = SManga.create();
    const title = document.selectFirst("#manga-title")?.ownText() ?? document.selectFirst("meta[property=og:title]")?.attr("content").split(" [Ch.")[0].trim();
    if (title == null) throw new Error("Title not found");
    manga.title = title;

    manga.thumbnail_url = this.imageUrl(document.selectFirst(".story-cover img, meta[property=og:image]")) ?? undefined;

    const descriptionText = document.selectFirst("#manga-description")?.wholeText().trim() ?? document.selectFirst("meta[name=description]")?.attr("content").trim();

    manga.genre = document
      .select("#genre-tags a[href*='/genre/']")
      .map((it) => (it.ownText().length > 0 ? it.ownText() : it.text()))
      .join(", ");

    manga.status = this.parseStatus(document.selectFirst("#manga-status")?.text());

    const metaRow = document.selectFirst("#manga-title + div");
    const metadata: string[] = [];
    const chaptersText = metaRow ? substringBefore(metaRow.ownText(), "Chapters").trim() : "";
    if (chaptersText.length > 0) metadata.push(`Chapters: ${chaptersText}`);

    const otherName = document.selectFirst("#comic-othername")?.text();
    if (otherName) metadata.push(`Alternative title: ${otherName}`);

    const reviewInfo = document.selectFirst(".init-review-info")?.text();
    if (reviewInfo) metadata.push(`Rating: ${reviewInfo}`);

    const views = metaRow?.selectFirst(".init-plugin-suite-view-count-number")?.text();
    if (views) metadata.push(`Views: ${views}`);

    const lastUpdated = document.selectFirst("#last-updated")?.text();
    if (lastUpdated) metadata.push(`Last updated: ${lastUpdated}`);

    let description = "";
    if (descriptionText != null) description += descriptionText;
    if (metadata.length > 0) {
      if (description.length > 0) description += "\n\n";
      description += metadata.join("\n");
    }
    manga.description = description;

    manga.url = toHttpUrl(document.location()).encodedPath;
    manga.memo = { [MANGA_ID_MEMO]: this.mangaIdOfDocument(document) };
    return manga;
  }

  private async fetchChapterList(mangaId: number, mangaPath: string): Promise<SChapter[]> {
    const firstPage = await this.fetchChapterPage(mangaId, 1);
    const totalPages = firstPage.total_pages ?? 1;
    const remainingPages = await Promise.all(Array.from({ length: Math.max(totalPages - 1, 0) }, (_, i) => this.fetchChapterPage(mangaId, i + 2)));

    return [firstPage, ...remainingPages].flatMap((page) => (page.items ?? []).map((it) => toSChapter(it, mangaPath)));
  }

  private async fetchChapterPage(mangaId: number, page: number): Promise<ChapterListDto> {
    const url = toHttpUrl(`${this.baseUrl}/wp-json/initmanga/v1/chapters`)
      .newBuilder()
      .addQueryParameter("manga_id", String(mangaId))
      .addQueryParameter("paged", String(page))
      .addQueryParameter("per_page", "50")
      .build();
    return (await this.client.get(url.toString())).parseAs<ChapterListDto>();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const chapterUrl = document.location();
    return document.select("#chapter-content img[data-original-src], #chapter-content img[src]").map((element, index) => {
      const original = element.absUrl("data-original-src");
      return new Page(index, chapterUrl, original.length > 0 ? original : element.absUrl("src"));
    });
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<GenreOption[]> {
    return (await this.client.get(`${this.baseUrl}/advanced-filter/`))
      .asJsoup()
      .select("input[name='genre[]'][data-genre-name][value]")
      .map((it) => ({ name: it.attr("data-genre-name"), id: it.attr("value") }));
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new Filter.Header("Filters are only applied when the search text is empty."), new TypeFilter(), new StatusFilter(), new AgeRatingFilter(), new RatingMinFilter(), new RatingMaxFilter(), new SortFilter()];
    const genres = data as GenreOption[] | null;
    if (genres && genres.length > 0) filters.push(new GenreFilter(genres));
    return filters;
  }

  // Helpers

  private pageUrl(slug: string, page: number): string {
    return page === 1 ? `${this.baseUrl}/${slug}/` : `${this.baseUrl}/${slug}/page/${page}/`;
  }

  private mangasPageFromHtml(document: Document): MangasPage {
    const mangas = document.select(".manga-item-grid").map((it) => this.mangaFromGridElement(it));
    const hasNextPage = document.selectFirst("li:not(.uk-disabled) > a[aria-label='Next page']") != null;
    return this.withoutAnimeEntries(new MangasPage(mangas, hasNextPage));
  }

  private mangaFromGridElement(element: Element): SManga {
    const manga = SManga.create();
    const titleElement = element.selectFirst("h2 a[href*='/manga/']") ?? element.selectFirst("a[href*='/manga/']:not([href*='/chapter-'])");
    if (!titleElement) throw new Error("Manga link not found in grid item");

    manga.title = titleElement.text();
    manga.url = toHttpUrl(titleElement.absUrl("href")).encodedPath;
    manga.thumbnail_url = this.imageUrl(element.selectFirst("img")) ?? undefined;
    return manga;
  }

  private mangaFromRelatedElement(element: Element): SManga {
    const manga = SManga.create();
    const link = element.selectFirst("a[href*='/manga/']");
    if (!link) throw new Error("Related manga link not found");
    const title = element.selectFirst("h3")?.text();
    if (title == null) throw new Error("Related manga title not found");
    manga.title = title;
    manga.url = toHttpUrl(link.absUrl("href")).encodedPath;
    manga.thumbnail_url = this.imageUrl(element.selectFirst("img")) ?? undefined;
    return manga;
  }

  private mangaFromSearchDto(dto: MgreadSearchDto): SManga | null {
    const parsedTitle = parseHtml(this.host.load, dto.title, "").text();
    const cleanUrl = dto.url.trim();
    if (cleanUrl.length === 0) return null;

    const manga = SManga.create();
    manga.title = parsedTitle;
    manga.thumbnail_url = dto.thumb ?? undefined;
    manga.url = toHttpUrl(cleanUrl).encodedPath;
    manga.memo = { [MANGA_ID_MEMO]: dto.id };
    return manga;
  }

  private isAnimeEntry(manga: SManga): boolean {
    const normalizedTitle = manga.title.toLowerCase();
    return normalizedTitle.startsWith("anime -") || normalizedTitle.startsWith("anime –") || substringAfter(manga.url, "/manga/", "").startsWith("anime-");
  }

  private withoutAnimeEntries(page: MangasPage): MangasPage {
    return new MangasPage(
      page.mangas.filter((it) => !this.isAnimeEntry(it)),
      page.hasNextPage,
    );
  }

  private imageUrl(element: Element | null): string | null {
    if (!element) return null;
    let value: string;
    if (element.tagName().toLowerCase() === "meta") value = element.attr("content");
    else {
      value = element.attr("abs:data-src");
      if (value.length === 0) {
        value = element.attr("abs:data-lazy-src");
        if (value.length === 0) value = element.attr("abs:src");
      }
    }
    return value.length > 0 ? value : null;
  }

  private parseStatus(status: string | null | undefined): number {
    switch (status?.toLowerCase().trim()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      case "season end":
      case "source hiatus":
      case "caught up":
        return SManga.ON_HIATUS;
      case "dropped":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private mangaIdOfDocument(document: Document): number {
    const element = document.selectFirst("#manga-title[data-id], #chapter-search-input[data-manga-id]");
    if (element) {
      const raw = element.attr("data-id").length > 0 ? element.attr("data-id") : element.attr("data-manga-id");
      if (/^[+-]?\d+$/.test(raw)) return Number.parseInt(raw, 10);
    }
    throw new Error("Manga ID not found");
  }

  private mangaIdOf(manga: SManga): number {
    const id = manga.memo[MANGA_ID_MEMO];
    if (typeof id !== "number") throw new Error("Manga ID not found");
    return id;
  }
}
