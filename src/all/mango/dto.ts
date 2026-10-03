// Port of keiyoushi/extensions-source src/all/mango/Dto.kt
export interface LibraryDto {
  titles?: TitleDto[] | null;
}

export interface TitleDto {
  id: string;
  display_name: string;
  cover_url: string;
  entries?: EntryDto[] | null;
  titles?: TitleDto[] | null;
}

export interface EntryDto {
  display_name: string;
  title_id: string;
  id: string;
  pages: number;
  mtime: number;
}
