// Port of keiyoushi/extensions-source src/id/westmanga/Dto.kt
import { SChapter, SManga, type Document } from "../../../sdk/index.ts";

export interface Data<T> {
  data: T;
}

export interface PaginatedData<T> {
  data: T[];
  paginator: Paginator;
}

export interface Paginator {
  current_page: number;
  last_page: number;
}

export const hasNextPage = (p: Paginator) => p.current_page < p.last_page;

export interface BrowseManga {
  title: string;
  slug: string;
  cover?: string | null;
}

export function browseToSManga(it: BrowseManga): SManga {
  const manga = SManga.create();
  // old urls compatibility
  manga.url = `/manga/${it.slug}/`;
  manga.title = it.title;
  manga.thumbnail_url = it.cover ?? undefined;
  return manga;
}

export interface Manga {
  title: string;
  slug: string;
  alternative_name?: string | null;
  sinopsis?: string | null;
  cover?: string | null;
  author?: string | null;
  country_id?: string | null;
  status?: string | null;
  color?: boolean | null;
  genres: Genre[];
  chapters: Chapter[];
}

/** `parseBodyFragment` stands in for Jsoup.parseBodyFragment(html, baseUrl). */
export function mangaToSManga(it: Manga, parseBodyFragment: (html: string) => Document): SManga {
  const manga = SManga.create();
  // old urls compatibility
  manga.url = `/manga/${it.slug}/`;
  manga.title = it.title;
  manga.thumbnail_url = it.cover ?? undefined;
  manga.author = it.author ?? undefined;
  switch (it.status?.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  const genres: string[] = [];
  switch (it.country_id) {
    case "JP":
      genres.push("Manga");
      break;
    case "CN":
      genres.push("Manhua");
      break;
    case "KR":
      genres.push("Manhwa");
      break;
  }
  if (it.color === true) genres.push("Colored");
  it.genres.forEach((g) => genres.push(g.name));
  manga.genre = genres.join(", ");

  let description = "";
  if (it.sinopsis != null) description += parseBodyFragment(it.sinopsis).text();
  if (it.alternative_name != null) {
    if (description) description += "\n\n";
    description += `Alternative Name: ${it.alternative_name.trim()}`;
  }
  manga.description = description;
  return manga;
}

export interface Genre {
  name: string;
}

export interface Chapter {
  slug: string;
  number: string;
  updated_at: Time;
}

export function chapterToSChapter(it: Chapter): SChapter {
  const chapter = SChapter.create();
  // old urls compatibility
  chapter.url = `/${it.slug}/`;
  chapter.name = `Chapter ${it.number}`;
  chapter.date_upload = it.updated_at.time * 1000;
  return chapter;
}

export interface Time {
  time: number;
}

export interface ImageList {
  images: string[];
}

export interface ApiGenre {
  id: number;
  name: string;
  slug: string;
}
