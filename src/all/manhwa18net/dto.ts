// Port of keiyoushi/extensions-source src/all/manhwa18net/Dto.kt
export interface PageDto {
  props: PropsDto;
}

export interface PropsDto {
  paginate?: PaginateDto | null;
  popularManga?: PaginateDto | null;
  mangas?: PaginateDto | null;
  latestManhwaMain?: PaginateDto | null;
  manga?: MangaDto | null;
  chapters?: ChapterDto[] | null;
  chapterContent?: string | null;
}

export interface PaginateDto {
  data: MangaDto[];
  next_page_url?: string | null;
}

export interface MangaDto {
  name: string;
  slug: string;
  cover_url?: string | null;
  thumb_url?: string | null;
  pilot?: string | null;
  description?: string | null;
  genres?: GenreDto[] | null;
  artists?: ArtistDto[] | null;
  status_id?: number | null;
}

export interface ChapterDto {
  name: string;
  slug: string;
  created_at?: string | null;
}

export interface GenreDto {
  name: string;
}

export interface ArtistDto {
  name: string;
}
