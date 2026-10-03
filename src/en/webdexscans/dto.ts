// Port of keiyoushi/extensions-source src/en/webdexscans/Dto.kt
import { SChapter, SManga, parseHtml, tryParseInstant, type Host } from "../../../sdk/index.ts";

export interface SearchSeriesDto {
  id: string;
  title: string;
  slug: string;
  cover_url?: string | null;
}

export function searchSeriesToSManga(dto: SearchSeriesDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.url = dto.id;
  manga.thumbnail_url = dto.cover_url != null ? toAbsoluteUrl(dto.cover_url, baseUrl) : undefined;
  manga.memo = { slug: dto.slug };
  return manga;
}

export interface GenreInfo {
  name: string;
}

export interface SeriesInfo {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: GenreInfo[] | null;
}

const blockTagRegex = /<\/(?:p|div|h[1-6])>/gi;
const trimLinesRegex = /[ \t\r]*\n[ \t\r]*/g;
const multiNewlineRegex = /\n{3,}/g;

export function seriesInfoToSManga(dto: SeriesInfo, baseUrl: string, host: Pick<Host, "load">): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.url = dto.id;
  manga.thumbnail_url = dto.cover_url != null ? toAbsoluteUrl(dto.cover_url, baseUrl) : undefined;
  manga.author = dto.author ?? undefined;
  manga.artist = dto.artist ?? undefined;
  manga.description =
    dto.description != null
      ? parseHtml(host.load, dto.description.replace(blockTagRegex, "\n"), "")
          .wholeText()
          .replaceAll(" ", " ")
          .replace(trimLinesRegex, "\n")
          .replace(multiNewlineRegex, "\n\n")
          .trim()
      : undefined;
  switch (dto.status?.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "cancelled":
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.genre = dto.genres != null ? dto.genres.map((it) => it.name).join(", ") : undefined;
  manga.memo = { slug: dto.slug };
  return manga;
}

export interface SeriesSlugDto {
  slug: string;
}

export interface ChapterInfo {
  id: string;
  title?: string | null;
  slug: string;
  chapter_number?: number | null;
  created_at?: string | null;
  is_premium?: boolean;
  free_at?: string | null;
  series?: SeriesSlugDto | null;
}

export const seriesSlugOf = (info: ChapterInfo): string | undefined => info.series?.slug;

export function isPremium(info: ChapterInfo): boolean {
  if (!info.is_premium) return false;
  const freeAtInstant = info.free_at != null ? tryParseInstant(info.free_at) : 0; // Instant.parseOrNull: 0 stands for null
  if (freeAtInstant === 0) return true;
  return freeAtInstant > Date.now();
}

export function chapterInfoToSChapter(info: ChapterInfo, seriesSlug: string): SChapter {
  const chapter = SChapter.create();
  const number = info.chapter_number;
  const chapterName = info.title != null && info.title.trim() !== "" ? info.title : number != null ? `Chapter ${String(number).replace(/\.0$/, "")}` : "Chapter";
  const locked = isPremium(info);
  chapter.name = locked ? `🔒 ${chapterName}` : chapterName;
  chapter.url = info.id;
  chapter.chapter_number = number ?? -1;
  chapter.date_upload = info.created_at != null ? tryParseInstant(info.created_at) : 0;
  chapter.memo = { slug: info.slug, seriesSlug, isLocked: locked };
  return chapter;
}

export interface PageInfo {
  image_url: string;
}

export function updateSeriesSlug(manga: SManga, slug: string) {
  if (slug.length > 0) manga.memo = { slug };
}

export const toAbsoluteUrl = (s: string, baseUrl: string) => (s.startsWith("/") ? baseUrl + s : s);
