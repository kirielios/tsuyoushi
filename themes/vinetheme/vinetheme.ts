// Port of keiyoushi/extensions-source lib-multisrc/vinetheme/VineTheme.kt (with Dto.kt)
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  PreferenceScreen,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  distinctBy,
  extractNextJs,
  hasKeys,
  toHttpUrl,
  tryParseInstant,
  type Filter,
} from "../../sdk/index.ts";
import { GenreFilter, OriginFilter, SortFilter, StatusFilter, TypeFilter, isUriQueryFilter } from "./filters.ts";

// ---- Dto.kt (kotlinx defaults are applied where the fields are read)
interface ApiSeriesResponse {
  data?: MangaDto[];
  meta?: { hasMore?: boolean } | null;
}
interface GenreListDto {
  genres?: GenreDto[];
}
interface DetailDto {
  series: MangaDto;
  chapters?: ChapterDto[];
  totalPages?: number;
}
interface ChapterDetailDto {
  chapter: { pages?: { imageUrl?: string | null; kind?: string }[] };
}
interface MangaDto {
  id: string;
  title: string;
  coverImage?: string | null; // coverUrl
  slug?: string;
  status?: string;
  type?: string;
  origin?: string;
  rating?: number;
  isHot?: boolean;
  isMature?: boolean;
  salePercent?: number | null;
  originalTitle?: string | null;
  aliases?: string[];
  description?: string | null;
  genres?: GenreDto[];
  team?: { name?: string | null } | null;
  similarSeries?: MangaDto[];
}
interface GenreDto {
  name?: string;
  slug?: string;
  genre?: { slug?: string } | null;
}
interface ChapterDto {
  id: string;
  number: number;
  title?: string | null;
  publishedAt?: string | null;
  isLocked?: boolean;
}

const genreDisplayName = (g: GenreDto) => stripEmoji(g.name?.trim() ? g.name : (g.genre?.slug ?? ""));
const genreSlug = (g: GenreDto) => (g.slug?.trim() ? g.slug : (g.genre?.slug ?? ""));

