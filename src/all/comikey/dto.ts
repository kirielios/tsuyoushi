// Port of keiyoushi/extensions-source src/all/comikey/Dto.kt

export interface ComikeyComic {
  link: string;
  name: string;
  author: ComikeyAuthor[];
  artist: ComikeyAuthor[];
  tags: ComikeyNameWrapper[];
  description: string;
  excerpt: string;
  format: number;
  full_cover: string;
  update_status: number;
  update_text: string;
}

export interface ComikeyEpisodeListResponse {
  episodes?: ComikeyEpisode[];
}

export interface ComikeyEpisode {
  id: string;
  number?: number;
  title: string;
  subtitle?: string | null;
  releasedAt: string;
  finalPrice?: number;
  owned?: boolean;
}

export const isReadable = (e: ComikeyEpisode): boolean => (e.finalPrice ?? 0) === 0 || (e.owned ?? false);

export interface ComikeyNameWrapper {
  name: string;
}

export interface ComikeyAuthor {
  name: string;
}
