// Port of keiyoushi/extensions-source lib-multisrc/ezmanhwa/EZManhwa.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  isNotBlank,
  parseHtml,
  toHttpUrl,
  type HttpUrl,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";
import { chapterToSChapter, type EZManhwaChapterDto, type EZManhwaChapterListDto, type EZManhwaPageListDto, type EZManhwaSeriesDto, type EZManhwaSeriesListDto } from "./dto.ts";
import { EZManhwaSortFilter, EZManhwaStatusFilter, EZManhwaTypeFilter } from "./filters.ts";

export const SHOW_LOCKED_CHAPTER_PREF_KEY = "pref_show_locked_chapters";

export abstract class EZManhwa extends KeiSource {
  abstract readonly apiUrl: string;

  protected override configureHeaders(headers: Headers): Headers {
    return this.addEZManhwaHeaders(headers);
  }

  protected addEZManhwaHeaders(headers: Headers): Headers {
    headers.set("Accept", "application/json, text/plain, */*");
    return headers;
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  // Chapter URLs are stored as: series/{seriesSlug}/chapters/{chapterSlug}
  // The website drops "chapters/" from the path, so we strip it here.
  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/${chapter.url.replaceAll("/chapters/", "/")}`;
  }

  // ── Browse ───────────────────────────────────────────────────────────────

  override async getPopularManga(page: number) {
    return this.parseSeriesList(await this.client.get(`${this.apiUrl}/series?page=${page}&perPage=20&sort=popular`));
  }

  override async getLatestUpdates(page: number) {
    return this.parseSeriesList(await this.client.get(`${this.apiUrl}/series?page=${page}&perPage=20&sort=latest`));
  }

  private parseSeriesList(response: Response): MangasPage {
    const dto = response.parseAs<EZManhwaSeriesListDto>();
    const mangas = dto.data.filter((it) => it.type !== "NOVEL").map((it) => this.toSManga(it));
    return new MangasPage(mangas, dto.current < dto.totalPages);
  }

  // ── Search ───────────────────────────────────────────────────────────────

  override async getSearchMangaList(page: number, query: string, filters: FilterList) {
    return this.parseSeriesList(await this.client.get(this.searchMangaUrl(page, query, filters).toString()));
  }

  // Base implementation sends filters only during browse.
  // Override if the source's search endpoint behaviour differs.
  protected searchMangaUrl(page: number, query: string, filters: FilterList): HttpUrl {
    const isSearch = isNotBlank(query);
    const endpoint = isSearch ? `${this.apiUrl}/series/search` : `${this.apiUrl}/series`;
    const b = toHttpUrl(endpoint).newBuilder();
    b.addQueryParameter("page", String(page));
    b.addQueryParameter("perPage", "20");
    if (isSearch) {
      b.addQueryParameter("q", query);
    } else {
      let sortAdded = false;
      for (const filter of filters) {
        if (filter instanceof EZManhwaSortFilter) {
          b.addQueryParameter("sort", filter.value);
          sortAdded = true;
        } else if (filter instanceof EZManhwaStatusFilter) {
          if (isNotBlank(filter.value)) b.addQueryParameter("status", filter.value);
        } else if (filter instanceof EZManhwaTypeFilter) {
          if (isNotBlank(filter.value)) b.addQueryParameter("type", filter.value);
        }
      }
      if (!sortAdded) b.addQueryParameter("sort", "latest");
    }
    return b.build();
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || pathSegments[0] !== "series") return null;
    const slug = pathSegments[1];
    if (slug == null) return null;

    return this.toSManga((await this.client.get(`${this.apiUrl}/series/${slug}`)).parseAs<EZManhwaSeriesDto>());
  }

  // ── Details ──────────────────────────────────────────────────────────────

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(`${this.apiUrl}/series/${manga.url}`).then((r) => this.toSManga(r.parseAs<EZManhwaSeriesDto>())) : manga,
      fetchChapters ? this.fetchChapterList(manga.url) : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  // ── Chapters ─────────────────────────────────────────────────────────────

  private async fetchChapterList(seriesSlug: string): Promise<SChapter[]> {
    const url = toHttpUrl(`${this.apiUrl}/series/${seriesSlug}/chapters?page=1&perPage=100&sort=desc`);
    const initialData = (await this.client.get(url.toString())).parseAs<EZManhwaChapterListDto>();
    const chapters: SChapter[] = [];

    const parsePage = (dto: EZManhwaChapterListDto) => {
      for (const it of dto.data) if (this.shouldShowChapter(it)) chapters.push(chapterToSChapter(it, seriesSlug));
    };

    parsePage(initialData);
    let curr = initialData.current ?? 1;
    const totalPages = initialData.totalPages ?? 1;
    while (curr < totalPages) {
      curr++;
      const nextUrl = url.newBuilder().setQueryParameter("page", String(curr)).build();
      parsePage((await this.client.get(nextUrl.toString())).parseAs<EZManhwaChapterListDto>());
    }
    return chapters;
  }

  shouldShowChapter(chapter: EZManhwaChapterDto): boolean {
    return chapter.requiresPurchase !== true || this.preferences.getBoolean(SHOW_LOCKED_CHAPTER_PREF_KEY, false);
  }

  // ── Pages ────────────────────────────────────────────────────────────────

  protected pageListUrl(chapter: SChapter) {
    return `${this.apiUrl}/${chapter.url}`;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const data = (await this.client.get(this.pageListUrl(chapter))).parseAs<EZManhwaPageListDto>();
    if (data.requiresPurchase === true) {
      throw new Error(`Chapter requires purchase (${data.totalImages} pages). ` + "Log in via webview and purchase to read.");
    }
    if (data.images == null) throw new Error("No images found. Chapter may be locked or require login via webview.");
    return data.images.map((img, i) => new Page(i, "", img.url));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new EZManhwaSortFilter(), new EZManhwaStatusFilter(), new EZManhwaTypeFilter());
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = SHOW_LOCKED_CHAPTER_PREF_KEY;
    p.title = "Show locked chapters";
    p.summary = "Show chapters requiring coins. Note: They only load if owned/logged in via webview.";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  /** EZManhwaSeriesDto.toSManga(); a method here because Jsoup.parse needs the host's parser. */
  protected toSManga(dto: EZManhwaSeriesDto): SManga {
    const manga = SManga.create();
    manga.url = dto.slug;
    manga.title = dto.title;
    manga.thumbnail_url = dto.cover ?? undefined;
    manga.author = dto.author?.trim() || undefined;
    manga.artist = dto.artist?.trim() || undefined;
    let description = "";
    if (dto.description != null) description += parseHtml(this.host.load, dto.description, this.baseUrl).text();
    if (isNotBlank(dto.alternativeTitles)) description += `\n\nAlternative Titles: ${dto.alternativeTitles}`;
    manga.description = description.trim() || undefined;
    manga.genre = dto.genres?.map((it) => it.name).join(", ");
    switch (dto.status) {
      case "ONGOING":
      case "MASS_RELEASED":
        manga.status = SManga.ONGOING;
        break;
      case "COMPLETED":
        manga.status = SManga.COMPLETED;
        break;
      case "DROPPED":
        manga.status = SManga.CANCELLED;
        break;
      case "HIATUS":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }
}
