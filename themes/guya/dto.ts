// Port of keiyoushi/extensions-source lib-multisrc/guya/Dto.kt

export interface SeriesDto {
  slug: string;
  title?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  cover?: string | null;
  last_updated?: number | null;
}

export interface SeriesDetailsDto {
  slug: string;
  title: string;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  cover?: string | null;
  groups: Record<string, string>;
  chapters: Record<string, ChapterDto>;
  preferred_sort?: string[] | null;
}

export interface ChapterDto {
  title: string;
  folder: string;
  groups: Record<string, string[]>;
  release_date?: Record<string, number> | null;
  preferred_sort?: string[] | null;
}
