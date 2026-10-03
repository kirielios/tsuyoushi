// Port of keiyoushi/extensions-source lib-multisrc/ezmanhwa/EZManhwaDto.kt
import { DateTimeFormatter, Locale, SChapter, ZoneOffset } from "../../sdk/index.ts";

export const EZMANHWA_DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ENGLISH).withZone(ZoneOffset.UTC);

export const CHAPTER_PREFIX_REGEX = /^(?:chapter|ch\.?|episode|ep\.?)\s*.*$/i;

export interface EZManhwaSeriesListDto {
  data: EZManhwaSeriesDto[];
  totalPages: number;
  current: number; // currentPage
}

// Used for both list (partial) and details (full) responses.
export interface EZManhwaSeriesDto {
  slug: string;
  title: string;
  cover?: string | null;
  type?: string | null;
  status?: string | null;
  alternativeTitles?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: EZManhwaGenreDto[] | null;
}

export interface EZManhwaGenreDto {
  name: string;
}

export interface EZManhwaChapterListDto {
  data: EZManhwaChapterDto[];
  totalPages?: number; // default 1
  current?: number; // currentPage, default 1
}

export interface EZManhwaChapterDto {
  slug: string;
  number?: number | null;
  title?: string | null;
  requiresPurchase?: boolean | null;
  createdAt?: string | null;
}

function isChapterTitle(title: string, numStr: string): boolean {
  return title.includes(numStr) && CHAPTER_PREFIX_REGEX.test(title);
}

export function chapterToSChapter(dto: EZManhwaChapterDto, seriesSlug: string): SChapter {
  const chapter = SChapter.create();
  // Unified URL format: series/{seriesSlug}/chapters/{chapterSlug}
  // pageListRequest uses: $apiUrl/${chapter.url}
  // getChapterUrl uses:   $baseUrl/${chapter.url.replace("/chapters/", "/")}
  chapter.url = `series/${seriesSlug}/chapters/${dto.slug}`;
  const prefix = dto.requiresPurchase === true ? "🔒 " : "";
  // Kotlin's Double.toString: 5.0 -> handled as "5", 5.5 -> "5.5"
  const numStr = dto.number != null ? (dto.number % 1 === 0 ? String(Math.trunc(dto.number)) : String(dto.number)) : "";

  const trimmed = dto.title?.trim();
  const parsedTitle = trimmed ? trimmed : null;

  let chapterName: string;
  if (!numStr.trim()) chapterName = parsedTitle ?? "Chapter";
  else if (parsedTitle == null || parsedTitle === numStr) chapterName = `Chapter ${numStr}`;
  else if (isChapterTitle(parsedTitle, numStr)) chapterName = parsedTitle;
  else if (parsedTitle.startsWith("-") || parsedTitle.startsWith(":")) chapterName = `Chapter ${numStr} ${parsedTitle}`;
  else chapterName = `Chapter ${numStr} - ${parsedTitle}`;

  chapter.name = prefix + chapterName;
  chapter.chapter_number = dto.number ?? -1;
  chapter.date_upload = EZMANHWA_DATE_FORMAT.tryParseDateTime(dto.createdAt);
  return chapter;
}

export interface EZManhwaPageListDto {
  images?: EZManhwaImageDto[] | null;
  requiresPurchase?: boolean | null;
  totalImages?: number | null;
}

export interface EZManhwaImageDto {
  url: string;
}
