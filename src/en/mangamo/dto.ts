// Port of keiyoushi/extensions-source src/en/mangamo/dto/*.kt
// Firestore integerValue arrives as a quoted string; kotlinx (isLenient) reads it as a number, so reduceField converts it.

export interface ChapterDto {
  alwaysFree?: boolean;
  id?: number;
  chapterNumber?: number;
  createdAt?: number;
  enabled?: boolean;
  name?: string;
  onlyTransactional?: boolean;
  seriesId?: number;
  type?: string;
}
export const isVolume = (c: ChapterDto) => c.type === "volume";

export interface AuthorDto {
  id: number;
  name: string;
}
export interface GenreDto {
  id: number;
  name: string;
}
export interface SeriesDto {
  id?: number;
  authors?: AuthorDto[];
  description?: string;
  enabled?: boolean;
  genres?: GenreDto[];
  maxFreeChapterNumber?: number;
  maxMeteredReadingChapterNumber?: string; // Sometimes "NaN"
  name?: string;
  name_lowercase?: string;
  ongoing?: boolean;
  onlyOnMangamo?: boolean;
  onlyTransactional?: boolean;
  releaseStatusTag?: string;
  titleArt?: string;
  updatedAt?: number;
}

export interface UserDto {
  isSubscribed?: boolean;
}
export interface PageDto {
  id: number;
  pageNumber: number;
  uri: string;
}
export interface MangamoLoginDto {
  accessToken: string;
}
export interface FirebaseAuthDto {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}
export interface FirebaseRegisterDto extends FirebaseAuthDto {
  localId: string;
}
export interface TokenRefreshDto {
  expires_in: number;
  id_token: string;
  refresh_token: string;
}

// DocumentDto.kt
export interface DocumentDto<T> {
  fields: T;
}
export interface DocumentWrapper<T> {
  document?: DocumentDto<T> | null;
}
export type QueryResultDto<T> = DocumentWrapper<T>[];
export const documents = <T>(q: QueryResultDto<T>): DocumentDto<T>[] => q.flatMap((it) => (it.document ? [it.document] : []));
export const elements = <T>(q: QueryResultDto<T>): T[] => q.flatMap((it) => (it.document ? [it.document.fields] : []));

type Json = unknown;

/** DocumentSerializer.transformDeserialize: unwraps Firestore's typed values into plain JSON. */
export function parseDocument<T>(text: string): DocumentDto<T> {
  return transformDeserialize(JSON.parse(text)) as DocumentDto<T>;
}
/** A runQuery response: a list of {document?}. */
export function parseQueryResult<T>(text: string): QueryResultDto<T> {
  return (JSON.parse(text) as { document?: Json }[]).map((it) => ({ document: it.document ? (transformDeserialize(it.document) as DocumentDto<T>) : null }));
}

function transformDeserialize(element: Json): Json {
  const obj = { ...(element as Record<string, Json>) };
  obj.fields = "fields" in obj ? reduceFieldsObject(obj.fields) : {};
  return obj;
}
function reduceFieldsObject(fields: Json): Json {
  return Object.fromEntries(Object.entries(fields as Record<string, Json>).map(([k, v]) => [k, reduceField(v)]));
}
function reduceField(element: Json): Json {
  const [key, value] = Object.entries(element as Record<string, Json>)[0];
  switch (key) {
    case "arrayValue":
      return ((value as { values?: Json[] }).values ?? []).map(reduceField);
    case "mapValue":
      return reduceFieldsObject((value as { fields: Json }).fields);
    case "integerValue":
      return typeof value === "string" ? Number(value) : value;
    default:
      return value;
  }
}
