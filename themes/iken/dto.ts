// Port of keiyoushi/extensions-source lib-multisrc/iken/Dto.kt
import { SChapter, SManga, isBlank, tryParseInstant, type Document } from "../../sdk/index.ts";

export interface SearchResponse {
  posts: Manga[];
  totalCount: number;
}

export interface MangaDto {
  totalChapterCount?: number | null;
  post: Manga;
}

export interface ChapterDto {
  post: ChapterPost;
}

export interface ChapterPost {
  chapters: Chapter[];
}

export interface PageResponse {
  chapter: PageDto;
}

export interface ViewQuery {
  postId?: number;
  chapterId?: number;
}

export interface RelatedMangaDto {
  recommendations: Manga[];
}

export interface Manga {
  id: number;
  slug: string;
  postTitle: string;
  postContent?: string | null;
  isNovel?: boolean; // rawIsNovel
  featuredImage?: string | null;
  alternativeTitles?: string | null;
  author?: string | null;
  artist?: string | null;
  seriesType?: string | null;
  seriesStatus?: string | null;
  genres?: Genre[];
  chapters?: Chapter[];
}

/** Manga.isNovel */
export const mangaIsNovel = (m: Manga) => (m.isNovel ?? false) || m.seriesType?.toLowerCase() === "novel";

/** Manga.toSManga(); `parse` is Jsoup.parse. */
export function mangaToSManga(m: Manga, parse: (html: string) => Document): SManga {
  const manga = SManga.create();
  manga.url = `${m.slug}#${m.id}`;
  manga.title = m.postTitle;
  manga.thumbnail_url = m.featuredImage ?? undefined;
  manga.author = m.author || undefined;
  manga.artist = m.artist || undefined;
  manga.description = getDescription(m, m.postContent, parse);
  manga.genre = getGenres(m);
  manga.status = getStatus(m);
  manga.memo = { id: m.id, slug: m.slug };
  return manga;
}

function getDescription(m: Manga, postContent: string | null | undefined, parse: (html: string) => Document) {
  let s = "";
  if (postContent) s += parse(postContent.replaceAll("\n", "<br>")).text();
  if (m.alternativeTitles) {
    s += "\n\n";
    s += "Alternative Names: ";
    s += m.alternativeTitles;
  }
  return s.trim();
}

function getStatus(m: Manga) {
  switch (m.seriesStatus) {
    case "ONGOING":
    case "COMING_SOON":
    case "MASS_RELEASED":
      return SManga.ONGOING;
    case "COMPLETED":
      return SManga.COMPLETED;
    case "CANCELLED":
    case "DROPPED":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

function getGenres(m: Manga) {
  const list: string[] = [];
  if (m.seriesType === "MANGA") list.push("Manga");
  else if (m.seriesType === "MANHUA") list.push("Manhua");
  else if (m.seriesType === "MANHWA") list.push("Manhwa");
  (m.genres ?? []).forEach((it) => list.push(it.name));
  return [...new Set(list)].join(", ");
}

export interface Genre {
  id: number;
  name: string;
}

export interface DescriptionDto {
  description: string;
}

export interface Chapter {
  id: number;
  slug: string;
  number: unknown; // JsonPrimitive
  title?: string | null;
  createdAt: string;
  isLocked?: boolean | null;
  isTimeLocked?: boolean | null;
  mangaPost?: MangaPostDto | null;
  price?: number | null;
  chapterPurchased?: boolean | null;
}

/** Chapter.isLocked() */
export const chapterIsLocked = (c: Chapter) => c.isLocked === true || c.isTimeLocked === true || ((c.chapterPurchased ?? false) === false && (c.price ?? 0) !== 0);

/** Chapter.toSChapter(mangaSlug) */
export function chapterToSChapter(c: Chapter, mangaSlug: string | null): SChapter {
  const chapter = SChapter.create();
  const prefix = chapterIsLocked(c) ? "🔒 " : "";
  const suffix = !isBlank(c.title) ? ` - ${c.title}` : "";
  const seriesSlug = (mangaSlug ?? c.mangaPost?.slug)!;
  chapter.url = `/series/${seriesSlug}/${c.slug}#${c.id}`;
  // JsonPrimitive.toString(): numbers as written, strings quoted
  chapter.name = `${prefix}Chapter ${typeof c.number === "string" ? JSON.stringify(c.number) : String(c.number)}${suffix}`;
  chapter.date_upload = tryParseInstant(c.createdAt);
  chapter.memo = { seriesSlug, slug: c.slug, id: c.id };
  return chapter;
}

export interface MangaPostDto {
  slug?: string | null;
}

export interface PageDto {
  images: PageParseDto[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

export interface PageParseDto {
  url: string;
  order?: number | null;
}
