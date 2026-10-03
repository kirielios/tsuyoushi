// Port of keiyoushi/extensions-source src/en/kappabeast/Dto.kt
import { SChapter, SManga, tryParseInstant } from "../../../sdk/index.ts";

export interface SearchResponse {
  data: Data[];
  meta: Meta;
}

export interface Data {
  documentId: string;
  title: string;
  description: string | null;
  author: string | null;
  manga_status: string | null;
  artist: string | null;
  slug: string;
  media: Media[] | null;
  category: Category[] | null;
  chapters?: ChapterData[] | null;
}

export const toSChapters = (d: Data): SChapter[] => (d.chapters ?? []).map((it) => chapterToSChapter(it, d.slug, d.documentId));

export function toSManga(d: Data, cdnUrl: string): SManga {
  const manga = SManga.create();
  manga.url = `${d.slug}#${d.documentId}`;
  manga.title = d.title;
  const cover = d.media?.[0]?.coverImage?.url;
  manga.thumbnail_url = cover != null ? cdnUrl + cover : undefined;
  manga.description = d.description ?? undefined;
  manga.author = d.author ?? undefined;
  manga.artist = d.artist ?? undefined;
  manga.genre = d.category?.map((it) => it.name).join(", ");
  switch (d.manga_status) {
    case "Ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "Completed":
      manga.status = SManga.COMPLETED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export interface Meta {
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  pageCount: number;
}
export const hasNextPage = (p: Pagination) => p.page < p.pageCount;

export interface Media {
  coverImage: CoverImage | null;
}

export interface CoverImage {
  url: string | null;
}

export interface Category {
  name: string;
}

export interface ChapterPageResponse {
  data: ChapterPage[];
}

export interface ChapterPage {
  htmlContent: string | null;
}

export interface ChapterData {
  number: number;
  title: string | null;
  createdAt: string | null;
}

/** Kotlin's Float.toString(): whole numbers keep ".0". */
const floatToString = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function chapterToSChapter(c: ChapterData, slug: string, documentId: string): SChapter {
  const chapter = SChapter.create();
  const chapterNum = c.number % 1 === 0 ? String(Math.trunc(c.number)) : String(c.number);
  chapter.url = `${slug}/${floatToString(c.number)}#${documentId}`;
  let name = `Chapter ${chapterNum}`;
  if (c.title != null && c.title.trim() !== "" && c.title !== `Chapter ${chapterNum}`) name += ` - ${c.title}`;
  chapter.name = name;
  chapter.chapter_number = c.number;
  chapter.date_upload = tryParseInstant(c.createdAt);
  return chapter;
}
