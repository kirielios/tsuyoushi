// Port of keiyoushi/extensions-source src/en/inkr/Dto.kt
import { SChapter, SManga, tryParseInstant } from "../../../sdk/index.ts";

export const CHAPTER_FREE_MEMO = "free";
export const CHAPTER_ACCESSIBLE_MEMO = "accessible";
export const CHAPTER_TITLE_MEMO = "title";

export interface FilteredResponse {
  data?: string[];
}

/** Encoded as kotlinx does with Mihon's Json (explicitNulls = false, no encodeDefaults): nulls and `limit` are left out. */
export interface FilteredRequest {
  limit?: number;
  orStyleOrigin?: string[] | null;
  releaseStatus?: string | null;
  andGenres?: string[] | null;
}

export interface SearchResponse {
  data?: { title?: string[] };
}

export interface ChapterPagesIncludes {
  chapterPages: { fields: string[]; includes: Record<string, never>; includeKey: string };
}

export interface ContentJsonRequest {
  fields: string[];
  oids: string[];
  includes?: ChapterPagesIncludes | null;
}

export interface ContentMapResponse {
  data?: Record<string, unknown>;
}

export interface TitleDto {
  oid: string;
  name?: string;
  thumbnailImage?: string | null;
  releaseStatus?: string | null;
  styleOrigin?: string | null;
  keyGenreList?: string[];
  summary?: string[];
  pageReadCount?: number;
  latestChapterFirstPublishedDate?: string | null;
  chapterList?: string[];
  titleCreators?: TitleCreatorDto[];
  isExplicit?: boolean;
  monetizationType?: string | null;
  isAvailable?: boolean;
  isRemovedFromSale?: boolean;
}

export function titleToSManga(t: TitleDto, thumbnailUrl: string | null | undefined, authors: string | null | undefined, genres: string | null | undefined): SManga {
  const manga = SManga.create();
  manga.url = t.oid;
  manga.title = t.name ?? "";
  manga.thumbnail_url = thumbnailUrl ?? undefined;
  manga.author = authors ?? undefined;
  manga.artist = authors ?? undefined;
  manga.description = (t.summary ?? []).join("\n") || undefined;
  const style = t.styleOrigin?.replaceAll("-", " ");
  manga.genre = [style != null ? style.charAt(0).toUpperCase() + style.slice(1) : null, genres]
    .filter((it): it is string => it != null && it.trim() !== "")
    .join(", ");
  switch (t.releaseStatus?.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export interface TitleCreatorDto {
  creator: string;
  role?: string | null;
}

export interface NamedDto {
  oid: string;
  name?: string;
  url?: string | null;
}

export class ChapterDto {
  oid = "";
  name = "";
  order = 0;
  firstPublishedDate: string | null = null;
  publishedDate: string | null = null;
  revenueType: string | null = null;
  coinPrice = 0;
  isPurchasedByCoin = false;
  isPurchasedBySub = false;

  static from(json: unknown): ChapterDto {
    return Object.assign(new ChapterDto(), json);
  }

  get isFree(): boolean {
    const type = this.revenueType?.toLowerCase();
    return type === "ad" || type === "free";
  }

  isAccessible(isSubscriber = false): boolean {
    if (this.isFree || this.isPurchasedByCoin || this.isPurchasedBySub) return true;
    if (!isSubscriber) return false;
    const type = this.revenueType?.toLowerCase();
    return type === "subscription-only" || type === "mixed";
  }

  toSChapter(titleOid: string, showPaidMarker: boolean, isSubscriber = false): SChapter {
    const accessible = this.isAccessible(isSubscriber);
    const chapterName = !accessible && showPaidMarker ? `🔒 ${this.name}` : this.name;
    const chapter = SChapter.create();
    chapter.url = this.oid;
    chapter.name = chapterName;
    chapter.chapter_number = this.order;
    chapter.date_upload = tryParseInstant(this.firstPublishedDate ?? this.publishedDate);
    chapter.memo = {
      [CHAPTER_FREE_MEMO]: this.isFree,
      [CHAPTER_ACCESSIBLE_MEMO]: accessible,
      [CHAPTER_TITLE_MEMO]: titleOid,
    };
    return chapter;
  }
}

export interface ChapterPagesDto {
  chapterPages?: ChapterPageDto[];
}

export interface ChapterPageDto {
  page?: string | null;
  url: string;
}
