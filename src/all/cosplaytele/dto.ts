// Port of keiyoushi/extensions-source src/all/cosplaytele/Dto.kt
export interface PopularPostDto {
  title: RenderedStringDto;
  link: string;
  _embedded?: EmbeddedDto | null;
}

export interface RenderedStringDto {
  rendered: string;
}

export interface EmbeddedDto {
  "wp:featuredmedia"?: FeaturedMediaDto[] | null;
}

export interface FeaturedMediaDto {
  source_url: string;
}