/** Kotlin's Double.toString(): whole numbers keep ".0". */
const kotlinDouble = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function toSMangaStatus(s: string): number {
  switch (s) {
    case "ONGOING":
      return SManga.ONGOING;
    case "COMPLETED":
      return SManga.COMPLETED;
    case "HIATUS":
      return SManga.ON_HIATUS;
    case "CANCELLED":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

export const stripEmoji = (s: string) => s.replace(/[^\x00-\x7F\p{L}0-9\- ]+/gu, "").trim();

const toAbsoluteUrl = (s: string, baseUrl: string) => (s.startsWith("http") ? s : `${baseUrl}${s}`);

const HIDE_LOCKED_PREF = "pref_hide_locked_chapters";
const isDetail = hasKeys("series", "chapters");

export abstract class VineTheme extends KeiSource {
  private get rscHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = HIDE_LOCKED_PREF;
    pref.title = "Hide locked chapters";
    pref.summary = "Hide chapters that require coins to read";
    pref.setDefaultValue(true);
    screen.addPreference(pref);
  }

  // ---- MangaDto.toSManga / ChapterDto.toSChapter / String.htmlToText
  protected toSManga(dto: MangaDto, manga: SManga = SManga.create()): SManga {
    const type = dto.type ?? "";
    const origin = dto.origin ?? "";
    const rating = dto.rating ?? 0;
    manga.title = dto.title;
    manga.thumbnail_url = dto.coverImage != null ? toAbsoluteUrl(dto.coverImage, this.baseUrl) : undefined;
    manga.url = dto.id;
    manga.memo = { id: dto.id, slug: dto.slug ?? "" };
    manga.status = toSMangaStatus(dto.status ?? "");
    manga.author = dto.team?.name ?? undefined;
    const genres: string[] = [];
    if (type.trim()) genres.push(type);
    if (origin.trim()) genres.push(origin);
    if (dto.isMature) genres.push("Mature");
    genres.push(...(dto.genres ?? []).map(genreDisplayName));
    manga.genre = [...new Set(genres)].join(", ");

    let description = "";
    if (dto.description != null) description += this.htmlToText(dto.description);
    const info: string[] = [];
    if (rating > 0) info.push(`Rating: ${kotlinDouble(rating)}`);
    if (type.trim()) info.push(`Type: ${type}`);
    if (origin.trim()) info.push(`Origin: ${origin}`);
    if (dto.isHot) info.push("Featured");
    if (dto.isMature) info.push("Mature");
    if (dto.salePercent != null && dto.salePercent > 0) info.push(`Sale: ${dto.salePercent}%`);
    if (info.length) {
      if (description) description += "\n\n";
      description += info.join("\n");
    }
    const altTitles = distinctBy(
      [...(dto.originalTitle != null ? [dto.originalTitle] : []), ...(dto.aliases ?? [])].map((it) => it.trim()).filter((it) => it && it.toLowerCase() !== dto.title.toLowerCase()),
      (it) => it,
    );
    if (altTitles.length) {
      if (description) description += "\n\n";
      description += "Alternative titles: \n";
      description += altTitles.map((it) => `- ${it}`).join("\n");
    }
    manga.description = description || undefined;
    return manga;
  }

  protected toSChapter(dto: ChapterDto, manga: SManga): SChapter {
    const chapter = SChapter.create();
    const isLocked = dto.isLocked ?? false;
    const numberString = kotlinDouble(dto.number).replace(/\.0$/, "");
    chapter.name = !dto.title?.trim() || dto.title === numberString ? `Chapter ${numberString}` : dto.title;
    if (isLocked) chapter.name = `🔒 ${chapter.name}`;
    chapter.date_upload = tryParseInstant(dto.publishedAt);
    chapter.chapter_number = dto.number;
    const mangaSlug = typeof manga.memo["slug"] === "string" ? manga.memo["slug"] : "";
    chapter.url = dto.id;
    chapter.memo = { id: dto.id, slug: mangaSlug, number: numberString, isLocked };
    return chapter;
  }

  private htmlToText(html: string): string {
    const $ = this.host.load(html);
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    $("a[href]").each((_, link) => {
      let url = "";
      try {
        url = new URL(($(link).attr("href") ?? "").trim(), this.baseUrl).href;
      } catch {
        /* Jsoup's absUrl gives "" */
      }
      const text = $(link).text().replace(/\s+/g, " ").trim();
      $(link).replaceWith(escape(text ? `[${text}](${url})` : url));
    });
    $("p").after("\n\n");
    $("br").replaceWith("\n");
    return $.root().text().trim();
  }

  // ------------------------- Browse (Popular) -------------------------

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getApiMangasPage(page, "popular");
  }

  // ------------------------- Latest -------------------------

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getApiMangasPage(page, "updated");
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) throw new Error("Unsupported url");
    const pathSegments = url.pathname.slice(1).split("/");
    const slug = pathSegments[2];
    if (slug == null) return null;
    if (pathSegments[3] === "chapter") return null;
    const detail = extractNextJs<DetailDto>(await this.client.get(`${this.baseUrl}/series/comic/${slug}`, this.rscHeaders), isDetail);
    if (detail == null) return null;
    return this.toSManga(detail.series);
  }

  private async getApiMangasPage(page: number, sort: string): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/series`)
      .newBuilder()
      .addQueryParameter("sort", sort)
      .addQueryParameter("contentMode", "comics")
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", "24")
      .build();
    const data = (await this.client.get(url.toString())).parseAs<ApiSeriesResponse>();
    return new MangasPage((data.data ?? []).map((it) => this.toSManga(it)), data.meta?.hasMore === true);
  }

  // ------------------------- Search -------------------------

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/api/series`).newBuilder();
    builder.addQueryParameter("limit", "24");
    builder.addQueryParameter("contentMode", "comics");
    if (query) builder.addQueryParameter("q", query);
    filters.filter(isUriQueryFilter).forEach((it) => it.addToQuery(builder));
    builder.addQueryParameter("page", String(page));
    const data = (await this.client.get(builder.build().toString())).parseAs<ApiSeriesResponse>();
    return new MangasPage((data.data ?? []).map((it) => this.toSManga(it)), data.meta?.hasMore === true);
  }

  // ------------------------- Filter -------------------------

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.baseUrl}/api/genres`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as GenreListDto | null)?.genres;
    const list: Filter[] = [new SortFilter(), new StatusFilter(), new TypeFilter(), new OriginFilter()];
    if (genres?.length) list.push(new GenreFilter(genres.map((it) => [stripEmoji(it.name ?? ""), genreSlug(it)])));
    return list;
  }

  // ------------------------- Details + Chapters -------------------------

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const detailsUrl = toHttpUrl(this.getMangaUrl(manga)).newBuilder().addQueryParameter("sort", "desc").build();
    const details = extractNextJs<DetailDto>(await this.client.get(detailsUrl.toString(), this.rscHeaders), isDetail);

    const updatedManga = details?.series != null ? this.toSManga(details.series, manga) : manga;
    const updatedChapters = fetchChapters ? await this.fetchAllChapters(manga, details, chapters) : chapters;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const detailsUrl = toHttpUrl(this.getMangaUrl(manga)).newBuilder().addQueryParameter("sort", "desc").build();
    const series = extractNextJs<{ similarSeries?: MangaDto[] }>(await this.client.get(detailsUrl.toString(), this.rscHeaders), hasKeys("similarSeries"));
    return (series?.similarSeries ?? []).map((it) => this.toSManga(it));
  }

  private async fetchAllChapters(manga: SManga, details: DetailDto | null, existing: SChapter[]): Promise<SChapter[]> {
    if (details == null) return [];
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF, true);
    const totalPages = details.totalPages ?? 1;
    let allChapters = details.chapters ?? [];
    if (existing.length === 0 && totalPages > 1) {
      for (let page = 2; page <= totalPages; page++) {
        const url = toHttpUrl(this.getMangaUrl(manga)).newBuilder().addQueryParameter("sort", "desc").addQueryParameter("page", String(page)).build();
        const more = extractNextJs<DetailDto>(await this.client.get(url.toString(), this.rscHeaders), isDetail);
        allChapters = allChapters.concat(more?.chapters ?? []);
      }
    }
    const fetched = allChapters.filter((it) => !((it.isLocked ?? false) && hideLocked)).map((it) => this.toSChapter(it, manga));
    const retained = existing.filter((it) => !(hideLocked && it.memo["isLocked"] === true));
    return distinctBy([...fetched, ...retained], (it) => it.url).sort((a, b) => b.chapter_number - a.chapter_number);
  }

  // ------------------------- Pages -------------------------

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.memo["isLocked"] === true) throw new Error("This chapter is locked and requires coins to read");
    const response = await this.client.get(this.getChapterUrl(chapter), this.rscHeaders);
    const dto = extractNextJs<ChapterDetailDto>(response, hasKeys("chapter"));
    const pages: Page[] = [];
    (dto?.chapter?.pages ?? []).forEach((pageDto, index) => {
      if (pageDto.imageUrl != null) pages.push(new Page(index, "", toAbsoluteUrl(pageDto.imageUrl, this.baseUrl)));
    });
    return pages;
  }

  // ------------------------- URL helpers -------------------------

  override getMangaUrl(manga: SManga): string {
    const slug = typeof manga.memo["slug"] === "string" ? manga.memo["slug"] : "";
    return `${this.baseUrl}/series/comic/${slug}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const slug = String(chapter.memo["slug"]);
    const number = String(chapter.memo["number"]);
    return `${this.baseUrl}/series/comic/${slug}/chapter/${number}`;
  }
}
