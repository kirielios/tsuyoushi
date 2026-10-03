// Port of keiyoushi/extensions-source src/en/mangade/Dto.kt
import { MangasPage, Page, SChapter, SManga, type DateTimeFormatter } from "../../../sdk/index.ts";

export interface PayloadDto<T> {
  data: T;
}

export interface MangaListPageDto {
  list: MangaDto[];
  totalPage: number;
  page: string;
}
export const toMangasPage = (dto: MangaListPageDto): MangasPage => new MangasPage(dto.list.map(toSManga), Number.parseInt(dto.page, 10) < dto.totalPage);

export interface MangaDto {
  id: string;
  name: string;
  slug?: string | null;
  image: string;
  description?: string | null;
  genre_names?: string | null;
  status?: string | null;
  news_chapters?: ChapterDto[];
}

export function toSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.title = dto.name;
  manga.thumbnail_url = dto.image;
  manga.url = `/${dto.slug ?? null}?mid=${dto.id}`;
  manga.description = dto.description ?? undefined;
  manga.genre = dto.genre_names?.replaceAll(",", ", ");
  switch (dto.status) {
    case "Ongoing":
    case "Releasing":
      manga.status = SManga.ONGOING;
      break;
    case "Completed":
      manga.status = SManga.COMPLETED;
      break;
    case "On Hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export const toSChapterList = (dto: MangaDto, dateFormat: DateTimeFormatter): SChapter[] => (dto.news_chapters ?? []).map((it) => toSChapter(it, dto.id, dto.slug, dateFormat));

export interface ChapterDto {
  id: string;
  name: string;
  slug?: string | null;
  chapter_number?: string | null;
  published_date?: string | null;
  chapter_images?: PageDto[];
}

export function toSChapter(dto: ChapterDto, mangaId: string, mangaSlug: string | null | undefined, dateFormat: DateTimeFormatter): SChapter {
  const chapter = SChapter.create();
  chapter.name = dto.name;
  const n = dto.chapter_number?.trim() ? Number(dto.chapter_number) : Number.NaN; // toFloatOrNull
  chapter.chapter_number = Number.isNaN(n) ? -1 : n;
  chapter.url = `/${mangaSlug ?? null}/${dto.slug ?? null}?cid=${dto.id}&mid=${mangaId}`;
  chapter.date_upload = dateFormat.tryParseDateTime(dto.published_date);
  return chapter;
}

export const toPageList = (dto: ChapterDto): Page[] => (dto.chapter_images ?? []).map((p, index) => new Page(index, "", p.image));

export interface PageDto {
  image: string;
}

export interface GenreListPageDto {
  genres: GenreDto[];
}

export interface GenreDto {
  id: string;
  name: string;
}
