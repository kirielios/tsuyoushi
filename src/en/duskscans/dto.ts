// Port of keiyoushi/extensions-source src/en/duskscans/Dto.kt
import { SChapter, SManga, parseAs, tryParseInstant } from "../../../sdk/index.ts";

export interface MangaDto {
  title: string;
  slug: string;
  alternativeTitle?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  cover?: string | null;
  status?: string | null;
  type?: string | null;
  views?: number;
  rating?: number;
  genres?: string[];
  createdAt?: string | null;
}

export function matchesQuery(manga: MangaDto, query: string): boolean {
  const q = query.toLowerCase();
  return manga.title.toLowerCase().includes(q) || (manga.alternativeTitle?.toLowerCase().includes(q) ?? false);
}

export interface ChapterDto {
  id: string;
  number: number;
  title?: string;
  releaseDate?: string | null;
  freeDate?: string | null;
  price?: number;
  requiresLogin?: boolean;
}

export function isLocked(chapter: ChapterDto): boolean {
  if (chapter.requiresLogin) return true;
  if ((chapter.price ?? 0) <= 0) return false;
  const freeAt = tryParseInstant(chapter.freeDate);
  return freeAt === 0 || freeAt > Date.now();
}

export function chapterToSChapter(chapter: ChapterDto, slug: string): SChapter {
  const it = SChapter.create();
  it.url = chapter.id;
  // URL is built from the slug and number, id alone can't provide
  const numberStr = String(chapter.number).replace(/\.0$/, "");
  it.memo = { slug, number: numberStr };
  const cleanTitle = (chapter.title ?? "").trim();
  const lower = cleanTitle.toLowerCase();
  let chapterName: string;
  if (cleanTitle === "" || lower === numberStr.toLowerCase()) chapterName = `Chapter ${numberStr}`;
  else if (lower.startsWith("chapter") || lower.startsWith("episode") || lower.startsWith("ch.")) chapterName = cleanTitle;
  else chapterName = `Chapter ${numberStr} - ${cleanTitle}`;
  it.name = isLocked(chapter) ? `🔒 ${chapterName}` : chapterName;
  it.chapter_number = chapter.number;
  it.date_upload = tryParseInstant(chapter.releaseDate);
  return it;
}

export interface SeriesPageDto {
  initialManga: MangaDto;
  initialChapters: ChapterDto[];
}

export interface FilterDataDto {
  genres: string[];
  statuses: string[];
  types: string[];
}

export interface ChapterDetailDto {
  pages: string;
}

/** The API returns the page list as a JSON-encoded string, not an array. */
export const pageUrls = (dto: ChapterDetailDto): string[] => parseAs<string[]>(dto.pages);

export function mangaToSManga(manga: MangaDto): SManga {
  const it = SManga.create();
  it.url = manga.slug;
  it.title = manga.title;
  it.thumbnail_url = manga.cover ?? undefined;
  it.author = manga.author ?? undefined;
  it.artist = manga.artist ?? undefined;
  it.description = manga.description ?? undefined;
  it.genre = (manga.genres ?? []).join(", ");
  it.status = manga.status === "Ongoing" ? SManga.ONGOING : manga.status === "Completed" ? SManga.COMPLETED : manga.status === "Hiatus" ? SManga.ON_HIATUS : SManga.UNKNOWN;
  it.initialized = true;
  return it;
}
