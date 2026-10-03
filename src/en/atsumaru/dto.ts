// Port of keiyoushi/extensions-source src/en/atsumaru/Dto.kt
import { SChapter, SManga, tryParseInstant } from "../../../sdk/index.ts";
import { GenreFilter, StatusFilter, TagFilters, TypeFilter } from "./filters.ts";

export interface BrowseMangaDto {
  items: MangaDto[];
}
export interface MangaObjectDto {
  mangaPage: MangaDto;
}
export interface SearchResultsDto {
  page: number;
  found: number;
  hits: { document: MangaDto }[];
  request_params: { per_page: number };
}
export const hasNextPage = (d: SearchResultsDto): boolean => d.page * d.request_params.per_page < d.found;

type Json = unknown;
type JsonObject = Record<string, Json>;
const isObject = (e: Json): e is JsonObject => typeof e === "object" && e !== null && !Array.isArray(e);
/** JsonPrimitive.content */
const content = (e: Json): string | undefined => (e === null || e === undefined || isObject(e) || Array.isArray(e) ? undefined : String(e));

export interface MangaDto {
  // Common
  id: string;
  title: string;
  /** @JsonNames("poster", "image") */
  poster?: Json;
  image?: Json;
  largeImage?: string | null;

  // Details
  authors?: Json;
  synopsis?: string | null;
  /** @JsonNames("genres", "tags") */
  genres?: Json;
  tags?: Json;
  released?: number | null;
  status?: string | null;
  type?: string | null;
  views?: Json;
  otherNames?: string[] | null;
  avgRating?: number | null;
  scanlators?: ScanlatorDto[] | null;

  // Chapters
  chapters?: ChapterDto[] | null;

  recommendations?: MangaDto[] | null;
}

export interface ScanlatorDto {
  id: string;
  name: string;
}

const PROTOCOL_REGEX = /^https?:?\/\//;

function getImagePath(m: MangaDto): string | undefined {
  const imagePath = m.poster ?? m.image;
  let url = m.largeImage ?? undefined;
  if (url === undefined) {
    if (isObject(imagePath)) url = content(imagePath.largeImage ?? imagePath.image);
    else url = content(imagePath);
  }
  return url?.replace(/^\//, "").replace(/^static\//, "");
}

function parseNames(element: Json): string[] {
  if (!Array.isArray(element)) return [];
  return element.flatMap((item) => {
    if (isObject(item)) {
      const n = content(item.name);
      return n === undefined ? [] : [n];
    }
    const c = content(item);
    return c === undefined ? [] : [c];
  });
}

function parseAuthorsWithType(element: Json): [string, string | null][] {
  if (!Array.isArray(element)) return [];
  return element.flatMap((item): [string, string | null][] => {
    if (isObject(item)) {
      const name = content(item.name);
      if (name === undefined) return [];
      return [[name, content(item.type) ?? null]];
    }
    const c = content(item);
    return c === undefined ? [] : [[c, null]];
  });
}

export function toSManga(m: MangaDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = m.id;
  manga.title = m.title;
  const img = getImagePath(m);
  if (img !== undefined) {
    const url = /^http/.test(img) ? img : img.startsWith("//") ? `https:${img}` : `${baseUrl}/static/${img}`;
    manga.thumbnail_url = url.replace(PROTOCOL_REGEX, "https://");
  }

  const desc: string[] = [];
  if (m.avgRating != null && m.avgRating > 0) desc.push(`**Rating**: ${m.avgRating.toFixed(2)}/10`);
  if (m.released != null && m.released > 0) desc.push(`**Year**: ${new Date(m.released).getFullYear()}`);
  // can be Int or formatted String
  const views = content(m.views);
  if (views !== undefined) desc.push(`**Views**: ${views}`);
  if (m.synopsis && m.synopsis.trim()) {
    desc.push("\n");
    desc.push(`**Synopsis**: ${m.synopsis}`);
  }
  const names = m.otherNames?.filter((it) => it !== m.title) ?? [];
  if (names.length) {
    desc.push("\n");
    desc.push(`**Alternative Names**:\n${names.map((it) => `- ${it}`).join("\n")}`);
  }
  manga.description = desc.join("\n");

  manga.genre = [...(m.type != null ? [m.type] : []), ...parseNames(m.genres ?? m.tags)].join(", ");

  const authorsList = parseAuthorsWithType(m.authors);
  manga.author = authorsList.filter((it) => it[1] === "Author" || it[1] === null).map((it) => it[0]).join(", ");
  manga.artist = authorsList.filter((it) => it[1] === "Artist").map((it) => it[0]).join(", ");

  switch (m.status?.toLowerCase().trim()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "canceled":
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export const recommendations = (m: MangaDto, baseUrl: string): SManga[] => m.recommendations?.map((it) => toSManga(it, baseUrl)) ?? [];

export interface AllChaptersDto {
  chapters: ChapterDto[];
}

export interface ChapterDto {
  id: string;
  number: number;
  title: string;
  scanlationMangaId?: string | null;
  /** @SerialName("createdAt") */
  createdAt?: Json;
}

export function toSChapter(c: ChapterDto, slug: string, scanlatorName?: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${slug}/${c.id}`;
  chapter.chapter_number = c.number;
  chapter.name = c.title;
  chapter.scanlator = scanlatorName;
  const date = c.createdAt;
  if (date !== undefined && date !== null && !isObject(date) && !Array.isArray(date)) {
    // it.longOrNull ?: Instant.tryParse(it.content)
    const s = String(date);
    chapter.date_upload = /^[+-]?\d+$/.test(s) ? Number(s) : tryParseInstant(s);
  }
  return chapter;
}

export interface PageObjectDto {
  readChapter: { pages: { image: string }[] };
}

export interface Filter {
  id: string;
  name: string;
}
export interface FilterData {
  genres?: Filter[] | null;
  tags?: Filter[] | null;
  types?: Filter[] | null;
  statuses?: Filter[] | null;
}

export function getFilterList(d: FilterData, excludedGenreIds: string[] = []) {
  const list = [];
  if (d.genres) list.push(new GenreFilter(d.genres.map((it) => ({ name: it.name, id: it.id })), excludedGenreIds));
  if (d.tags) list.push(new TagFilters(d.tags.map((it) => ({ name: it.name, id: it.id }))));
  if (d.types) list.push(new TypeFilter(d.types.map((it) => ({ name: it.name, id: it.id }))));
  if (d.statuses) list.push(new StatusFilter(d.statuses.map((it) => ({ name: it.name, id: it.id }))));
  return list;
}
