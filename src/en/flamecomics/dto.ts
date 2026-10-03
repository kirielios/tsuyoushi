// Port of keiyoushi/extensions-source src/en/flamecomics/Dto.kt
import { Page, SChapter, SManga, toHttpUrl, type HttpUrlBuilder } from "../../../sdk/index.ts";

export const THUMBNAIL_FRAGMENT = "thumbnail";

export interface BuildIdDto {
  buildId: string;
}

export interface NextDataDto<T> {
  pageProps: T;
}

export interface BrowseDto {
  series: SeriesDto[];
}

export interface LatestDto {
  latestEntries: { blocks: { series: SeriesDto[] }[] };
}
export const latestSeries = (dto: LatestDto): SeriesDto[] => dto.latestEntries.blocks[0].series;

export interface SeriesPageDto {
  series: SeriesDto;
  chapters: ChapterDto[];
}

export interface ChapterPageDto {
  chapter: ChapterImagesDto;
}

export interface SeriesDto {
  title: string;
  altTitles: string[] | null;
  description: string | null;
  cover: string;
  type: string;
  tags: string[] | null;
  author: string[] | null;
  artist: string[] | null;
  status: string;
  series_id: number | null;
  last_edit: number;
  views: number | null;
}

/** OkHttp's addQueryParameter(name, null) writes a bare "?name"; a URLSearchParams-backed builder would write "?name=". */
const withBareQuery = (builder: HttpUrlBuilder, name: string | number, fragment?: string) => `${builder.build().toString()}?${name}${fragment ? `#${fragment}` : ""}`;

const imagesUrl = (seriesId: number): HttpUrlBuilder => toHttpUrl("https://cdn.flamecomics.xyz/uploads/images/series").newBuilder().addPathSegment(String(seriesId));

export function seriesToSManga(s: SeriesDto): SManga | null {
  return s.series_id != null ? toSMangaById(s, s.series_id) : null;
}

function toSMangaById(s: SeriesDto, id: number): SManga {
  const manga = SManga.create();
  manga.url = `/series/${id}`;
  manga.title = s.title;
  manga.thumbnail_url = withBareQuery(imagesUrl(id).addPathSegment(s.cover), s.last_edit, THUMBNAIL_FRAGMENT);
  return manga;
}

/** `wholeText` stands for Jsoup.parseBodyFragment(html).wholeText(). */
export function seriesToSMangaDetails(s: SeriesDto, wholeText: (html: string) => string): SManga {
  const manga = toSMangaById(s, s.series_id!);
  const synopsis = s.description != null ? wholeText(s.description) : "";
  const altNames = (s.altTitles ?? []).map((it) => it.trim()).filter((it) => it.length > 0);

  let description = synopsis;
  if (altNames.length > 0) {
    if (description.length > 0) description += "\n\n";
    description += "Alternative Names:";
    for (const name of altNames) description += `\n- ${name}`;
  }
  manga.description = description.length > 0 ? description : undefined;

  manga.genre = [s.type, ...(s.tags ?? [])].join(", ");
  manga.author = s.author?.join(", ");
  manga.artist = s.artist?.join(", ");
  switch (s.status.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "dropped":
      manga.status = SManga.CANCELLED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

export interface ChapterDto {
  chapter: number;
  title: string | null;
  release_date: number;
  series_id: number;
  token: string;
}

export function chapterToSChapter(c: ChapterDto): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/series/${c.series_id}/${c.token}`;
  chapter.chapter_number = c.chapter;
  chapter.date_upload = c.release_date * 1000;
  let name = `Chapter ${String(c.chapter).replace(/\.0$/, "")}`;
  if (c.title != null && c.title.trim().length > 0) name += ` - ${c.title}`;
  chapter.name = name;
  return chapter;
}

export interface ChapterImagesDto {
  release_date: number;
  series_id: number;
  token: string;
  images: Record<string, { name: string }>;
}

export function chapterImagesToPages(c: ChapterImagesDto): Page[] {
  return Object.values(c.images).map((image, index) => new Page(index, "", withBareQuery(imagesUrl(c.series_id).addPathSegment(c.token).addPathSegment(image.name), c.release_date)));
}
