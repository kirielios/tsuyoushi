// Port of keiyoushi/extensions-source src/en/mangamelon/Dto.kt
import { SChapter, SManga, tryParseInstant } from "../../../sdk/index.ts";

// Chapter URLs only carry the chapter id; the manga id is kept in the chapter memo.
export const MANGA_ID_MEMO = "mangaId";

// ================================ Requests ================================

export interface MangaListRequest {
  search: string;
  genre: string;
  lang: string;
  sort: string;
  includeNsfw: boolean;
  limit: number;
  skip: number;
}
export const mangaListRequest = (r: Partial<MangaListRequest>): MangaListRequest => ({ search: "", genre: "", lang: "en", sort: "popular", includeNsfw: true, limit: 36, skip: 0, ...r });

export interface MangaGetRequest {
  target: string;
  withReviews: boolean;
}
export const mangaGetRequest = (target: string): MangaGetRequest => ({ target, withReviews: false });

export interface ChapterListRequest {
  target: string;
  status: number;
  limit: number;
  skip: number;
  pending: string;
  force: boolean;
}
export const chapterListRequest = (r: Pick<ChapterListRequest, "target"> & Partial<ChapterListRequest>): ChapterListRequest => ({ status: 0, limit: 1000, skip: 0, pending: "", force: true, ...r });

export interface ChapterGetRequest {
  target: string;
  all: boolean;
}
export const chapterGetRequest = (target: string): ChapterGetRequest => ({ target, all: true });

// ================================ Responses ================================

export interface MangaListResponse {
  list: MangaDto[];
  total?: number;
}
export interface MangaGetResponse {
  manga: MangaDto;
}
export interface ChapterListResponse {
  chapters?: ChapterDto[];
}
export interface ChapterGetResponse {
  chapter: ChapterDto;
}

export interface MangaDto {
  id: string;
  title: string;
  cover?: string | null;
  desc?: string | null;
  status?: string | null;
  authors?: string | null;
  genres?: string[];
}

export function mangaToSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.url = dto.id;
  manga.title = dto.title;
  manga.thumbnail_url = dto.cover ?? "";
  manga.description = dto.desc ?? undefined;
  manga.author = dto.authors ?? undefined;
  manga.genre = (dto.genres ?? []).join(", ");
  manga.status = toMangaStatus(dto.status);
  return manga;
}

export interface ChapterDto {
  id: string;
  title: string;
  seq?: number;
  updated?: string | null;
  pages?: PageDto[];
}

export function chapterToSChapter(dto: ChapterDto, mangaId: string): SChapter {
  const chapter = SChapter.create();
  chapter.name = dto.title;
  chapter.url = dto.id;
  chapter.memo = { [MANGA_ID_MEMO]: mangaId };
  chapter.date_upload = dto.updated && !dto.updated.startsWith("0001-") ? tryParseInstant(dto.updated) : 0;
  return chapter;
}

export interface PageDto {
  url: string;
  seq?: number;
}

function toMangaStatus(s: string | null | undefined): number {
  switch (s?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "licensed":
      return SManga.LICENSED;
    case "on hiatus":
    case "hiatus":
      return SManga.ON_HIATUS;
    case "cancelled":
    case "canceled":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}
