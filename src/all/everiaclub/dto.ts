// Port of keiyoushi/extensions-source src/all/everiaclub/Dto.kt

export interface WPPostDto {
  link: string;
  title: WPRenderedDto;
  _embedded?: WPEmbeddedDto | null;
}
export const postThumbnail = (post: WPPostDto): string | undefined => post._embedded?.["wp:featuredmedia"]?.[0]?.source_url;

export interface WPRenderedDto {
  rendered: string;
}

export interface WPEmbeddedDto {
  "wp:featuredmedia"?: WPFeaturedMediaDto[] | null;
}

export interface WPFeaturedMediaDto {
  source_url: string;
}

export interface WPCategoryDto {
  id: number;
  name: string;
}

export interface WPTagDto {
  id: number;
  name: string;
}
