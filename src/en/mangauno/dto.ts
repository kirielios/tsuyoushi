// Port of keiyoushi/extensions-source src/en/mangauno/Dto.kt
import { SChapter, SManga, parseAs, parseHtml, tryParseInstant, type Host } from "../../../sdk/index.ts";

export const IMG_API_URL = "https://xz7.fstr-cdn.com";

const ifEmptyNull = (s: string | null | undefined) => (s ? s : null);

export interface ListResponse {
  data: MangaDto[];
}
export const toSMangaList = (r: ListResponse, useEnglish: boolean): SManga[] => r.data.map((it) => mangaToSManga(it, useEnglish));

export interface MangaDto {
  slug: string;
  english_title: string | null;
  japanese_title: string | null;
  title: string;
  cover: string | null;
}

export function mangaToSManga(dto: MangaDto, useEnglish: boolean): SManga {
  const manga = SManga.create();
  manga.url = dto.slug;
  manga.title = (useEnglish ? ifEmptyNull(dto.english_title) : ifEmptyNull(dto.japanese_title)) ?? dto.title;
  manga.thumbnail_url = dto.cover != null ? `${IMG_API_URL}${dto.cover}` : undefined;
  return manga;
}

export interface DetailsResponse {
  manga: MangaDetailsDto;
  chapters: ChapterDto[];
}

export interface MangaDetailsDto {
  slug: string;
  english_title: string | null;
  japanese_title: string | null;
  title: string;
  cover: string | null;
  synopsis: string | null;
  author: string | null;
  artist: string | null;
  genres: string | null;
  tags: string | null;
  status: string | null;
}

export function detailsToSManga(dto: MangaDetailsDto, useEnglish: boolean): SManga {
  const manga = SManga.create();
  manga.url = dto.slug;
  manga.title = (useEnglish ? ifEmptyNull(dto.english_title) : ifEmptyNull(dto.japanese_title)) ?? dto.title;
  manga.thumbnail_url = dto.cover != null ? `${IMG_API_URL}${dto.cover}` : undefined;
  manga.description = dto.synopsis ?? undefined;
  manga.author = dto.author?.replaceAll(" & ", ", ");
  manga.artist = dto.artist?.replaceAll(" & ", ", ");

  const parsedGenres = dto.genres != null ? parseAs<string[]>(dto.genres) : [];
  const parsedTags = dto.tags != null ? parseAs<string[]>(dto.tags) : [];
  manga.genre = [...parsedGenres, ...parsedTags].filter((it) => it.length > 0).join(", ");

  switch (dto.status?.toLowerCase()) {
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
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export interface ChapterDto {
  id: number;
  chapter_number: string | null;
  volume: number | null;
  title: string | null;
  source: string | null;
  published_at: string | null;
}

/** Parser.unescapeEntities(s, true): textarea content is RCDATA, so only entities are decoded. */
const unescapeEntities = (host: Host, s: string) =>
  parseHtml(host.load, `<textarea>${s.replaceAll("</textarea", "&lt;/textarea")}</textarea>`, "").selectFirst("textarea")!.wholeText();

export function chapterToSChapter(dto: ChapterDto, mangaSlug: string, host: Host): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${mangaSlug}/${dto.id}`;

  const num = dto.chapter_number != null && dto.chapter_number.trim() !== "" ? Number(dto.chapter_number) : Number.NaN;
  const chStr = Number.isNaN(num) ? null : `Ch. ${String(num).replace(/\.0$/, "")}`;
  const volStr = dto.volume != null ? `Vol. ${dto.volume}` : null;
  const unescapedTitle = dto.title != null ? unescapeEntities(host, dto.title) : null;

  const parts = [chStr, volStr, unescapedTitle].filter((it): it is string => it != null && it.length > 0);
  chapter.name = parts.join(" — ");
  if (chapter.name.length === 0) chapter.name = "Chapter";

  chapter.scanlator = dto.source ?? undefined;
  chapter.date_upload = tryParseInstant(dto.published_at);
  return chapter;
}

export interface PageListResponse {
  pages: string[];
}

export interface FacetsDto {
  genres?: FacetDto[];
  tags?: FacetDto[];
}
export interface FacetDto {
  name: string;
}
