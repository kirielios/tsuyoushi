// Port of keiyoushi/extensions-source src/all/mangafire/Dto.kt
import { SChapter, SManga, type Document } from "../../../sdk/index.ts";

export interface ApiResponse<T> {
  items?: T[];
  meta?: ApiMeta | null;
}
export interface ApiMeta {
  lastPage?: number;
  hasNext?: boolean;
}
export interface TagResponse {
  data?: TagDto[];
}
export interface TagDto {
  id: number;
  type: string;
}

export interface PosterDto {
  small?: string | null;
  medium?: string | null;
  large?: string | null;
}
export interface EntityDto {
  title: string;
}

const posterUrl = (poster?: PosterDto | null) => poster?.large ?? poster?.medium ?? poster?.small ?? undefined;
const mangaUrl = (hid: string, slug?: string | null) => `/title/${hid}${slug != null ? `-${slug}` : ""}`;

export interface MangaDto {
  hid: string;
  slug?: string | null;
  title: string;
  poster?: PosterDto | null;
}
export function mangaDtoToSManga(d: MangaDto): SManga {
  const manga = SManga.create();
  manga.url = mangaUrl(d.hid, d.slug);
  manga.title = d.title;
  manga.thumbnail_url = posterUrl(d.poster);
  manga.initialized = false;
  return manga;
}

export interface MangaDetailsResponse {
  data: MangaDetailsDto;
}
export interface MangaDetailsDto {
  hid: string;
  slug?: string | null;
  title: string;
  type?: string | null;
  status?: string | null;
  poster?: PosterDto | null;
  synopsisHtml?: string | null;
  authors?: EntityDto[] | null;
  artists?: EntityDto[] | null;
  genres?: EntityDto[] | null;
  themes?: EntityDto[] | null;
}
export function mangaDetailsToSManga(d: MangaDetailsDto, parseBodyFragment: (html: string) => Document): SManga {
  const manga = SManga.create();
  manga.url = mangaUrl(d.hid, d.slug);
  manga.title = d.title;
  manga.thumbnail_url = posterUrl(d.poster);
  manga.author = d.authors?.map((it) => it.title).join(", ");
  manga.artist = d.artists?.map((it) => it.title).join(", ");
  manga.description = d.synopsisHtml != null ? parseBodyFragment(d.synopsisHtml).text() : undefined;
  const genre: string[] = [];
  if (d.type != null) genre.push(d.type.charAt(0).toUpperCase() + d.type.slice(1));
  d.genres?.forEach((it) => genre.push(it.title));
  d.themes?.forEach((it) => genre.push(it.title));
  manga.genre = genre.join(", ");
  manga.status = (() => {
    switch (d.status?.toLowerCase()) {
      case "releasing":
        return SManga.ONGOING;
      case "finished":
        return SManga.COMPLETED;
      case "on_hiatus":
        return SManga.ON_HIATUS;
      case "discontinued":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  })();
  manga.initialized = true;
  return manga;
}

export interface VolumeDto {
  id: number;
  number: number;
  name?: string | null;
  chapterCount: number;
  language: string;
}
export function volumeToSChapter(d: VolumeDto, mangaUrl: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${mangaUrl}/volume/${d.id}`;
  chapter.chapter_number = d.number;
  let name = `Vol. ${d.number}`;
  if (d.name != null && d.name.trim() !== "") name += ` - ${d.name}`;
  chapter.name = name;
  chapter.scanlator = `${d.chapterCount} chapters`;
  return chapter;
}

export interface ChapterDto {
  id: number;
  number: number;
  name?: string | null;
  createdAt?: number | null;
  type?: string | null;
}

const chapterRegex = /(?<=\b(?:ch(?:\.|apter)?|ep(?:\.|isode)?)\s?)\d+(?:\.\d+)?/i;

export function chapterToSChapter(d: ChapterDto, mangaUrl: string, langCode: string): SChapter {
  const chapter = SChapter.create();
  const num = String(d.number);
  chapter.url = `${mangaUrl}/${d.id}-chapter-${num}-${langCode}`;
  let a: number;
  let b: string;
  if (d.name == null || d.name.trim() === "") {
    a = d.number;
    b = `Ch. ${num}`;
  } else {
    const m = chapterRegex.exec(d.name)?.[0];
    const extracted = m !== undefined && m !== "" && !Number.isNaN(Number(m)) ? Number(m) : null;
    if (extracted === null) {
      a = d.number;
      b = `Ch. ${num} - ${d.name}`;
    } else {
      a = extracted;
      b = d.name;
    }
  }
  chapter.chapter_number = a;
  chapter.name = b;
  chapter.scanlator = d.type ?? "Unknown";
  chapter.date_upload = d.createdAt != null ? d.createdAt * 1000 : 0;
  return chapter;
}

export interface PagesResponse {
  data: ChapterDataDto;
}
export interface ChapterDataDto {
  pages: PageDto[];
}
export interface PageDto {
  url: string;
}
