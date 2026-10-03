// Port of keiyoushi/extensions-source src/en/lusttoon/Dto.kt
import { SChapter, SManga, tryParseInstant } from "../../../sdk/index.ts";

export interface MetaDto {
  current_page: number;
  last_page: number;
}

export interface SearchItemDto {
  name?: string | null;
  slug?: string | null;
  urlImg?: string | null;
}

export function searchItemToSManga(dto: SearchItemDto): SManga {
  const manga = SManga.create();
  manga.title = dto.name ?? "";
  manga.url = `/comic/${dto.slug}`;
  manga.thumbnail_url = dto.urlImg?.replace("http://", "https://");
  return manga;
}

export interface SearchResponseDto {
  data?: SearchItemDto[];
  meta?: MetaDto | null;
}

export const searchResponseMangas = (dto: SearchResponseDto): SManga[] =>
  (dto.data ?? []).filter((it) => it.slug != null).map(searchItemToSManga);
export const searchResponseHasNext = (dto: SearchResponseDto): boolean => (dto.meta?.current_page ?? 1) < (dto.meta?.last_page ?? 1);

export interface StateDto {
  estado: string;
}

export interface GenreDto {
  name: string;
}

export interface ChapterDto {
  slug?: string | null;
  num?: number | null;
  name?: string | null;
  createdAt?: string | null;
}

const digitRegex = /\d/;

export function chapterToSChapter(dto: ChapterDto, mangaSlug: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/comic/${mangaSlug}/${dto.slug}`;
  const chapName = dto.name;
  chapter.name = chapName != null && chapName.trim() !== "" && digitRegex.test(chapName) ? chapName : `Chapter ${dto.num != null ? String(dto.num).replace(/\.0$/, "") : ""}`.trim();
  chapter.chapter_number = dto.num ?? -1;
  chapter.date_upload = tryParseInstant(dto.createdAt);
  return chapter;
}

export interface SerieDto {
  name?: string | null;
  slug?: string | null;
  urlImg?: string | null;
  sinopsis?: string | null;
  state?: StateDto | null;
  genders?: GenreDto[] | null;
  chapters?: ChapterDto[] | null;
}

export function serieToSManga(dto: SerieDto): SManga {
  const manga = SManga.create();
  manga.title = dto.name ?? "";
  manga.url = `/comic/${dto.slug}`;
  manga.thumbnail_url = dto.urlImg?.replace("http://", "https://");
  manga.description = dto.sinopsis ?? undefined;
  switch (dto.state?.estado.toLowerCase()) {
    case "en emision":
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completado":
    case "finalizado":
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "cancelado":
    case "cancelled":
      manga.status = SManga.CANCELLED;
      break;
    case "pausado":
    case "hiatus":
    case "paused":
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  const genre = dto.genders?.map((it) => it.name).join(", ");
  manga.genre = genre != null && genre.trim() !== "" ? genre : undefined;
  manga.initialized = true;
  return manga;
}

export interface PagechesDto {
  urlImg?: string | null;
}

export function pagechesImages(dto: PagechesDto): string[] {
  try {
    return (dto.urlImg != null ? (JSON.parse(dto.urlImg) as string[]) : null) ?? [];
  } catch {
    return [];
  }
}

export interface HomeDto {
  comics?: SearchItemDto[] | null;
}

export const homeMangas = (dto: HomeDto): SManga[] => dto.comics?.filter((it) => it.slug != null).map(searchItemToSManga) ?? [];
