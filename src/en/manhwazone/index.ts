// Port of keiyoushi/extensions-source src/en/manhwazone/ManhwaZone.kt
import {
  DateTimeFormatter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseAs,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
} from "../../../sdk/index.ts";
import type { ChapterDto, LivewireRequestDto, LivewireUpdateDto, SnapshotDto } from "./dto.ts";
import { GenreFilterGroup, SortFilter, StatusFilter, getGenreList } from "./filters.ts";

const authorRegex = /"author":\s*\[\s*\{"@type":"Person","name":"([^"]+)"/;

export default class ManhwaZone extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ENGLISH);

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/series?sortBy=popularity&page=${page}`)).asJsoup());
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/series?sortBy=latest&page=${page}`)).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname || !url.pathname.startsWith("/series/")) return null;

    const manga = this.parseMangaDetails((await this.client.get(url)).asJsoup());
    manga.url = url.pathname;
    return manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/series`).newBuilder().addQueryParameter("page", String(page));

    if (query.trim()) url.addQueryParameter("keyword", query);

    for (const filter of filters) {
      if (filter instanceof SortFilter) {
        url.addQueryParameter("sortBy", filter.toUriPart());
      } else if (filter instanceof StatusFilter) {
        const status = filter.toUriPart();
        if (status.length > 0) url.addQueryParameter("status", status);
      } else if (filter instanceof GenreFilterGroup) {
        const selectedGenres = filter.state.filter((it) => it.state).map((it) => it.slug);
        if (selectedGenres.length > 0) url.addQueryParameter("genres", selectedGenres.join("_"));
      }
    }

    return this.parseMangaList((await this.client.get(url.build().toString())).asJsoup());
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select("article.group").map((element) => {
      const manga = SManga.create();
      manga.title = element.selectFirst(".min-w-0 > a.font-semibold")!.text();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      return manga;
    });
    const hasNextPage = document.selectFirst("a[rel=next], nav a:contains(›)") != null || mangas.length >= 24;
    return new MangasPage(mangas, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const updatedManga = this.parseMangaDetails(document);
    updatedManga.url = manga.url;
    const chapterList = fetchChapters ? await this.fetchChapterList(document) : chapters;

    return new SMangaUpdate(updatedManga, chapterList);
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();

    manga.title = document.selectFirst("h1.page-title")!.text();
    manga.description = document.selectFirst("p.page-subtitle")?.text();
    manga.thumbnail_url = document.selectFirst("img.aspect-\\[7\\/10\\], figure.relative img")?.attr("abs:src");
    manga.genre = document
      .select("a.badge-genre")
      .map((it) => it.text())
      .join(", ");

    const statusText = document.selectFirst("span.badge-sm, span:contains(On Going), span:contains(Completed)")?.text().trim();
    switch (statusText?.toLowerCase()) {
      case "on going":
      case "ongoing":
      case "currently publishing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
      case "finished":
        manga.status = SManga.COMPLETED;
        break;
      case "on hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      case "discontinued":
      case "cancelled":
        manga.status = SManga.CANCELLED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }

    const jsonLd = document.selectFirst("script[type=application/ld+json]")?.data();
    if (jsonLd != null) {
      const authorMatch = authorRegex.exec(jsonLd)?.[1];
      if (authorMatch !== undefined && authorMatch.toLowerCase() !== "unknown") manga.author = authorMatch;
    }

    return manga;
  }

  private get jsonHeaders(): Headers {
    const h = new Headers(this.headers);
    h.append("Accept", "application/json");
    h.set("Content-Type", "application/json");
    return h;
  }

  private async fetchChapterList(document: Document): Promise<SChapter[]> {
    const wireDiv = document.selectFirst("div[wire:snapshot][wire:id][wire:init=bootLoad]");
    if (!wireDiv) return [];

    const csrfToken = document.selectFirst("meta[name=csrf-token]")?.attr("content") ?? "";
    const snapshot = wireDiv.attr("wire:snapshot");

    const payload: LivewireRequestDto = {
      _token: csrfToken,
      components: [{ snapshot, updates: {}, calls: [{ path: "", method: "bootLoad", params: [] }] }],
    };

    const postResponse = await this.client.post(`${this.baseUrl}/livewire/update`, this.jsonHeaders, JSON.stringify(payload), { ensureSuccess: false });
    if (!postResponse.isSuccessful) return [];

    const updateDto = postResponse.parseAs<LivewireUpdateDto>();
    const snapshotStr = updateDto.components?.[0]?.snapshot;
    if (snapshotStr == null) return [];
    const snapshotDto = parseAs<SnapshotDto>(snapshotStr);

    // Livewire serializes collections as [value, meta] tuples
    const actualChapters = snapshotDto.data?.chapters?.[0] as unknown[][] | undefined;
    if (actualChapters == null) return [];

    const out: SChapter[] = [];
    for (const chapterTuple of actualChapters) {
      const chapterDto = chapterTuple[0] as ChapterDto | undefined;
      if (chapterDto == null) continue;
      const webUrl = chapterDto.web_url;
      if (webUrl == null) continue;

      const chapter = SChapter.create();
      chapter.url = webUrl;
      chapter.name = chapterDto.name ?? "Chapter";
      chapter.date_upload = this.dateFormat.tryParseDateTime(chapterDto.published);
      out.push(chapter);
    }
    return out;
  }

  // The __RS_CONF__ image host (img.mangalaxy.net) no longer resolves; the page also lists the images directly
  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.getChapterUrl(chapter)))
      .asJsoup()
      .select("img.lazy-image[data-src]")
      .map((element, i) => new Page(i, "", element.attr("abs:data-src")));
  }

  // The image CDN answers 403 when the Referer is the site
  override imageRequest(page: Page) {
    const request = super.imageRequest(page);
    const headers = new Headers(request.headers);
    headers.delete("Referer");
    return { ...request, headers };
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new StatusFilter(), new GenreFilterGroup(getGenreList()));
  }
}
