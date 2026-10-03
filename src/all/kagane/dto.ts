// Port of keiyoushi/extensions-source src/all/kagane/Dto.kt
import { DateTimeFormatter, Locale, SChapter, SManga, parseHtml, type Host } from "../../../sdk/index.ts";

export interface GenreDto {
  id: string;
  genre_name: string;
}

export interface TagDto {
  id: string;
  tag_name: string;
}

export interface SourcesDto {
  sources: SourceDto[];
}

export interface SourceDto {
  source_id: string;
  source_type: string; // "Official", "Unofficial", "Mixed"
  title: string;
}

export interface SearchDto {
  content?: SearchBook[];
  last?: boolean;
  total_elements?: number;
  total_pages?: number;
}
export const searchHasNextPage = (dto: SearchDto) => !(dto.last ?? true);

/** SearchDto.Book and TrackerDto.Book share toSManga; only the id field differs. */
interface BookLike {
  title: string;
  source_id?: string | null;
  cover_image_id?: string | null;
}
export interface SearchBook extends BookLike {
  series_id: string;
  current_books: number;
  start_year?: number | null;
  alternate_titles?: string[];
}

export interface TrackerDto {
  book_series?: TrackerBook[];
}
export interface TrackerBook extends BookLike {
  id: string;
  current_books: number;
}

export function bookToSManga(book: BookLike, id: string, apiUrl: string, showSource: boolean, sources: Record<string, string>, cleanTitle: boolean): SManga {
  const manga = SManga.create();
  manga.title = showSource && Object.keys(sources).length ? `${book.title.trim()} [${sources[book.source_id!]}]` : clean(book.title, cleanTitle);
  manga.url = id;
  manga.thumbnail_url = book.cover_image_id != null ? `${apiUrl}/image/${book.cover_image_id}` : undefined;
  return manga;
}

export interface DetailsDto {
  title: string;
  description: string | null;
  upload_status: string;
  format: string | null;
  source_id: string | null;
  series_staff?: { name: string; role: string }[];
  genres?: { genre_name: string }[];
  tags?: { tag_name: string }[];
  series_alternate_titles?: { title: string; label: string | null }[];
  series_books?: ChapterBook[];
  edition_info?: string | null;
  tracker_id?: string | null;
  series_covers?: { image_id: string }[];
}

const icontains = (s: string, sub: string) => s.toLowerCase().includes(sub.toLowerCase());
const isNullOrBlank = (s: string | null | undefined): s is null | undefined => !s || !s.trim();

export function detailsToSManga(host: Host, dto: DetailsDto, apiUrl: string, sourceName: string | null = null, baseUrl = "", showEdition = false, showSource = false, cleanTitle: boolean): SManga {
  const manga = SManga.create();
  const base = dto.title.trim();
  const withEdition = showEdition && !isNullOrBlank(dto.edition_info) ? `${base} (${dto.edition_info})` : base;
  manga.title = showSource && sourceName != null ? `${withEdition} [${sourceName}]` : clean(withEdition, cleanTitle);
  const cover = dto.series_covers?.[0]?.image_id;
  manga.thumbnail_url = cover != null ? `${apiUrl}/image/${cover}` : undefined;
  let desc = "";

  // Add main description
  if (dto.description && dto.description.trim()) {
    // Jsoup.parse(it.trim().replace("\n", "<br>")).wholeText(): the newlines are kept as they are instead of going
    // through <br>, cheerio's text() drops <br>
    desc += parseHtml(host.load, dto.description.trim(), baseUrl).wholeText();
    desc += "\n";
  }

  // Add source name
  if (sourceName != null && dto.source_id != null) {
    if (desc) desc += "\n";
    desc += `Source: [${sourceName}](${baseUrl}/sources/${dto.source_id})\n`;
  }

  // Add alternate titles at the end
  const alts = dto.series_alternate_titles ?? [];
  if (alts.length) {
    if (desc) desc += "\n";
    desc += "Associated Name(s):\n";
    for (const it of alts) desc += `• ${it.title}\n`;
  }

  // Extract authors and artists from staff (roles like "Author", "Artist", "Story", "Art")
  const staff = dto.series_staff ?? [];
  const authors = [...new Set(staff.filter((it) => icontains(it.role, "Author") || icontains(it.role, "Story")).map((it) => it.name))];
  const artists = [...new Set(staff.filter((it) => icontains(it.role, "Artist") || icontains(it.role, "Art")).map((it) => it.name))].join(", ");

  manga.artist = artists;
  manga.author = authors.join(", ");
  manga.description = desc.trim();
  const genre: string[] = [];
  if (dto.format && dto.format.trim()) genre.push(dto.format);
  genre.push(...(dto.genres ?? []).map((it) => it.genre_name));
  manga.genre = genre.join(", ");
  manga.status = toStatus(dto.upload_status);
  return manga;
}

