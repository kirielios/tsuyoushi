// Port of keiyoushi/extensions-source src/all/mangamillion/Dto.kt
// kotlinx.serialization.protobuf's @ProtoNumber(n) becomes the schemas below (see sdk/protobuf.ts).
import { SChapter, SManga, type ProtoSchema } from "../../../sdk/index.ts";

export interface SeriesResponse {
  allSeries: AllSeries;
}
export interface SearchResponse {
  allSeries: AllSeries;
}
export interface AllSeries {
  seriesList: SeriesList[];
}
export interface SeriesList {
  series: Series;
  languages: string[];
}
export interface Series {
  id: number;
  cover?: string;
  name: string;
  views?: number;
  uploadTime?: number;
}

export function seriesToSManga(s: Series): SManga {
  const manga = SManga.create();
  manga.url = String(s.id);
  manga.title = s.name;
  manga.thumbnail_url = s.cover;
  return manga;
}

export interface DetailsResponse {
  detailsEntry: DetailsEntry;
}
export interface DetailsEntry {
  details: Details;
}
export interface Details {
  cover?: string;
  name: string;
  authorName?: string;
  genres?: Tag[];
  summary?: string;
}

export function detailsToSManga(d: Details): SManga {
  const manga = SManga.create();
  manga.title = d.name;
  manga.description = d.summary;
  manga.genre = d.genres?.map((it) => it.name).join(", ");
  manga.author = d.authorName;
  manga.thumbnail_url = d.cover;
  return manga;
}

export interface Tag {
  id: number;
  name: string;
}

export interface SearchParameterResponse {
  searchParameter: SearchParameter;
}
export interface SearchParameter {
  genres: Tag[];
  themes: Tag[];
  highlights: Tag[];
  ratings: Tag[];
}

export interface ChapterResponse {
  chapterEntry: ChapterEntry;
}
export interface ChapterEntry {
  chapterGroups: ChapterGroup[];
}
export interface ChapterGroup {
  chapterList: ChapterList[];
}
export interface ChapterList {
  chapterNumber: string;
  chapterName: string;
  id?: number;
}

export const isAvailable = (c: ChapterList) => c.id != null;

/** Java's Float.parseFloat: surrounding whitespace is ignored, anything else that is not a number throws. */
function toFloat(s: string): number {
  const t = s.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(t)) throw new Error(`NumberFormatException: ${s}`);
  return Number.parseFloat(t);
}

function chapterNumbers(c: ChapterList): number {
  if (!c.chapterNumber.startsWith("#")) return -1;

  const numbers = c.chapterNumber.slice(1);

  if (numbers.includes(",")) return toFloat(numbers.split(",")[0]);
  if (numbers.includes("-")) {
    const i = numbers.indexOf("-");
    const parts = [numbers.slice(0, i), numbers.slice(i + 1)];

    return parts[1].length >= 3 ? toFloat(parts[0]) : toFloat(`${parts[0]}.${parts[1]}`);
  }
  return toFloat(numbers);
}

export function chapterToSChapter(c: ChapterList, titleId: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = String(c.id);
  chapter.chapter_number = chapterNumbers(c);
  chapter.name = c.chapterName;
  chapter.memo = { titleId };
  return chapter;
}

export interface ViewerResponse {
  viewer: Viewer;
}
export interface Viewer {
  pageList: PageList[];
  key: string;
  iv: string;
}
export interface PageList {
  imageUrl: string;
}

export interface TokenResponse {
  token: Token;
}
export interface Token {
  accessToken: string;
}

const tag: ProtoSchema = { 1: ["id", "int"], 2: ["name", "string"] };
const series: ProtoSchema = { 1: ["id", "int"], 2: ["cover", "string"], 3: ["name", "string"], 7: ["views", "long"], 9: ["uploadTime", "long"] };
const allSeries: ProtoSchema = { 1: ["seriesList", { 1: ["series", series], 2: ["languages", "string", true] }, true] };

export const seriesResponseSchema: ProtoSchema = { 22: ["allSeries", allSeries] };
export const searchResponseSchema: ProtoSchema = { 20: ["allSeries", allSeries] };
export const detailsResponseSchema: ProtoSchema = {
  50: ["detailsEntry", { 1: ["details", { 1: ["cover", "string"], 2: ["name", "string"], 3: ["authorName", "string"], 4: ["genres", tag, true], 7: ["summary", "string"] }] }],
};
export const searchParameterResponseSchema: ProtoSchema = {
  21: ["searchParameter", { 2: ["genres", tag, true], 3: ["themes", tag, true], 4: ["highlights", tag, true], 5: ["ratings", tag, true] }],
};
export const chapterResponseSchema: ProtoSchema = {
  60: ["chapterEntry", { 2: ["chapterGroups", { 2: ["chapterList", { 1: ["chapterNumber", "string"], 2: ["chapterName", "string"], 3: ["id", "int"] }, true] }, true] }],
};
export const viewerResponseSchema: ProtoSchema = { 70: ["viewer", { 1: ["pageList", { 1: ["imageUrl", "string"] }, true], 7: ["key", "string"], 8: ["iv", "string"] }] };
export const tokenResponseSchema: ProtoSchema = { 170: ["token", { 1: ["accessToken", "string"] }] };
