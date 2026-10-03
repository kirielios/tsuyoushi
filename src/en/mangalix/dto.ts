// Port of keiyoushi/extensions-source src/en/mangalix/Dto.kt
import { SManga, tryParseInstant } from "../../../sdk/index.ts";

export interface MangaDto {
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  author: string;
  status: string;
  rating: number;
  releaseYear: number;
  genres: string[];
  latestChapter?: LatestChapterDto | null;
}

export interface LatestChapterDto {
  releaseDate?: string | null;
}

export interface ChapterDto {
  id: string;
  number: number;
  title: string;
  pages: string[];
  releaseDate?: string | null;
}

/** kotlinx.serialization's strictness for List<MangaDto>: a missing/mistyped required field fails the whole list. */
export function isMangaDtoList(value: unknown): value is MangaDto[] {
  if (!Array.isArray(value)) return false;
  return value.every((m) => {
    if (m === null || typeof m !== "object") return false;
    const o = m as Record<string, unknown>;
    return (
      ["slug", "title", "description", "coverImage", "author", "status"].every((k) => typeof o[k] === "string") &&
      typeof o.rating === "number" &&
      typeof o.releaseYear === "number" &&
      Array.isArray(o.genres) &&
      o.genres.every((g) => typeof g === "string") &&
      (o.latestChapter == null || typeof o.latestChapter === "object")
    );
  });
}

export const latestTimestamp = (m: MangaDto): number => toMangaTimestamp(m.latestChapter?.releaseDate);

export function toSManga(m: MangaDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = m.slug;
  manga.title = m.title;
  const cover = m.coverImage.trim() === "" ? null : m.coverImage;
  manga.thumbnail_url =
    cover == null
      ? undefined
      : /^https?:\/\//i.test(cover)
        ? cover
        : cover.startsWith("//")
          ? `https:${cover}`
          : `${baseUrl.replace(/\/+$/, "")}/${cover.replace(/^\/+/, "")}`;
  manga.author = m.author.trim() === "" ? undefined : m.author;
  manga.description = m.description.trim() === "" ? undefined : m.description;
  manga.genre = m.genres.length ? m.genres.join(", ") : undefined;
  manga.status = toMangaStatus(m.status);
  manga.initialized = true;
  return manga;
}

/** Instant.parse, else LocalDate at UTC start of day, else 0. */
export function toMangaTimestamp(value: string | null | undefined): number {
  if (value == null) return 0;
  const instant = tryParseInstant(value);
  if (instant) return instant;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? (Date.parse(`${value}T00:00:00Z`) || 0) : 0;
}

function toMangaStatus(status: string): number {
  switch (status.toLowerCase().trim().replaceAll("-", " ").replace(/\s+/g, " ")) {
    case "ongoing":
    case "publishing":
    case "releasing":
    case "active":
      return SManga.ONGOING;
    case "completed":
    case "complete":
    case "finished":
      return SManga.COMPLETED;
    case "hiatus":
    case "on hiatus":
    case "paused":
      return SManga.ON_HIATUS;
    case "cancelled":
    case "canceled":
    case "dropped":
    case "axed":
    case "discontinued":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}
