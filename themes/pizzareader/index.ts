// Port of keiyoushi/extensions-source lib-multisrc/pizzareader/PizzaReader.kt (+ PizzaReaderDto.kt)
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, type FilterList } from "../../sdk/index.ts";

export interface PizzaResultsDto {
  comics?: PizzaComicDto[];
}
export interface PizzaResultDto {
  comic?: PizzaComicDto | null;
}
export interface PizzaReaderDto {
  chapter?: PizzaChapterDto | null;
}
export interface PizzaComicDto {
  artist?: string | null;
  author?: string | null;
  chapters?: PizzaChapterDto[];
  description?: string | null;
  genres?: PizzaGenreDto[];
  last_chapter?: PizzaChapterDto | null;
  status?: string | null;
  title?: string;
  thumbnail?: string;
  url?: string;
}
export interface PizzaGenreDto {
  name?: string;
}
export interface PizzaChapterDto {
  chapter?: number | null;
  full_title?: string;
  pages?: string[];
  published_on?: string;
  subchapter?: number | null;
  teams?: (PizzaTeamDto | null)[];
  url?: string;
}
export interface PizzaTeamDto {
  name?: string;
}

export abstract class PizzaReader extends KeiSource {
  protected apiPath = "/api";

  get apiUrl() {
    return `${this.baseUrl}${this.apiPath}`;
  }

  override async getPopularManga(_page: number): Promise<MangasPage> {
    const result = (await this.client.get(`${this.apiUrl}/comics`)).parseAs<PizzaResultsDto>();
    const comicList = (result.comics ?? []).map((it) => this.popularMangaFromObject(it));
    return new MangasPage(comicList, false);
  }

  protected popularMangaFromObject(comic: PizzaComicDto): SManga {
    const manga = SManga.create();
    manga.title = comic.title ?? "";
    manga.thumbnail_url = comic.thumbnail ?? "";
    manga.url = comic.url ?? "";
    return manga;
  }

  override async getLatestUpdates(_page: number): Promise<MangasPage> {
    const result = (await this.client.get(`${this.apiUrl}/comics`)).parseAs<PizzaResultsDto>();
    const pub = (c: PizzaComicDto) => c.last_chapter!.published_on ?? "";
    const comicList = (result.comics ?? [])
      .filter((comic) => comic.last_chapter != null)
      .sort((a, b) => (pub(a) < pub(b) ? 1 : pub(a) > pub(b) ? -1 : 0))
      .map((it) => this.popularMangaFromObject(it))
      .slice(0, 10);
    return new MangasPage(comicList, false);
  }

  override async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const searchUrl = toHttpUrl(`${this.apiUrl}/search/`).newBuilder().addPathSegment(query).toString();
    const result = (await this.client.get(searchUrl)).parseAs<PizzaResultsDto>();
    const comicList = (result.comics ?? []).map((it) => this.popularMangaFromObject(it));
    return new MangasPage(comicList, false);
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const result = (await this.client.get(this.apiUrl + manga.url)).parseAs<PizzaResultDto>();

    const comic = result.comic!;
    const sManga = SManga.create();
    sManga.title = comic.title ?? "";
    sManga.author = comic.author ?? undefined;
    sManga.artist = comic.artist ?? undefined;
    sManga.description = comic.description ?? undefined;
    sManga.genre = (comic.genres ?? []).map((it) => it.name ?? "").join(", ");
    sManga.status = comic.status != null ? this.toStatus(comic.status) : SManga.UNKNOWN;
    sManga.thumbnail_url = comic.thumbnail ?? "";

    const sChapters = (comic.chapters ?? []).map((it) => this.chapterFromObject(it));

    return new SMangaUpdate(sManga, sChapters);
  }

  protected chapterFromObject(chapter: PizzaChapterDto): SChapter {
    const c = SChapter.create();
    c.name = chapter.full_title ?? "";
    c.chapter_number = (chapter.chapter ?? -1) + Number("0." + (chapter.subchapter?.toString() ?? "0"));
    c.date_upload = this.toDate(chapter.published_on ?? "");
    c.scanlator = (chapter.teams ?? [])
      .filter((it) => it != null)
      .map((it) => it!.name ?? "")
      .join(" & ");
    c.url = chapter.url ?? "";
    return c;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const result = (await this.client.get(this.apiUrl + chapter.url)).parseAs<PizzaReaderDto>();
    return (result.chapter!.pages ?? []).map((page, i) => new Page(i, "", page));
  }

  /** Instant.parseOrNull: ISO-8601 with an offset or Z. */
  protected toDate(s: string): number {
    if (!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return 0;
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  }

  protected toStatus(s: string): number {
    switch (s.slice(0, 7)) {
      case "In cors":
      case "On goin":
        return SManga.ONGOING;
      case "Complet":
      case "Conclus":
      case "Conclud":
        return SManga.COMPLETED;
      case "Licenzi":
      case "License":
        return SManga.LICENSED;
      default:
        return SManga.UNKNOWN;
    }
  }
}
