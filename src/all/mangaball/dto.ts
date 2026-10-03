// Port of keiyoushi/extensions-source src/all/mangaball/Dto.kt
import { DateTimeFormatter, MangasPage, SChapter, SManga, ZoneOffset } from "../../../sdk/index.ts";

export interface SearchResponse {
  data: MangaDto[];
  pagination: { page: number; total_pages: number };
}
export const searchToMangasPage = (r: SearchResponse) => new MangasPage(r.data.map(mangaDtoToSManga), r.pagination.page < r.pagination.total_pages);

export interface MangaDto {
  id: string;
  slug: string;
  name: string;
  image?: ImageDto | null;
}
export function mangaDtoToSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.url = dto.slug;
  manga.title = dto.name;
  manga.thumbnail_url = imageUrl(dto.image);
  manga.memo = { id: dto.id };
  return manga;
}

export interface TitleResponse {
  data: TitleDto;
}
export interface TitleDto {
  id: string;
  slug: string;
  name: string;
  image?: ImageDto | null;
  description?: string[];
  alternateName?: string[];
  tags?: TagDto[];
  author?: AuthorDto[];
  status?: string | null;
}
export function titleDtoToSManga(dto: TitleDto): SManga {
  const altNames = (dto.alternateName ?? []).map((it) => `- ${it}`).join("\n");
  let description = (dto.description ?? []).join("\n\n");
  if (altNames.trim()) description += "\n\nAlternative Names: \n" + altNames;
  description = description.trim();

  const manga = SManga.create();
  manga.url = dto.slug;
  manga.title = dto.name;
  manga.thumbnail_url = imageUrl(dto.image);
  manga.genre = (dto.tags ?? []).map((it) => it.name).join(", ");
  manga.author = (dto.author ?? []).map((it) => it.name).join(", ");
  manga.description = description;
  manga.memo = { id: dto.id };
  switch (dto.status) {
    case "ongoing": manga.status = SManga.ONGOING; break;
    case "completed": manga.status = SManga.COMPLETED; break;
    case "hiatus": manga.status = SManga.ON_HIATUS; break;
    case "cancelled": manga.status = SManga.CANCELLED; break;
    default: manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export interface ImageDto {
  file?: string | null;
  cdn_mangadex?: string | null;
  cdn_mangaupdate?: string | null;
  cdn_mangaupdates?: string | null;
  cover?: CoverDto | null;
}
export interface CoverDto {
  path?: string | null;
}

const COVER_BASE_URL = "https://bulbasaur.poke-black-and-white.net/covers/";

// `path` is a Windows-style relative path such as "<titleId>\\cover_123.jpg".
function coverUrl(c: CoverDto | null | undefined): string | undefined {
  const p = c?.path?.trim().replaceAll("\\", "/");
  if (!p) return undefined;
  return p.startsWith("http") ? p : COVER_BASE_URL + p;
}

// Mirrors the site's getTitleImage priority: the self-hosted cover first, external mirrors only as fallbacks.
export function imageUrl(dto: ImageDto | null | undefined): string | undefined {
  if (dto == null) return undefined;
  return coverUrl(dto.cover) ?? [dto.file, dto.cdn_mangadex, dto.cdn_mangaupdate, dto.cdn_mangaupdates].find((it) => it != null && it.trim() !== "") ?? undefined;
}

export interface TagDto {
  name: string;
}
export interface AuthorDto {
  name: string;
}
export interface ChapterListResponse {
  data: ChapterDto[];
}
export interface ChapterDto {
  id: string;
  name?: string | null;
  number: number;
  volume?: number;
  lang: string;
  group?: GroupDto | null;
  created_at?: string | null;
}

// Kotlin's Float.toString().removeSuffix(".0"): JS already prints whole numbers without ".0"
const floatStr = (n: number) => String(n);

// ISO_LOCAL_DATE_TIME: the fraction of a second is optional, which ofPattern cannot express, so try both shapes
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS");
const dateFormatNoFraction = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

export function chapterDtoToSChapter(dto: ChapterDto, langs: string[]): SChapter | null {
  if (!langs.includes(dto.lang)) return null;

  const chapterName = (dto.name ?? "").trim();
  const volume = dto.volume ?? 0;

  const chapter = SChapter.create();
  chapter.url = dto.id;
  let name = "";
  if (volume > 0) name += `Vol. ${floatStr(volume)} `;
  const numberStr = floatStr(dto.number);
  if (chapterName.includes(numberStr)) {
    name += chapterName;
  } else {
    name += `Ch. ${numberStr}`;
    if (chapterName) name += ` ${chapterName}`;
  }
  chapter.name = name;
  chapter.chapter_number = dto.number;
  chapter.date_upload = dateFormat.tryParseDateTime(dto.created_at, ZoneOffset.UTC) || dateFormatNoFraction.tryParseDateTime(dto.created_at, ZoneOffset.UTC);
  chapter.scanlator = dto.group?.name;
  return chapter;
}

export interface GroupDto {
  name: string;
}
export interface ChapterDetailResponse {
  data: { chapter: ChapterDetailDto };
}
export interface ChapterDetailDto {
  title_id?: string | null;
  pages?: string[];
}
