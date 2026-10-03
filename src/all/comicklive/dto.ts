// Port of keiyoushi/extensions-source src/all/comicklive/Dto.kt
import { SManga } from "../../../sdk/index.ts";

export interface Data<T> {
  data: T;
}

export interface SearchResponse {
  data: BrowseComic[];
  next_cursor?: string | null;
}

export interface BrowseComic {
  default_thumbnail: string;
  slug: string;
  title: string;
}

export function browseComicToSManga(c: BrowseComic): SManga {
  const manga = SManga.create();
  manga.url = c.slug;
  manga.title = c.title;
  manga.thumbnail_url = c.default_thumbnail;
  return manga;
}

export interface MetadataName {
  name: string;
  slug: string;
}

export interface Metadata {
  genres: MetadataName[];
  tags: MetadataName[];
}

export interface ComicData {
  title: string;
  slug: string;
  default_thumbnail: string;
  status: number;
  translation_completed: boolean;
  artists: { name: string }[];
  authors: { name: string }[];
  desc: string;
  content_rating: string;
  country: string;
  md_comic_md_genres: { md_genres: { name: string } }[];
  /** TitleTransform: an object of titles is read as the list of its values. */
  md_titles: { title: string }[] | Record<string, { title: string }>;
}

export const comicTitles = (d: ComicData): { title: string }[] => (Array.isArray(d.md_titles) ? d.md_titles : Object.values(d.md_titles));

export interface ChapterList {
  data: {
    hid: string;
    chap: string;
    vol: string | null;
    lang: string;
    title: string | null;
    created_at: string;
    group_name: string[];
  }[];
  pagination: { current_page: number; last_page: number };
}

export interface PageListData {
  chapter: { images: { url: string }[] };
}
