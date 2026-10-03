// Port of keiyoushi/extensions-source src/all/komga/dto/Dto.kt and dto/PageWrapperDto.kt
import { SManga } from "../../../sdk/index.ts";

export interface ConvertibleToSManga {
  toSManga(baseUrl: string): SManga;
}

export interface LibraryDto {
  id: string;
  name: string;
}

export interface SeriesDto {
  id: string;
  libraryId: string;
  name: string;
  created: string | null;
  lastModified: string | null;
  fileLastModified: string;
  booksCount: number;
  metadata: SeriesMetadataDto;
  booksMetadata: BookMetadataAggregationDto;
}

export function seriesToSManga(dto: SeriesDto, baseUrl: string): SManga {
  const { metadata, booksMetadata } = dto;
  const manga = SManga.create();
  manga.title = metadata.title;
  manga.url = `${baseUrl}/api/v1/series/${dto.id}`;
  manga.thumbnail_url = `${manga.url}/thumbnail`;
  if (metadata.status === "ENDED" && metadata.totalBookCount != null && dto.booksCount < metadata.totalBookCount) manga.status = SManga.PUBLISHING_FINISHED;
  else if (metadata.status === "ENDED") manga.status = SManga.COMPLETED;
  else if (metadata.status === "ONGOING") manga.status = SManga.ONGOING;
  else if (metadata.status === "ABANDONED") manga.status = SManga.CANCELLED;
  else if (metadata.status === "HIATUS") manga.status = SManga.ON_HIATUS;
  else manga.status = SManga.UNKNOWN;
  manga.genre = [...new Set([...metadata.genres, ...metadata.tags, ...(booksMetadata.tags ?? [])].sort())].join(", ");
  manga.description = metadata.summary.trim() ? metadata.summary : booksMetadata.summary;
  const map = new Map<string, string[]>();
  for (const it of booksMetadata.authors ?? []) map.set(it.role, [...(map.get(it.role) ?? []), it.name]);
  manga.author = map.get("writer") ? [...new Set(map.get("writer"))].join(", ") : undefined;
  manga.artist = map.get("penciller") ? [...new Set(map.get("penciller"))].join(", ") : undefined;
  return manga;
}

export interface SeriesMetadataDto {
  status: string;
  created: string | null;
  lastModified: string | null;
  title: string;
  titleSort: string;
  summary: string;
  summaryLock: boolean;
  readingDirection: string;
  readingDirectionLock: boolean;
  publisher: string;
  publisherLock: boolean;
  ageRating: number | null;
  ageRatingLock: boolean;
  language: string;
  languageLock: boolean;
  genres: string[];
  genresLock: boolean;
  tags: string[];
  tagsLock: boolean;
  totalBookCount?: number | null;
}

export interface BookMetadataAggregationDto {
  authors?: AuthorDto[];
  tags?: string[];
  releaseDate: string | null;
  summary: string;
  summaryNumber: string;
  created: string;
  lastModified: string;
}

export interface BookDto {
  id: string;
  seriesId: string;
  seriesTitle: string;
  name: string;
  number: number;
  created: string | null;
  lastModified: string | null;
  fileLastModified: string;
  sizeBytes: number;
  size: string;
  media: MediaDto;
  metadata: BookMetadataDto;
}

/**
 * org.apache.commons.text.StringSubstitutor(values, "{", "}"): "{key}" becomes the value, "${" escapes a literal "{",
 * unknown or null keys stay as written (or throw with `strict`, isEnableUndefinedVariableException).
 * ponytail: no recursive substitution or ":-" defaults, add if a template needs them.
 */
export function substitute(template: string, values: Record<string, string | null | undefined>, strict = false): string {
  return template.replace(/\$\{|\{([^{}]*)\}/g, (m, key: string | undefined) => {
    if (key === undefined) return "{";
    const v = values[key];
    if (v == null) {
      if (strict) throw new Error(`Cannot resolve variable '${key}'`);
      return m;
    }
    return v;
  });
}

export function getChapterName(book: BookDto, template: string, isFromReadList: boolean): string {
  const values = {
    title: book.metadata.title,
    seriesTitle: book.seriesTitle,
    number: book.metadata.number,
    createdDate: book.created,
    releaseDate: book.metadata.releaseDate,
    size: book.size,
    sizeBytes: String(book.sizeBytes),
  };
  return (isFromReadList ? `${book.seriesTitle} ` : "") + substitute(template, values);
}

export function bookToSManga(dto: BookDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = dto.metadata.title;
  manga.url = `${baseUrl}/api/v1/books/${dto.id}`;
  manga.thumbnail_url = `${manga.url}/thumbnail`;
  manga.status = SManga.UNKNOWN;
  manga.genre = [...new Set(dto.metadata.tags)].join(", ");
  manga.description = dto.metadata.summary;
  manga.author = dto.metadata.authors.map((it) => it.name).join(", ");
  manga.artist = manga.author;
  return manga;
}

export interface MediaDto {
  status: string;
  mediaType: string;
  pagesCount: number;
  mediaProfile?: string; // "DIVINA"
  epubDivinaCompatible?: boolean; // false
}

export interface PageDto {
  number: number;
  fileName: string;
  mediaType: string;
}

export interface BookMetadataDto {
  title: string;
  titleLock: boolean;
  summary: string;
  summaryLock: boolean;
  number: string;
  numberLock: boolean;
  numberSort: number;
  numberSortLock: boolean;
  releaseDate: string | null;
  releaseDateLock: boolean;
  authors: AuthorDto[];
  authorsLock: boolean;
  tags: string[];
  tagsLock: boolean;
}

export interface AuthorDto {
  name: string;
  role: string;
}

export interface CollectionDto {
  id: string;
  name: string;
  ordered: boolean;
  seriesIds: string[];
  createdDate: string;
  lastModifiedDate: string;
  filtered: boolean;
}

export interface ReadListDto {
  id: string;
  name: string;
  summary: string;
  bookIds: string[];
  createdDate: string;
  lastModifiedDate: string;
  filtered: boolean;
}

export function readListToSManga(dto: ReadListDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = dto.name;
  manga.description = dto.summary;
  manga.url = `${baseUrl}/api/v1/readlists/${dto.id}`;
  manga.thumbnail_url = `${manga.url}/thumbnail`;
  manga.status = SManga.UNKNOWN;
  return manga;
}

export interface PageWrapperDto<T> {
  content: T[];
  empty: boolean;
  first: boolean;
  last: boolean;
  number: number;
  numberOfElements: number;
  size: number;
  totalElements: number;
  totalPages: number;
}
