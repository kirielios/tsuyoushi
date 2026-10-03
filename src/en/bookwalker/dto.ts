// Port of keiyoushi/extensions-source src/en/bookwalker/dto/*.kt
//
// kotlinx.serialization.protobuf classes become interfaces plus decodeProto schemas (responses) and small encoders
// (requests). kotlinx skips default-valued properties when encoding (no EncodeDefault), which the encoders mirror.
import type { ProtoSchema } from "../../../sdk/protobuf.ts";

// ---- encoding helpers ----
const utf8 = new TextEncoder();
const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = BigInt(n);
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
};
const concat = (...parts: (number[] | Uint8Array)[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const fInt = (field: number, v: number) => concat(varint(field << 3), varint(v));
const fBytes = (field: number, b: Uint8Array) => concat(varint((field << 3) | 2), varint(b.length), b);
const fStr = (field: number, s: string) => fBytes(field, utf8.encode(s));

// ---- value classes ----
export const ChapterType = { VOLUMES: 1, CHAPTERS: 2 } as const;
export const SeriesFormat = { MANGA: 1, WEBTOON: 3, NOVEL: 2, AUDIOBOOKS: 4 } as const;
export const TagKind = { GENRE: 1, TAG: 2 } as const;
export const TagInclusionMode = { INCLUDE: 2, EXCLUDE: 3 } as const;

// ---- SearchRequest.kt ----
export interface LimitOffsetDto {
  limit: number;
  offset?: number;
}
export class SortDto {
  private constructor(
    private readonly sortMode: number,
    private readonly _reverse: number | null = null,
  ) {}
  reverse() {
    return new SortDto(this.sortMode, this._reverse == null ? 1 : null);
  }
  encode() {
    return concat(fInt(1, this.sortMode), this._reverse != null ? fInt(2, this._reverse) : []);
  }
  static readonly RELEVANCE = new SortDto(0);
  static readonly ALPHABETICAL_ASC = new SortDto(1);
  static readonly NEWEST = new SortDto(2);
  static readonly LAST_UPDATED = new SortDto(3);
  static readonly POPULAR = new SortDto(4);
  static readonly LAST_PURCHASED = new SortDto(5);
}
export interface TagFilterDto {
  id: string;
  mode: number;
}
export interface FilterDto {
  type: string;
  include: TagFilterDto[];
}
export interface SearchRequestDto {
  limitOffset: LimitOffsetDto;
  query?: string | null;
  sort: SortDto;
  formats: number[];
  filters: FilterDto[];
  /** SearchPageType.Browse is the only domain used */
  searchDomain: "browse";
}

const encodeLimitOffset = (l: LimitOffsetDto) => concat(fInt(1, l.limit), l.offset ? fInt(2, l.offset) : []);
// SearchPageTypeDto(SearchPageType.Browse()): @ProtoOneOf unwraps to Browse's single field 1 (unk = 1, EncodeDefault)
const encodeSearchDomain = (field: number) => fBytes(field, fInt(1, 1));

export function encodeSearchRequest(r: SearchRequestDto): Uint8Array {
  return concat(
    fBytes(1, encodeLimitOffset(r.limitOffset)),
    r.query != null ? fStr(2, r.query) : [],
    fBytes(3, r.sort.encode()),
    ...r.formats.map((f) => fInt(4, f)),
    ...r.filters.map((f) => fBytes(5, concat(fStr(1, f.type), ...f.include.map((t) => fBytes(3, concat(fStr(1, t.id), fInt(3, t.mode))))))),
    encodeSearchDomain(6),
  );
}

// ---- other requests ----
export const encodeMangaDetailsRequest = (id: string) => fStr(1, id);
export const encodeChaptersRequest = (id: string, chapterType: number) => concat(fStr(1, id), fInt(2, chapterType));
export const encodeViewerRequest = (productId: string) => fStr(1, productId);
export const encodeSearchHeaderRequest = () => new Uint8Array(0);
export const encodeSearchFilterOptionsRequest = (filterType: string, limitOffset: LimitOffsetDto) => concat(fStr(1, filterType), fBytes(3, encodeLimitOffset(limitOffset)), encodeSearchDomain(5));

// ---- responses ----
export interface ThumbnailInfoDto {
  urlFormat: string;
}
/** @param size The vertical height in pixels. Must be divisible by 120 and <=1200. */
export const getImageUrl = (t: ThumbnailInfoDto, size: number) => t.urlFormat.replace("{size}", String(size)).replace("{format}", "webp");

export interface TagDto {
  id: string;
  name: string;
  tagKind: number;
}
export interface MangaInfoDto {
  id: string;
  slug: string;
  title: string;
  thumbnail?: ThumbnailInfoDto;
  tags: TagDto[];
}
export interface MangaMetadataSectionDto {
  name: string;
  contents: { name: string }[];
}
export interface MangaDetailsResponseDto {
  info: MangaInfoDto;
  _status?: number;
  tagline?: string;
  description?: string;
  metadata: MangaMetadataSectionDto[];
}
export interface ChapterDto {
  id: string;
  readId: string;
  slug: string;
  thumbnail?: ThumbnailInfoDto;
  chapterNumber: { prefix: string; number: string };
  title: string;
  releaseInfo: { releaseDate: { value: number }; _isAvailable?: number; _isReleased?: number };
  currentPrice?: number;
  regularPrice?: number;
  _isOwned?: number;
}
export interface ChaptersResponseDto {
  chapterType: number;
  chapters: ChapterDto[];
}
export interface LimitOffsetCountDto {
  limit: number;
  offset?: number;
  totalCount: number;
}
export interface SearchResponseDto {
  countInfo: LimitOffsetCountDto;
  results: { value: { value: MangaInfoDto }[] };
}
export interface FilterInfoDto {
  id: string;
  name: string;
}
export interface SearchFilterOptionsDto {
  filterType: string;
  name: string;
  options: FilterInfoDto[];
  _hasMore?: number;
}
export interface SearchHeaderResponseDto {
  genres: SearchFilterOptionsDto;
}
export interface SearchFilterOptionsResponseDto {
  countInfo: LimitOffsetCountDto;
  results: FilterInfoDto[];
}
export interface ViewerResponse {
  details: { manifestUrl: string; mimeType: string };
}

const Thumbnail: ProtoSchema = { 1: ["urlFormat", "string"] };
const Tag: ProtoSchema = { 1: ["id", "string"], 3: ["name", "string"], 5: ["tagKind", "int"] };
const MangaInfo: ProtoSchema = { 1: ["id", "string"], 2: ["slug", "string"], 4: ["title", "string"], 8: ["thumbnail", Thumbnail], 10: ["tags", Tag, true] };
const FilterInfo: ProtoSchema = { 1: ["id", "string"], 2: ["name", "string"] };
const LimitOffsetCount: ProtoSchema = { 1: ["limit", "int"], 2: ["offset", "int"], 3: ["totalCount", "int"] };
const SearchFilterOptions: ProtoSchema = { 1: ["filterType", "string"], 2: ["name", "string"], 3: ["options", FilterInfo, true], 5: ["_hasMore", "int"] };

export const SearchResponseSchema: ProtoSchema = {
  1: ["countInfo", LimitOffsetCount],
  3: ["results", { 1: ["value", { 1: ["value", MangaInfo] }, true] }],
};
export const MangaDetailsResponseSchema: ProtoSchema = {
  1: ["info", MangaInfo],
  6: ["_status", "int"],
  7: ["tagline", "string"],
  8: ["description", "string"],
  9: ["metadata", { 1: ["name", "string"], 2: ["contents", { 1: ["name", "string"] }, true] }, true],
};
export const ChaptersResponseSchema: ProtoSchema = {
  1: ["chapterType", "int"],
  2: [
    "chapters",
    {
      1: ["id", "string"],
      2: ["readId", "string"],
      3: ["slug", "string"],
      4: ["thumbnail", Thumbnail],
      5: ["chapterNumber", { 1: ["prefix", "string"], 2: ["number", "string"] }],
      6: ["title", "string"],
      7: ["releaseInfo", { 1: ["releaseDate", { 1: ["value", "long"] }], 2: ["_isAvailable", "int"], 3: ["_isReleased", "int"] }],
      8: ["currentPrice", "int"],
      9: ["regularPrice", "int"],
      10: ["_isOwned", "int"],
    },
    true,
  ],
};
export const SearchHeaderResponseSchema: ProtoSchema = { 2: ["genres", SearchFilterOptions] };
export const SearchFilterOptionsResponseSchema: ProtoSchema = { 1: ["countInfo", LimitOffsetCount], 2: ["results", FilterInfo, true] };
export const ViewerResponseSchema: ProtoSchema = { 2: ["details", { 1: ["manifestUrl", "string"], 6: ["mimeType", "string"] }] };
