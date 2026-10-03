// Port of keiyoushi/extensions-source src/all/mangadex/dto/*.kt
// kotlinx's polymorphic EntityDto (class discriminator "type") becomes a union on `type`; `filterIsInstance<AuthorDto>()`
// is `ofType(list, "author")`. Unknown types are UnknownEntity upstream and simply never match here.

// EntityDto.kt
export interface EntityDto<A = unknown> {
  id: string;
  type: string;
  relationships?: EntityDto[];
  attributes?: A | null;
}

/** relationships.filterIsInstance<XDto>() */
export function ofType<A>(entities: EntityDto[] | undefined, type: string): EntityDto<A>[] {
  return (entities ?? []).filter((it) => it.type === type) as EntityDto<A>[];
}
/** relationships.firstInstanceOrNull<XDto>() */
export function firstOfType<A>(entities: EntityDto[] | undefined, type: string): EntityDto<A> | null {
  return ofType<A>(entities, type)[0] ?? null;
}

// ResponseDto.kt
export interface PaginatedResponseDto<T> {
  result: string;
  response?: string;
  data?: T[];
  limit?: number;
  offset?: number;
  total?: number;
}
export const hasNextPage = (r: PaginatedResponseDto<unknown>) => (r.limit ?? 0) + (r.offset ?? 0) < (r.total ?? 0);

export interface ResponseDto<T> {
  result: string;
  response?: string;
  data?: T | null;
}

// AggregateDto.kt
export interface AggregateDto {
  result: string;
  volumes?: Record<string, AggregateVolume> | null;
}
export interface AggregateVolume {
  volume: string;
  count: string;
  chapters: Record<string, AggregateChapter>;
}
export interface AggregateChapter {
  chapter: string;
  count: string;
}

// AtHomeDto.kt
export interface AtHomeDto {
  baseUrl: string;
  chapter: { hash: string; data: string[]; dataSaver: string[] };
}

// AuthorDto.kt
export interface AuthorArtistAttributesDto {
  name: string;
}

// ChapterDto.kt
export type ChapterDataDto = EntityDto<ChapterAttributesDto>;
export type ChapterListDto = PaginatedResponseDto<ChapterDataDto>;
export type ChapterDto = ResponseDto<ChapterDataDto>;
export interface ChapterAttributesDto {
  title: string | null;
  volume: string | null;
  chapter: string | null;
  pages: number;
  publishAt: string;
  updatedAt: string;
  readableAt: string;
  externalUrl: string | null;
  isUnavailable?: boolean;
}
/**
 * There are two cases where this property returns true:
 * 1. The chapter is from an external website and has no pages
 * 2. The chapter is from an external website, has only one page, and was updated after it was readable
 *
 * In the second case, the external chapter is removed and is replaced with a single page stating that the chapter is removed.
 */
export const isInvalid = (a: ChapterAttributesDto) => a.externalUrl != null && (a.pages === 0 || (a.pages === 1 && a.updatedAt !== a.readableAt));

// CoverArtDto.kt
export interface CoverArtAttributesDto {
  fileName?: string | null;
  locale?: string | null;
}
export type CoverArtDto = EntityDto<CoverArtAttributesDto>;
export type CoverArtListDto = PaginatedResponseDto<CoverArtDto>;

// ListDto.kt
export interface ListAttributesDto {
  name: string;
  visibility: string;
  version: number;
}
export type ListDto = ResponseDto<EntityDto<ListAttributesDto>>;

// MangaDto.kt
export type MangaDataDto = EntityDto<MangaAttributesDto>;
export type MangaListDto = PaginatedResponseDto<MangaDataDto>;
export type MangaDto = ResponseDto<MangaDataDto>;
export interface MangaAttributesDto {
  title: LocalizedString;
  altTitles: LocalizedString[];
  description: LocalizedString;
  originalLanguage: string | null;
  lastVolume: string | null;
  lastChapter: string | null;
  contentRating?: string | null; // ContentRatingDto
  publicationDemographic?: string | null; // PublicationDemographicDto
  status?: string | null; // StatusDto
  tags: TagDto[];
}

export const ContentRatingDto = { SAFE: "safe", SUGGESTIVE: "suggestive", EROTICA: "erotica", PORNOGRAPHIC: "pornographic" };
export const PublicationDemographicDto = { NONE: "none", SHOUNEN: "shounen", SHOUJO: "shoujo", JOSEI: "josei", SEINEN: "seinen" };
export const StatusDto = { ONGOING: "ongoing", COMPLETED: "completed", HIATUS: "hiatus", CANCELLED: "cancelled" };

export type TagDto = EntityDto<{ group: string }>;

export type LocalizedString = Record<string, string>;
/**
 * LocalizedStringSerializer: temporary workaround while Dex API still returns arrays instead of objects in the places
 * that use [LocalizedString]; non-string values become "".
 */
export function localized(value: unknown): LocalizedString {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === null || typeof v === "object" ? "" : String(v)]));
}

/** Applies LocalizedStringSerializer to a manga's title/altTitles/description, as decoding does upstream. */
export function normalizeManga<T extends MangaDataDto | null | undefined>(m: T): T {
  const a = m?.attributes;
  if (a) {
    a.title = localized(a.title);
    a.altTitles = (a.altTitles ?? []).map(localized);
    a.description = localized(a.description);
    a.tags ??= [];
  }
  return m;
}

// ScanlationGroupDto.kt
export interface ScanlationGroupAttributes {
  name: string;
}

// UserDto.kt
export interface UserAttributes {
  username: string;
}
