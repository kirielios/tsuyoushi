// Port of keiyoushi/extensions-source src/en/alphamanga/Dto.kt
import { DateTimeFormatter, Locale, SChapter, SManga } from "../../../sdk/index.ts";

export interface SearchResponse {
  data: MangaData[];
  has_more: boolean;
}

export interface MangaData {
  manga_sele_id: number;
  title: string;
  banner_image_url?: string | null;
}

export function mangaDataToSManga(m: MangaData): SManga {
  const manga = SManga.create();
  manga.url = String(m.manga_sele_id);
  manga.title = m.title;
  manga.thumbnail_url = m.banner_image_url ?? undefined;
  return manga;
}

export interface ChapterResponse {
  episodes: Episode[];
}

export interface Episode {
  story_no?: number | null;
  episode_no: number;
  title: string;
  update_date?: string | null;
  status?: string | null;
  is_purchased?: boolean | null;
  is_on_rental?: boolean | null;
}

export const isLocked = (e: Episode): boolean => e.status !== "free" && e.is_purchased === false && e.is_on_rental === false;

const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy HH:mm", Locale.ENGLISH);

export function episodeToSChapter(e: Episode, titleId: string): SChapter {
  const chapter = SChapter.create();
  const lock = isLocked(e) ? "🔒 " : "";
  chapter.url = String(e.episode_no);
  chapter.name = lock + e.title;
  chapter.chapter_number = e.story_no ?? -1;
  chapter.date_upload = dateFormat.tryParseDateTime(e.update_date);
  chapter.memo = { titleId };
  return chapter;
}
