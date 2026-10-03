// Port of keiyoushi/extensions-source lib-multisrc/heancms/HeanCmsDto.kt
import { SChapter, SManga, tryParseInstant, type Document } from "../../sdk/index.ts";

export interface HeanCmsTokenPayloadDto {
  token?: string | null;
  expiresAt?: string | null;
}

export function tokenIsExpired(t: HeanCmsTokenPayloadDto): boolean {
  // Reduce one day to prevent timezone issues
  const parsed = t.expiresAt ? tryParseInstant(t.expiresAt) : 0;
  const expiredTime = parsed ? parsed - 1000 * 60 * 60 * 24 : 0;
  return Date.now() > expiredTime;
}

export interface HeanCmsErrorsDto {
  errors?: HeanCmsErrorMessageDto[] | null;
}

export interface HeanCmsErrorMessageDto {
  message: string;
}

export interface HeanCmsQuerySearchDto {
  data?: HeanCmsSeriesDto[];
  meta?: HeanCmsQuerySearchMetaDto | null;
}

export interface HeanCmsQuerySearchMetaDto {
  current_page: number;
  last_page: number;
}

export const hasNextPage = (meta: { current_page: number; last_page: number }) => meta.current_page < meta.last_page;

export interface HeanCmsSeriesDto {
  id: number;
  series_slug: string;
  author?: string | null;
  description?: string | null;
  studio?: string | null;
  status?: string | null;
  thumbnail: string;
  title: string;
  tags?: HeanCmsTagDto[] | null;
}

/** HeanCmsSeriesDto.toSManga(); `parseBodyFragment` is Jsoup.parseBodyFragment. */
export function seriesToSManga(s: HeanCmsSeriesDto, cdnUrl: string, coverPath: string, mangaSubDirectory: string, parseBodyFragment: (html: string) => Document): SManga {
  const manga = SManga.create();
  const descriptionBody = s.description != null ? parseBodyFragment(s.description) : null;

  manga.title = s.title;
  manga.author = s.author?.trim();
  manga.artist = s.studio?.trim();
  if (descriptionBody) {
    const ps = descriptionBody
      .select("p")
      .map((it) => it.text())
      .join("\n\n");
    manga.description = ps || descriptionBody.text().replaceAll("\n", "\n\n");
  }
  manga.genre = [...(s.tags ?? [])]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .concat({ name: "Manhwa" }) // auto webtoon mode, 99% of entries are webtoons
    .map((it) => it.name)
    .join(", ");
  manga.thumbnail_url = s.thumbnail ? toAbsoluteThumbnailUrl(s.thumbnail, cdnUrl, coverPath) : undefined;
  manga.status = s.status != null ? toStatus(s.status) : SManga.UNKNOWN;
  manga.url = `/${mangaSubDirectory}/${s.series_slug}#${s.id}`;
  return manga;
}

export interface HeanCmsTagDto {
  name: string;
}

export interface HeanCmsChapterPayloadDto {
  data: HeanCmsChapterDto[];
  meta: HeanCmsChapterMetaDto;
}

export interface HeanCmsChapterDto {
  id: number;
  chapter_name: string;
  chapter_title?: string | null;
  chapter_slug: string;
  created_at?: string | null;
  price?: number | null;
}

export function chapterToSChapter(c: HeanCmsChapterDto, seriesSlug: string, mangaSubDirectory: string): SChapter {
  const chapter = SChapter.create();
  chapter.name = c.chapter_name.trim();
  if (c.chapter_title != null) chapter.name += ` - ${c.chapter_title.trim()}`;
  if (c.price !== 0) chapter.name += " 🔒";
  chapter.date_upload = c.created_at != null ? tryParseInstant(c.created_at) : 0;
  chapter.url = `/${mangaSubDirectory}/${seriesSlug}/${c.chapter_slug}#${c.id}`;
  return chapter;
}

export interface HeanCmsChapterMetaDto {
  current_page: number;
  last_page: number;
}

export interface HeanCmsPagePayloadDto {
  chapter: HeanCmsPageDto;
  paywall?: boolean;
}

export interface HeanCmsPageDto {
  chapter_data?: HeanCmsPageDataDto | null;
}

export interface HeanCmsPageDataDto {
  images?: string[] | null;
}

export interface HeanCmsGenreDto {
  id: number;
  name: string;
}

function toAbsoluteThumbnailUrl(s: string, cdnUrl: string, coverPath: string): string {
  return s.startsWith("https://") || s.startsWith("http://") ? s : `${cdnUrl}/${coverPath}${s}`;
}

export function toStatus(s: string): number {
  switch (s) {
    case "Ongoing":
      return SManga.ONGOING;
    case "Hiatus":
      return SManga.ON_HIATUS;
    case "Dropped":
      return SManga.CANCELLED;
    case "Completed":
    case "Finished":
      return SManga.COMPLETED;
    default:
      return SManga.UNKNOWN;
  }
}
