// Port of keiyoushi/extensions-source src/en/coolmic/Dto.kt
import { DateTimeFormatter, Locale, SChapter, SManga } from "../../../sdk/index.ts";

export interface SeriesResponse {
  total: number;
  results: Result[];
}

export interface Result {
  title_id: number;
  title_name: string;
}

export function resultToSManga(r: Result, cdnUrl: string): SManga {
  const manga = SManga.create();
  manga.url = String(r.title_id);
  manga.title = r.title_name;
  const id = String(r.title_id).padStart(9, "0");
  manga.thumbnail_url = `${cdnUrl}/titles/${id.slice(0, 3)}/${id.slice(0, 6)}/${id}/${id}_large_vertical.jpg`;
  return manga;
}

export interface DetailsResponse {
  title: Title;
  episodes: Episode[];
}

export interface Title {
  name: string;
  summary?: string | null;
  vertical_thumbnail_url?: string | null;
  artists?: NamedEntity[] | null;
  genres?: NamedEntity[] | null;
  sub_genres?: NamedEntity[] | null;
  tags?: NamedEntity[] | null;
  is_completed?: boolean | null;
  is_mature?: boolean | null;
  agency?: string | null;
}

export function titleToSManga(t: Title): SManga {
  const manga = SManga.create();
  manga.title = t.name;
  manga.artist = t.artists?.map((it) => it.name).join(", ");
  let description = "";
  if (t.summary != null) description += t.summary;
  if (t.agency != null) description += `\n\nPublisher: ${t.agency}`;
  if (t.is_mature === true) description += "\n\nRating: 18+";
  manga.description = description;
  manga.genre = [...new Set([t.genres, t.sub_genres, t.tags].filter((it) => it != null).flat().map((it) => it.name))].join(", ");
  manga.status = t.is_completed === true ? SManga.COMPLETED : SManga.ONGOING;
  manga.thumbnail_url = t.vertical_thumbnail_url?.replace("_vertical.jpg", "_large_vertical.jpg");
  return manga;
}

export interface NamedEntity {
  name: string;
}

export interface Episode {
  id: number;
  number: string;
  start_at?: string | null;
  is_free?: boolean | null;
  was_purchased?: boolean | null;
  display_order?: number | null;
}

export const isLocked = (e: Episode): boolean => e.is_free === false && e.was_purchased === false;

const dateFormat = DateTimeFormatter.ofPattern("M/d/yy", Locale.ROOT);

export function episodeToSChapter(e: Episode): SChapter {
  const chapter = SChapter.create();
  const lock = isLocked(e) ? "🔒 " : "";
  chapter.url = String(e.id);
  chapter.name = `${lock}Chapter ${e.number}`;
  chapter.date_upload = dateFormat.tryParseDate(e.start_at);
  chapter.chapter_number = e.display_order ?? -1;
  return chapter;
}

export interface ViewerResponse {
  image_data?: ImageData[] | null;
}

export interface ImageData {
  num: number;
  path: string;
}

export interface PageResponse {
  encrypted_image: string;
  iv: string;
  salt: string;
  iterations: number;
  kms_encrypted_data_key: string;
  file_name: string;
}

export interface KeyRequestBody {
  encrypted_key: string;
  file_name: string;
}

export interface KeyResponse {
  decrypted_key: string;
}
