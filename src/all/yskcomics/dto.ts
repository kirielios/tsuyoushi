// Port of keiyoushi/extensions-source src/all/yskcomics/YSKComicsDto.kt
import { SChapter, SManga, parseHtml, type Host } from "../../../sdk/index.ts";

export interface ResponseDto<T> {
  data: T;
}
export interface Metadata {
  link_next: string | null;
}
export interface ResponseInnerDto<T> {
  data_messages: T[];
  meta: Metadata;
}
export interface NamedEntity {
  name: string;
}

export type PopularDto = ResponseDto<MangaPopularRaw[]>;
export type LatestDto = ResponseDto<ResponseInnerDto<MangaLatestRaw>>;
export type SearchDto = ResponseDto<MangaSearchRaw[]>;
export type DetailsDto = ResponseDto<DetailsRaw>;
export type ChapterDto = ResponseDto<ResponseInnerDto<ChapterRaw>>;
export type PageDto = ResponseDto<string[]>;

function getRatingString(rate: string, rateCount: number): string {
  const n = Number(rate);
  const ratingValue = rate.trim() === "" || Number.isNaN(n) ? 0 : n; // toDoubleOrNull() ?: 0.0
  let ratingStar: string;
  if (ratingValue >= 4.75) ratingStar = "★★★★★";
  else if (ratingValue >= 4.25) ratingStar = "★★★★✬";
  else if (ratingValue >= 3.75) ratingStar = "★★★★☆";
  else if (ratingValue >= 3.25) ratingStar = "★★★✬☆";
  else if (ratingValue >= 2.75) ratingStar = "★★★☆☆";
  else if (ratingValue >= 2.25) ratingStar = "★★✬☆☆";
  else if (ratingValue >= 1.75) ratingStar = "★★☆☆☆";
  else if (ratingValue >= 1.25) ratingStar = "★✬☆☆☆";
  else if (ratingValue >= 0.75) ratingStar = "★☆☆☆☆";
  else if (ratingValue >= 0.25) ratingStar = "✬☆☆☆☆";
  else ratingStar = "☆☆☆☆☆";
  if (ratingValue > 0.0) {
    let s = `${ratingStar} ${rate}`;
    if (rateCount > 0) s += ` (${rateCount})`;
    return s;
  }
  return "";
}

/** Jsoup.parseBodyFragment(html).wholeText().trim() */
const plainText = (host: Host, html: string) => parseHtml(host.load, html, "").wholeText().trim();

const names = (list: NamedEntity[]) => list.map((it) => it.name).join(", ");

// ---

export interface MangaPopularRaw {
  image: string;
  full_name: string;
  slug: string;
  rate: string;
  writer: NamedEntity;
  publisher: NamedEntity;
  genres: NamedEntity[];
  description?: string;
  descrition?: string; // @JsonNames("descrition")
}

export function popularToSManga(raw: MangaPopularRaw, lang: string, host: Host): SManga {
  const manga = SManga.create();
  manga.url = `/${lang}/comic/${raw.slug}`;
  manga.title = raw.full_name;
  manga.author = raw.writer.name;
  let description = "";
  const ratingStr = getRatingString(raw.rate, 0);
  if (ratingStr.length > 0) description += `${ratingStr}\n`;
  description += `Publisher: ${raw.publisher.name}\n`;
  description += "\n";
  description += plainText(host, (raw.description ?? raw.descrition)!);
  manga.description = description;
  manga.genre = names(raw.genres);
  manga.status = SManga.UNKNOWN;
  manga.thumbnail_url = raw.image;
  return manga;
}

export interface MangaLatestRaw {
  image: string;
  full_name: string;
  slug: string;
  rate: string;
  rate_count: number;
  writer: string;
  genres: NamedEntity[];
}

export function latestToSManga(raw: MangaLatestRaw, lang: string): SManga {
  const manga = SManga.create();
  manga.url = `/${lang}/comic/${raw.slug}`;
  manga.title = raw.full_name;
  manga.author = raw.writer;
  let description = "";
  const ratingStr = getRatingString(raw.rate, raw.rate_count);
  if (ratingStr.length > 0) description += `${ratingStr}\n`;
  // upstream's trimEnd() on the StringBuilder returns a copy and leaves the description untouched
  manga.description = description;
  manga.genre = names(raw.genres);
  manga.status = SManga.UNKNOWN;
  manga.thumbnail_url = raw.image;
  return manga;
}

export interface MangaSearchRaw {
  full_name: string;
  slug: string;
  image: string;
}

export function searchToSManga(raw: MangaSearchRaw, lang: string): SManga {
  const manga = SManga.create();
  manga.url = `/${lang}/comic/${raw.slug}`;
  manga.title = raw.full_name;
  manga.status = SManga.UNKNOWN;
  manga.thumbnail_url = raw.image;
  return manga;
}

// ---

export interface DetailsRaw {
  full_name: string;
  slug: string;
  image: string;
  rate: string;
  rate_count: number;
  language_code: string;
  writer: NamedEntity;
  publisher: NamedEntity;
  genres: NamedEntity[];
  artists: NamedEntity[];
  status: string;
  description: string;
  published_at: string;
}

export function detailsToSManga(raw: DetailsRaw, lang: string, host: Host): SManga {
  const manga = SManga.create();
  manga.url = `/${lang}/comic/${raw.slug}`;
  manga.title = raw.full_name;
  manga.artist = names(raw.artists);
  manga.author = raw.writer.name;
  let description = "";
  if (lang !== raw.language_code) {
    // The site redirects to the correct language in this case. Not possible here.
    // The user has to intentionally open an invalid URL to arrive here.
    let language = lang;
    try {
      language = new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
    } catch {
      // runCatching { ... }.getOrDefault(lang)
    }
    description += `**Sorry, this content is not available in ${language}.**\n\n`;
  }
  const ratingString = getRatingString(raw.rate, raw.rate_count);
  if (ratingString.length > 0) description += `${ratingString}\n`;
  description += `Publisher: ${raw.publisher.name}\n`;
  description += `Published at: ${raw.published_at}\n`;
  description += "\n";
  description += plainText(host, raw.description);
  manga.description = description;
  manga.genre = names(raw.genres);
  manga.status = raw.status === "ongoing" ? SManga.ONGOING : raw.status === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;
  manga.thumbnail_url = raw.image;
  return manga;
}

// ---

export interface ChapterRaw {
  slug: string;
  rank: string;
}

export function chapterToSChapter(raw: ChapterRaw, lang: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/${lang}/chapter/${raw.slug}`;
  chapter.name = `#${raw.rank}`;
  return chapter;
}
