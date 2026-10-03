// Port of keiyoushi/extensions-source src/all/simplyhentai/SimplyHentaiAPI.kt
import { SManga } from "../../../sdk/index.ts";

export interface SHList<T> {
  pagination: SHPagination;
  data: T;
}

export interface SHPagination {
  next: number | null;
}

export interface SHWrapper {
  object: SHObject;
}

export interface SHDataAlbum {
  albums: SHObject[];
}

export interface SHObject {
  preview: SHImage;
  series: SHTag;
  slug: string;
  title: string;
}

export function toSManga(o: SHObject): SManga {
  const manga = SManga.create();
  manga.url = `/${o.series.slug}/${o.slug}`;
  manga.title = o.title;
  manga.thumbnail_url = o.preview.sizes.thumb;
  return manga;
}

export interface SHImage {
  page_num: number;
  sizes: SHSizes;
}

export interface SHSizes {
  full: string;
  thumb: string;
}

export interface SHTag {
  slug: string;
  title: string;
}

export interface SHAlbum {
  data: SHData;
}

export interface SHData {
  artists: SHTag[];
  characters: SHTag[];
  created_at: string;
  description: string | null;
  preview: SHImage;
  series: SHTag;
  slug: string;
  tags: SHTag[];
  title: string;
  translators: SHTag[];
}

export const shDataPath = (d: SHData) => `/${d.series.slug}/${d.slug}`;

export interface SHAlbumPages {
  data: SHPagesData;
}

export interface SHPagesData {
  pages: SHImage[];
}
