// Port of keiyoushi/extensions-source src/en/tapastic/TapasticDto.kt
import { DateTimeFormatter, Locale, SChapter, SManga } from "../../../sdk/index.ts";

export interface Field {
  bookCoverImage: Record<string, string>;
}
const fieldThumbnailUrl = (f: Field): string | undefined => {
  const first = Object.values(f.bookCoverImage)[0];
  return first != null ? `${first}.png` : undefined;
};

export interface MangaDto {
  seriesId: number;
  title: string;
  description: string;
  assetProperty: Field;
}

export function mangaToSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.thumbnail_url = fieldThumbnailUrl(dto.assetProperty);
  manga.description = dto.description;
  manga.url = `/series/${dto.seriesId}`;
  return manga;
}

export interface WrapperContent {
  items: MangaDto[];
}

export interface Pagination {
  last?: boolean;
  has_next?: boolean;
}

export interface Meta {
  pagination: Pagination;
}

export interface DataWrapper<T> {
  data: T;
  meta?: Meta | null;
}

export interface ChapterListDto {
  pagination: Pagination;
  episodes: ChapterDto[];
}
export const chapterListHasNextPage = (dto: ChapterListDto) => dto.pagination.has_next ?? false;

/** DataWrapper<WrapperContent>.items / hasNextPage() */
export const wrapperItems = (dto: DataWrapper<WrapperContent>): MangaDto[] => dto.data.items;
export const wrapperHasNextPage = (dto: DataWrapper<WrapperContent>): boolean => !(dto.meta?.pagination?.last ?? true);

export interface ChapterDto {
  id: number;
  title: string;
  publish_date: string;
  unlocked: boolean;
  free: boolean;
  scene: number;
  scheduled: boolean;
}

// SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.ROOT) in UTC: the text's own offset decides the instant
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssX", Locale.ROOT);

export function chapterToSChapter(dto: ChapterDto): SChapter {
  const chapter = SChapter.create();
  chapter.name = dto.unlocked || dto.free ? dto.title : `🔒 ${dto.title} `;
  chapter.date_upload = DATE_FORMAT.tryParseZonedDateTime(dto.publish_date);
  chapter.chapter_number = dto.scene;
  chapter.url = `/episode/${dto.id}`;
  return chapter;
}
