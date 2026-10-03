// Port of keiyoushi/extensions-source src/en/kmanga/Dto.kt
import { DateTimeFormatter, SChapter, SManga, ZoneId } from "../../../sdk/index.ts";

const chapterNameRegex = /(?:chapter|ch|episode|ep|第).?\s*(\d+(?:\.\d+)?)(?:\s*[(（](\d+)[)）])?/i;
const splitChapterRegex = /(\d+(?:\.\d+)?)\s*[(（](\d+)[)）]/;
const fallbackChapterRegex = /^(\d+(?:\.\d+)?)(?:\s*[(（](\d+)[)）])?/;
const partSuffixRegex = /\s*[(（]\d+[)）]/;

/** String.toFloatOrNull() */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null);

// Popular
export interface RankingApiResponse {
  ranking_title_list: RankingTitleId[];
}
export interface RankingTitleId {
  id: number;
}
export interface LatestResponse {
  today_weekday_index: number;
  weekly_list: Weekly[];
  title_list: TitleDetail[];
}
export interface Weekly {
  title_id_list: number[];
  weekday_index: number;
}

// Mangas
export interface TitleListResponse {
  title_list: TitleDetail[];
}
export interface TitleDetail {
  title_id: number;
  title_name: string;
  thumbnail_image_url?: string | null;
  banner_image_url?: string | null;
  thumbnail_rect_image_url?: string | null;
}
export function titleToSManga(t: TitleDetail): SManga {
  const manga = SManga.create();
  manga.url = `/title/${t.title_id}`;
  manga.title = t.title_name;
  manga.thumbnail_url = t.thumbnail_image_url ?? t.banner_image_url ?? t.thumbnail_rect_image_url ?? undefined;
  return manga;
}

// Details
export interface DetailResponse {
  web_title: WebTitle;
}
export interface WebTitle {
  title_name: string;
  author_text: string | null;
  introduction_text: string | null;
  next_updated_text: string | null;
  title_in_japanese: string | null;
  genre_id_list: number[] | null;
  episode_id_list: number[];
  thumbnail_image_url?: string | null;
  thumbnail_rect_image_url?: string | null;
  banner_image_url?: string | null;
}
export function webTitleToSManga(t: WebTitle, titleId: string, genre: string | null): SManga {
  const manga = SManga.create();
  manga.url = `/title/${titleId}`;
  manga.title = t.title_name;
  manga.author = t.author_text ?? undefined;
  let description = "";
  if (t.introduction_text != null) description += t.introduction_text;
  if (t.next_updated_text) description += `\n\n${t.next_updated_text}`;
  if (t.title_in_japanese) description += `\n\nJapanese Title: ${t.title_in_japanese}`;
  manga.description = description;
  manga.thumbnail_url = t.thumbnail_image_url ?? t.banner_image_url ?? t.thumbnail_rect_image_url ?? undefined;
  manga.genre = genre ?? undefined;
  return manga;
}

export interface GenreListResponse {
  genre_list: GenreDetail[] | null;
}
export interface GenreDetail {
  genre_name: string;
}

// Chapters
export interface EpisodeListResponse {
  episode_list: Episode[];
}
export interface Episode {
  episode_id: number;
  episode_name: string;
  start_time: string | null;
  point: number;
  title_id: number;
  index: number;
  badge: number;
  rental_finish_time: string | null;
}
export const isLocked = (e: Episode) => e.point > 0 && e.badge !== 3 && e.rental_finish_time == null;

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.of("America/Chicago"));

export function episodeToSChapter(e: Episode): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/title/${e.title_id}/episode/${e.episode_id}`;
  const lock = isLocked(e) ? "🔒 " : "";
  let parsedName = e.episode_name;

  const match = chapterNameRegex.exec(e.episode_name) ?? splitChapterRegex.exec(e.episode_name) ?? fallbackChapterRegex.exec(e.episode_name);

  if (match) {
    const main = match[1];
    const part = match[2] ?? "";
    if (part) {
      const replacement = match[0].replace(partSuffixRegex, `.${part}`);
      parsedName = parsedName.slice(0, match.index) + replacement + parsedName.slice(match.index + match[0].length);
      chapter.chapter_number = main.includes(".") ? (toFloatOrNull(main) ?? e.index) : (toFloatOrNull(`${main}.${part}`) ?? e.index);
    } else {
      chapter.chapter_number = toFloatOrNull(main) ?? e.index;
    }
  } else {
    chapter.chapter_number = e.index;
  }

  chapter.name = lock + parsedName;
  chapter.date_upload = dateFormat.tryParseDateTime(e.start_time);
  return chapter;
}

// Viewer
export interface ViewerApiResponse {
  page_list: string[];
  scramble_seed: string;
  title_id: number;
  episode_id: number;
}
export interface BirthdayCookie {
  value: string;
  expires: number;
}
