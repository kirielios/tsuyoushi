// Port of keiyoushi/extensions-source src/id/voratoon/Dto.kt
import { Page, SChapter, SManga, substringAfter, substringBefore, toHttpUrl, toHttpUrlOrNull, tryParseInstant } from "../../../sdk/index.ts";

export interface SeriesListResponse {
  data: SeriesItem[];
  meta?: Meta | null;
}

export interface SeriesItem {
  id: number;
  data: SeriesData;
}

export function seriesToSManga(item: SeriesItem): SManga {
  const data = item.data;
  const manga = SManga.create();
  manga.url = `/series/${data.slug ?? item.id}`;
  manga.title = data.title;
  manga.thumbnail_url = data.coverImage ?? undefined;
  manga.author = data.author ?? undefined;
  manga.description = data.synopsis ?? undefined;
  manga.genre = data.genres?.map((it) => it.data.name).join(", ") ?? "";
  switch (data.status?.toLowerCase()) {
    case "ongoing":
    case "on going":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
    case "complete":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "cancelled":
    case "canceled":
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.initialized = true;
  return manga;
}

export interface SeriesData {
  slug: string | null;
  title: string;
  author?: string | null;
  status?: string | null;
  synopsis?: string | null;
  coverImage?: string | null;
  genres?: GenreData[] | null;
}

export interface GenreData {
  data: GenreInfo;
}

export interface GenreInfo {
  name: string;
}

export interface GenreResponse {
  data: GenreItem[];
}

export interface GenreItem {
  id: number;
  data: GenreInfo;
}

export const genreToPair = (it: GenreItem): [string, string] => [it.data.name, String(it.id)];

export interface Meta {
  page?: number | null;
  lastPage?: number | null;
}

export interface SeriesDetailResponse {
  data: SeriesItem;
}

export interface ChapterItem {
  data: ChapterData;
  createdAt?: string | null;
  updatedAt?: string | null;
  chapterIndex?: number | null;
}

/** Kotlin's Float.toString() without a trailing ".0" (JS already prints whole numbers bare) */
const formatIndex = (index: number) => String(index);

export function chapterToSChapter(item: ChapterItem, seriesSlug: string | null): SChapter {
  const chapter = SChapter.create();
  const index = item.data.index ?? item.chapterIndex ?? 0;
  const formattedIndex = formatIndex(index);
  chapter.url = `/series/${seriesSlug}/chapter/${formattedIndex}`;
  chapter.name = item.data.title == null || item.data.title.trim() === "" ? `Chapter ${formattedIndex}` : `Chapter ${formattedIndex}: ${item.data.title}`;
  chapter.date_upload = parseChapterDate(item.createdAt ?? item.updatedAt ?? "");
  chapter.chapter_number = index;
  return chapter;
}

export const chapterToPageList = (item: ChapterItem): Page[] => item.data.images?.map((imageUrl, index) => new Page(index, "", imageUrl)) ?? [];

export interface ChapterData {
  index?: number | null;
  title?: string | null;
  images?: string[] | null;
}

export interface ChapterListResponse {
  data: ChapterItem[];
}

export interface ChapterDetailResponse {
  data: ChapterItem;
}

const parseChapterDate = (dateString: string): number => tryParseInstant(dateString);

const pathSegments = (url: string, baseUrl: string) => (toHttpUrlOrNull(url) ?? toHttpUrl(`${baseUrl}${url}`)).pathSegments;

export const getSlug = (manga: SManga, baseUrl: string): string => pathSegments(manga.url, baseUrl)[1];

export function getSlugAndIndex(chapter: SChapter, baseUrl: string): [string, string] {
  const url = chapter.url;
  if (url.startsWith("/chapter/")) {
    const slug = substringBefore(substringAfter(url, "/chapter/"), "-chapter-");
    const chapterIndex = substringBefore(substringAfter(url, "-chapter-"), "-bahasa-");
    return [slug, chapterIndex];
  }
  const segments = pathSegments(url, baseUrl);
  return [segments[1], segments[3]];
}
