// Port of keiyoushi/extensions-source lib-multisrc/mangak/MangaKDto.kt
import { SChapter, SManga, isBlank } from "../../sdk/index.ts";

export interface SearchResponseDto {
  data?: SearchDataDto | null;
}
export const searchItems = (dto: SearchResponseDto) => dto.data?.items ?? [];
export const searchHasNext = (dto: SearchResponseDto) => dto.data?.pagination?.has_next ?? false;

export interface SearchDataDto {
  items?: MangaItemDto[];
  pagination?: PaginationDto | null;
}

export interface MangaItemDto {
  id: string;
  name: string;
  cover: string;
  url: string;
}
export function mangaItemToSManga(dto: MangaItemDto): SManga {
  const manga = SManga.create();
  manga.title = dto.name;
  manga.thumbnail_url = dto.cover;
  manga.url = `${dto.url}`;
  manga.memo = { id: dto.id };
  return manga;
}

export interface PaginationDto {
  has_next?: boolean;
}

export interface ChapterListResponseDto {
  data?: ChapterDataDto | null;
}
export interface ChapterDataDto {
  chapters?: ChapterItemDto[];
}

export interface ChapterItemDto {
  url: string;
  name: string;
  updated_at?: string | null;
  chapter_number?: number | null;
}
export function chapterItemToSChapter(dto: ChapterItemDto): SChapter {
  const chapter = SChapter.create();
  chapter.url = dto.url;
  chapter.name = dto.name;
  // Instant.parseOrNull: ISO-8601 with an offset
  const t = dto.updated_at != null ? Date.parse(dto.updated_at) : NaN;
  chapter.date_upload = Number.isNaN(t) ? 0 : t;
  return chapter;
}

export interface NextJsDto {
  pageProps?: PagePropsDto | null;
}
export interface PagePropsDto {
  initialManga?: InitialMangaDto | null;
  initialChapter?: InitialChapterDto | null;
}

export interface InitialMangaDto {
  id: string;
  name: string;
  authors?: EntityDto[] | null;
  summary?: string | null;
  genres?: EntityDto[] | null;
  status?: string | null;
  cover?: string | null;
  url?: string | null;
}
export function initialMangaToSManga(dto: InitialMangaDto, mangaUrl: string | null = null): SManga {
  const manga = SManga.create();
  manga.title = dto.name;
  manga.author = dto.authors?.map((it) => it.name).join(", ");
  manga.description = dto.summary ?? undefined;
  manga.genre = dto.genres?.map((it) => it.name).join(", ");
  manga.status = toStatus(dto.status);
  manga.thumbnail_url = dto.cover ?? undefined;

  if (!isBlank(mangaUrl)) manga.url = mangaUrl;
  else if (dto.url != null && !isBlank(dto.url)) manga.url = dto.url;
  else throw new Error(`Missing manga URL for id: ${dto.id}`);

  manga.memo = { id: dto.id };
  return manga;
}

export interface EntityDto {
  name: string;
}

export interface InitialChapterDto {
  images: string[];
}

function toStatus(s: string | null | undefined): number {
  switch (s?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    case "cancelled":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

export interface GenreResponseDto {
  data?: GenreDataDto | null;
}
export interface GenreDataDto {
  items?: GenreItemDto[];
}
export interface GenreItemDto {
  name: string;
  slug: string;
}
