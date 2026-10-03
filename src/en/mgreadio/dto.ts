// Port of keiyoushi/extensions-source src/en/mgreadio/Dto.kt
import { DateTimeFormatter, Locale, SChapter, substringBefore, trimEnd } from "../../../sdk/index.ts";

const REST_CHAPTER_DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.US);

export interface ChapterListDto {
  items?: ChapterDto[];
  total_pages?: number;
}

export interface ChapterDto {
  title?: string;
  number?: number;
  slug?: string;
  created_at?: string;
}

export function toSChapter(dto: ChapterDto, mangaPath: string): SChapter {
  const { title = "", number = -1, slug = "", created_at: createdAt = "" } = dto;
  const chapter = SChapter.create();
  const chapterName = number % 1 === 0 ? String(Math.trunc(number)) : String(number);
  const cleanMangaPath = trimEnd(substringBefore(mangaPath, "/chapter/"), "/");

  chapter.url = `${cleanMangaPath}/${slug}/`;
  chapter.name = title.length > 0 ? `Chapter ${chapterName} - ${title}` : `Chapter ${chapterName}`;
  chapter.chapter_number = number;
  chapter.date_upload = REST_CHAPTER_DATE_FORMAT.tryParseDateTime(createdAt);
  return chapter;
}

export interface MgreadSearchDto {
  id: number;
  title: string;
  url: string;
  thumb?: string | null;
}
