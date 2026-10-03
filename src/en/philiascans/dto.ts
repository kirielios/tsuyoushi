// Port of keiyoushi/extensions-source src/en/philiascans/Dto.kt
import { SChapter, SManga, tryParseInstant } from "../../../sdk/index.ts";

export interface SeriesResponse {
  items: Item[];
  page: number;
  totalPages: number;
}
export const hasNextPage = (r: SeriesResponse) => r.page < r.totalPages;

export interface Item {
  slug: string;
  title: string;
  coverImageUrl?: string | null;
}

const cover = (coverImageUrl: string | null | undefined, baseUrl: string) => (coverImageUrl != null ? (coverImageUrl.startsWith("http") ? coverImageUrl : `${baseUrl}/${coverImageUrl}`) : undefined);

export function itemToSManga(it: Item, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = it.slug;
  manga.title = it.title;
  manga.thumbnail_url = cover(it.coverImageUrl, baseUrl);
  return manga;
}

export interface Info {
  name: string;
}

export interface DetailsResponse {
  title: string;
  alternativeTitles?: string[] | null;
  synopsis?: string | null;
  coverImageUrl?: string | null;
  status?: string | null;
  genres?: Info[] | null;
  authors?: Info[] | null;
  artists?: Info[] | null;
}

export function detailsToSManga(d: DetailsResponse, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = d.title;
  let description = "";
  if (d.synopsis != null) description += d.synopsis;
  if (d.alternativeTitles?.length) {
    description += "\n\nAlternative Titles:\n";
    description += d.alternativeTitles.map((altTitle) => `- ${altTitle}`).join("\n");
  }
  manga.description = description;
  manga.author = d.authors?.map((it) => it.name).join(", ");
  manga.artist = d.artists?.map((it) => it.name).join(", ");
  manga.genre = d.genres?.map((it) => it.name).join(", ");
  switch (d.status?.toLowerCase()) {
    case "on_going":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.thumbnail_url = cover(d.coverImageUrl, baseUrl);
  return manga;
}

export interface ChapterResponse {
  items: ChapterItem[];
}

export interface ChapterItem {
  number: string;
  title?: string | null;
  slug: string;
  publishedAt?: string | null;
  coinPrice?: number | null;
  purchased?: boolean | null;
}

export const isLocked = (c: ChapterItem) => c.purchased === false && c.coinPrice !== 0;

export function chapterToSChapter(c: ChapterItem, mangaSlug: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${mangaSlug}/${c.slug}`;
  const lock = isLocked(c) ? "🔒 " : "";
  const validTitle = c.title != null && c.title.trim() && c.title !== "null" && c.title !== c.number ? c.title : null;
  chapter.name = lock + (validTitle != null ? `Chapter ${c.number} - ${validTitle}` : `Chapter ${c.number}`);
  chapter.date_upload = tryParseInstant(c.publishedAt);
  chapter.chapter_number = Number.parseFloat(c.number);
  return chapter;
}

export interface TokenResponse {
  token: string;
  expiresAt: number;
}

export interface ViewerResponse {
  chapter: Chapter;
  hasAccess: boolean;
}

export interface Chapter {
  id: number;
  scrambled: boolean;
  pages: Page[];
}

export interface Page {
  position: number;
  url: string;
  mime: string;
}

export interface PageKeys {
  chapterKeyB64: string;
  gridSize: number;
  sessionDefault?: boolean;
}

export interface OpenResponse {
  sessionId: string;
  payloadA?: string | null;
}

export interface DrmResponse {
  payloadB?: string | null;
}
