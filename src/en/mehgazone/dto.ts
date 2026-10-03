// Port of keiyoushi/extensions-source src/en/mehgazone/serialization/Dto.kt
export interface ChapterListDto {
  id: number;
  date_gmt: string;
  title: RenderedDto;
  excerpt: RenderedDto;
}

export interface PageListDto {
  link: string;
  content: RenderedDto;
  excerpt: RenderedDto;
}

export interface RenderedDto {
  rendered: string;
}
