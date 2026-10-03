// Port of keiyoushi/extensions-source src/en/kunmangaonline/Dto.kt
import { SChapter } from "../../../sdk/index.ts";

export interface ChapterListResponse {
  data: ChapterData;
}

export interface ChapterData {
  chapters: ChapterDto[];
  last_page: number;
}

export interface ChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string | null;
}

/** Instant.tryParse(updatedAt): ISO-8601 to epoch ms, 0 when missing or invalid. */
function tryParseInstant(date: string | null | undefined): number {
  if (date == null) return 0;
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : t;
}

export function toSChapter(dto: ChapterDto, slug: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/manga/${slug}/${dto.chapter_slug}`;
  chapter.name = dto.chapter_name;
  chapter.date_upload = tryParseInstant(dto.updated_at);
  return chapter;
}