function toStatus(s: string): number {
  switch (s.toUpperCase()) {
    case "ONGOING":
      return SManga.ONGOING;
    case "COMPLETED":
      return SManga.COMPLETED;
    case "HIATUS":
      return SManga.ON_HIATUS;
    case "ABANDONED":
      return SManga.CANCELLED;
    default:
      return SManga.UNKNOWN;
  }
}

export interface ChapterBook {
  book_id: string;
  series_id?: string | null;
  title: string;
  created_at: string | null;
  page_count: number;
  sort_no: number;
  chapter_no: string | null;
  volume_no: string | null;
  groups?: { title: string }[];
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ENGLISH);

export function bookToSChapter(book: ChapterBook, actualSeriesId: string, useSourceChapterNumber = false, chapterTitleMode = "optional"): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/series/${actualSeriesId}/reader/${book.book_id}`;
  chapter.name = buildChapterName(book, chapterTitleMode);
  // SimpleDateFormat.parse reads a prefix and ignores the rest (fractions, zone)
  chapter.date_upload = dateFormat.tryParseDateTime(book.created_at?.slice(0, 19));
  if (useSourceChapterNumber) chapter.chapter_number = book.sort_no;
  let scanlator = (book.groups ?? []).map((it) => it.title).join(", ");
  // Extract group tags in chapter title
  const match = CHAPTER_GROUP_REGEX.exec(book.title.trim().replace(METADATA_REGEX, ""));
  if (match) {
    const groupTag = match[1] ?? match[2];
    if (groupTag != null) scanlator += ` (${groupTag})`;
  }
  chapter.scanlator = scanlator;
  return chapter;
}

function buildChapterName(book: ChapterBook, mode = "optional"): string {
  const trimmedTitle = book.title.trim();
  const { chapter_no: chapterNo, volume_no: volumeNo } = book;
  switch (mode) {
    case "optional":
      if (!trimmedTitle && isNullOrBlank(chapterNo) && !isNullOrBlank(volumeNo)) return buildChapterName(book, "vol_chapter");
      if (!trimmedTitle && !isNullOrBlank(chapterNo)) return `Ch.${chapterNo}`;
      return trimmedTitle;
    case "always":
      if (isNullOrBlank(chapterNo) && !isNullOrBlank(volumeNo)) return buildChapterName(book, "vol_chapter");
      if (!trimmedTitle) return `Ch.${chapterNo}`;
      return `Ch.${chapterNo} ${trimmedTitle}`;
    case "vol_chapter":
    case "vol_local": {
      const volPart = !isNullOrBlank(volumeNo) ? `Vol.${volumeNo} ` : "";
      const chPart = !isNullOrBlank(chapterNo) ? `Ch.${chapterNo}` : "";
      const numPart = `${volPart}${chPart}`.trim();
      if (!numPart) return trimmedTitle;
      if (!trimmedTitle || mode === "vol_local") return numPart;
      return `${numPart} ${trimmedTitle}`;
    }
    default:
      return trimmedTitle;
  }
}

export interface ChallengeDto {
  access_token: string;
  cache_url: string;
  manifest?: { pages?: PageDto[] } | null;
}

export interface PageDto {
  page_no: number;
  page_id: string;
  ext?: string | null;
}

export interface IntegrityDto {
  token: string;
  exp: number;
}

const BRACKET_REGEX = /(\([^()]*\)|\[[^[\]]*\])\s*$/;

const METADATA_REGEX = /(?:\s*\{[^{}]*\})+\s*$/;

const CHAPTER_GROUP_REGEX = /^Chapter\s+.*(?:-\s*Volume\s+.*\(([^()]+)\)|\[([^[\]]+)\])\s*$/i;

const clean = (s: string, removeExtras: boolean) => (removeExtras ? s.replace(BRACKET_REGEX, "").trim() : s.trim());
