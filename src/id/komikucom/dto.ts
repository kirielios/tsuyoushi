// Port of keiyoushi/extensions-source src/id/komikucom/Dto.kt
import { Page, SChapter, SManga } from "../../../sdk/index.ts";

export interface ComicListResponse {
  items?: ComicDto[] | null;
  page?: number | null;
  totalPages?: number | null;
}

export interface ComicDto {
  id: number;
  slug: string;
  title: string;
  genres?: string[] | null;
  comicStatus?: string | null;
  /** Not upstream: the API now sends the status here, comicStatus is gone. */
  status?: string | null;
  author?: string | null;
  artist?: string | null;
  synopsis?: string | null;
  coverUrl?: string | null;
}

export function comicToSManga(dto: ComicDto): SManga {
  const lowerStatus = (dto.comicStatus ?? dto.status)?.toLowerCase();
  const manga = SManga.create();
  manga.url = `/manga/${dto.slug}`;
  manga.title = dto.title;
  manga.thumbnail_url = dto.coverUrl ?? undefined;
  manga.author = [dto.author, dto.artist].filter((it): it is string => it != null && it.trim() !== "").join(", ");
  manga.description = dto.synopsis ?? undefined;
  manga.genre = dto.genres?.join(", ");
  switch (lowerStatus) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
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
  manga.memo = { id: dto.id };
  manga.initialized = true;
  return manga;
}

export interface ChapterDto {
  id: number;
  n?: number | null;
  title?: string | null;
  releasedLabel?: string | null;
}

export function chapterToSChapter(dto: ChapterDto, comicId: number): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/${comicId}/${dto.id}`;
  // Kotlin prints a whole Float as an Int and a null one as "null"
  chapter.name = dto.title ?? `Chapter ${dto.n == null ? "null" : String(dto.n)}`;
  chapter.date_upload = parseRelativeLabel(dto.releasedLabel);
  chapter.chapter_number = dto.n ?? 0;
  return chapter;
}

export interface ChapterDetailDto {
  id: number;
  pages?: PageDto[] | null;
}

export const toPageList = (dto: ChapterDetailDto): Page[] => dto.pages?.map((page, index) => new Page(index, "", page.url)) ?? [];

export interface PageDto {
  url: string;
}

export interface FilterResponse {
  genres?: string[] | null;
  statuses?: string[] | null;
  types?: string[] | null;
  sorts?: SortDto[] | null;
}

export interface SortDto {
  key?: string | null;
  label?: string | null;
}

export const sortToPair = (dto: SortDto): [string, string] => [dto.label ?? dto.key ?? "", dto.key ?? ""];

const digits = (label: string) => {
  const d = label.replace(/\D/g, "");
  return d ? Number(d) : 0;
};

export function parseRelativeLabel(label: string | null | undefined): number {
  if (label == null || label.trim() === "") return 0;
  const now = Date.now();
  if (label.includes("baru saja")) return now;
  if (label.includes("menit")) return now - digits(label) * 60_000;
  if (label.includes("jam")) return now - digits(label) * 3_600_000;
  if (label.includes("hari")) return now - digits(label) * 86_400_000;
  // absolute date like "9 Feb 2022" / "28 Agu 2022" (mixed EN/ID month abbreviations)
  const parts = label.split(" ");
  if (parts.length === 3) {
    if (!/^[+-]?\d+$/.test(parts[0])) return 0;
    const month = MONTH_ABBREVIATIONS[parts[1].toLowerCase()];
    if (month == null) return 0;
    if (!/^[+-]?\d+$/.test(parts[2])) return 0;
    const [day, year] = [Number(parts[0]), Number(parts[2])];
    const d = new Date(year, month - 1, day); // LocalDate.of(...).atStartOfDay(systemDefault)
    if (d.getMonth() !== month - 1 || d.getDate() !== day) throw new Error(`Invalid date '${label}'`); // LocalDate.of throws
    return d.getTime();
  }
  return 0;
}

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5,
  jun: 6, jul: 7, agu: 8, aug: 8, sep: 9, okt: 10,
  oct: 10, nov: 11, des: 12, dec: 12,
};
