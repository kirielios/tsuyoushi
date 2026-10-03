// Port of keiyoushi/extensions-source src/all/namicomi/dto/*.kt
// kotlinx's polymorphic EntityDto (class discriminator "type") becomes a union on `type`: filterIsInstance<XDto>() is
// a filter on `type`; unknown types are UnknownEntity upstream and simply never match here.

// EntityDto.kt
export interface EntityDto<A = unknown> {
  id?: string;
  type: string;
  relationships?: EntityDto[];
  attributes?: A | null;
}
export function ofType<A>(entities: EntityDto[] | undefined, ...types: string[]): EntityDto<A>[] {
  return (entities ?? []).filter((it) => types.includes(it.type)) as EntityDto<A>[];
}

// ResponseDto.kt
export interface PaginatedResponseDto<T> {
  data?: T[];
  meta: PaginationStateDto;
}
export interface ResponseDto<T> {
  data?: T | null;
}
export interface PaginationStateDto {
  limit?: number;
  offset?: number;
  total?: number;
}
export const hasNextPage = (m: PaginationStateDto) => (m.limit ?? 0) + (m.offset ?? 0) < (m.total ?? 0);

// MangaDto.kt
export type MangaDataDto = EntityDto<MangaAttributesDto>;
export type MangaListDto = PaginatedResponseDto<MangaDataDto>;
export type MangaDto = ResponseDto<MangaDataDto>;
export interface MangaAttributesDto {
  title: Record<string, string>;
  description: Record<string, string>;
  originalLanguage?: string | null;
  contentRating?: string | null;
  publicationStatus?: string | null;
}
export const ContentRatingDto = { SAFE: "safe", RESTRICTED: "restricted", MATURE: "mature" } as const;
export const StatusDto = { ONGOING: "ongoing", COMPLETED: "completed", HIATUS: "hiatus", CANCELLED: "cancelled" } as const;
/** AbstractTagDto's subclasses */
export const TAG_TYPES = ["tag", "primary_tag", "secondary_tag"];
export interface TagAttributesDto {
  group: string;
  name: Record<string, string>;
}
export type TagDto = EntityDto<TagAttributesDto>;

// CoverArtDto.kt / OrganizationDto.kt
export interface CoverArtAttributesDto {
  fileName?: string | null;
}
export interface OrganizationAttributesDto {
  name: string;
}

// ChapterDto.kt
export type ChapterListDto = PaginatedResponseDto<EntityDto<ChapterAttributesDto>>;
export interface ChapterAttributesDto {
  name?: string | null;
  volume?: string | null;
  chapter?: string | null;
  publishAt: string;
}

// EntityAccessMapDto.kt
export type EntityAccessMapDto = ResponseDto<EntityDto<{ map: Record<string, boolean> }>>;
export interface EntityAccessRequestDto {
  entities: { entityId: string; entityType: string }[];
}

// PageListDataDto.kt
export type PageListDto = ResponseDto<{ baseUrl: string; hash: string; source: PageImageDto[]; low: PageImageDto[] }>;
export interface PageImageDto {
  filename: string;
}

// TokenDto.kt
export interface Token {
  id_token: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_at: number; // epoch seconds
  refresh_expires_at?: number | null;
}
export interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in?: number | null;
}
