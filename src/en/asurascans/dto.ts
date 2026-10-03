// Port of keiyoushi/extensions-source src/en/asurascans/Dto.kt
import { SChapter, SManga, toHttpUrl, tryParseInstant, type Document } from "../../../sdk/index.ts";

export interface DataDto<T> {
  data?: T | null;
  meta?: MetaDto | null;
}

export interface MetaDto {
  has_more?: boolean;
}

export interface MangaDto {
  public_url: string;
  slug: string;
  title: string;
  cover?: string;
  coverUrl?: string; // @JsonNames("coverUrl")
}

export function mangaToSManga(m: MangaDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = m.title;
  manga.thumbnail_url = m.cover ?? m.coverUrl;
  manga.url = `/series/${m.slug}`; // Keep the old URL structure for compatibility with existing bookmarks
  manga.memo = { slug: toHttpUrl(`${baseUrl}${m.public_url}`).pathSegments.at(-1)! };
  return manga;
}

export interface MangaDetailsDto {
  title: string;
  coverUrl: string;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  rating?: number | null;
  bookmarkCount?: number | null;
  type?: string | null;
  popularityRank?: number | null;
  alternativeTitles?: string | null;
  genres?: GenreDto[] | null;
  status?: string | null;
}

export function toSMangaDetails(d: MangaDetailsDto, parseBodyFragment: (html: string) => Document): SManga {
  const manga = SManga.create();
  manga.title = d.title;
  manga.thumbnail_url = d.coverUrl;
  manga.author = d.author ?? undefined;
  manga.artist = d.artist ?? undefined;
  manga.description = parseDescription(d, parseBodyFragment);
  const genre: string[] = [];
  if (d.type != null) genre.push(d.type.charAt(0).toUpperCase() + d.type.slice(1));
  if (d.genres != null) genre.push(...d.genres.map((it) => it.name));
  manga.genre = genre.join(", ");
  manga.status = parseStatus(d);
  manga.initialized = true;
  return manga;
}

function parseDescription(d: MangaDetailsDto, parseBodyFragment: (html: string) => Document): string {
  let out = "";
  const metadata: string[] = [];
  if (d.popularityRank != null) metadata.push(`Rank: #${d.popularityRank}`);
  if (d.rating != null) metadata.push(`Rating: ${d.rating.toFixed(2)}`);
  if (d.bookmarkCount != null) {
    const it = d.bookmarkCount;
    const formatted = it >= 1_000_000 ? `${(it / 1_000_000).toFixed(1)}M` : it >= 1_000 ? `${(it / 1_000).toFixed(1)}K` : String(it);
    metadata.push(`Bookmarks: ${formatted}`);
  }

  if (metadata.length) out += metadata.join(" • ");

  const desc = d.description != null ? parseBodyFragment(d.description).text() : "";
  if (desc) {
    if (out) out += "\n\n";
    out += desc;
  }

  const cleanAltTitles =
    d.alternativeTitles != null
      ? (d.alternativeTitles.includes("•") ? d.alternativeTitles.split("•") : d.alternativeTitles.split(",")).map((it) => it.trim()).filter((it) => it)
      : null;

  if (cleanAltTitles?.length) {
    if (out) out += "\n\n";
    out += "Alternative Titles:\n";
    out += cleanAltTitles.map((it) => `- ${it}`).join("\n");
  }
  return out;
}

function parseStatus(d: MangaDetailsDto) {
  switch (d.status?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    case "dropped":
    case "axed":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

export interface MangaUrlDto {
  publicUrl: string;
  seriesSlug: string;
}

export function applyMangaUrl(u: MangaUrlDto, manga: SManga, baseUrl: string): SManga {
  manga.url = `/series/${u.seriesSlug}`; // Keep the old URL structure for compatibility with existing bookmarks
  manga.memo = { slug: toHttpUrl(`${baseUrl}${u.publicUrl}`).pathSegments.at(-1)! };
  return manga;
}

export interface AvailableGenres {
  availableGenres: GenreDto[];
}

export interface GenreDto {
  name: string;
  slug: string;
}

export interface Creators {
  artists: string[];
  authors: string[];
}

export interface FiltersDto {
  genres: GenreDto[];
  artists: string[];
  authors: string[];
}

export interface ChapterListDto {
  chapters?: ChapterDto[] | null;
}

export interface ChapterDto {
  number: number;
  title?: string | null;
  created_at?: string;
  is_premium?: boolean;
  is_locked?: boolean; // @JsonNames("is_locked")
  early_access_until?: string | null;
  series_slug?: string | null;
}

export function isLocked(c: ChapterDto): boolean {
  if (c.is_premium ?? c.is_locked ?? false) return true;
  const until = c.early_access_until;
  if (until == null) return false;
  const t = tryParseInstant(until);
  return t !== 0 && t > Date.now();
}

/** Kotlin's Float.toString().removeSuffix(".0") */
const numberString = (n: number) => String(Math.fround(n) === n ? n : Number(Math.fround(n).toPrecision(7)));

export function toSChapter(c: ChapterDto, randomMangaSlug: string): SChapter {
  const chapter = SChapter.create();
  const numberStr = numberString(c.number);
  chapter.url = `/series/${c.series_slug}/chapter/${numberStr}`;
  chapter.memo = { mangaSlug: randomMangaSlug };
  let name = "";
  if (isLocked(c)) name += "🔒 ";
  name += `Chapter ${numberStr}`;
  if (c.title != null) name += ` - ${c.title}`;
  chapter.name = name;
  chapter.date_upload = tryParseInstant(c.created_at);
  return chapter;
}

export interface PremiumPageListDto {
  data: { chapter: PageListDto };
}

export interface PageListDto {
  pages?: PageDto[];
}

export interface PageDto {
  url: string;
  tiles?: number[] | null;
  tile_cols?: number | null;
  tile_rows?: number | null;
}

export interface PageData {
  tiles: number[];
  tileCols: number;
  tileRows: number;
}
