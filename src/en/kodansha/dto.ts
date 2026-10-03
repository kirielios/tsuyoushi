// Port of keiyoushi/extensions-source src/en/kodansha/Dto.kt
import { DateTimeFormatter, Locale, SChapter, SManga, parseHtml, type Host } from "../../../sdk/index.ts";

export interface EntryResponse {
  response: Entries[];
  status?: Status | null;
}

export interface Status {
  fullCount?: number | null;
}

export interface Entries {
  type?: string | null;
  content: EntryContent;
}

export interface EntryContent {
  id: number;
  title: string;
  thumbnails?: Thumbnail[] | null;
  readableUrl: string;
}

export function entryToSManga(c: EntryContent): SManga {
  const manga = SManga.create();
  manga.url = `${c.readableUrl}#${c.id}`;
  manga.title = c.title;
  manga.thumbnail_url = c.thumbnails?.at(-1)?.url;
  return manga;
}

export interface Thumbnail {
  url: string;
}

export interface DetailsResponse {
  response: Details;
}

export interface Details {
  genres?: Genre[] | null;
  creators?: Creator[] | null;
  completionStatus?: string | null;
  title: string;
  description?: string | null;
  ageRating?: string | null;
  thumbnails?: Thumbnail[] | null;
  publisher?: string | null;
}

export function detailsToSManga(d: Details, host: Host): SManga {
  const manga = SManga.create();
  manga.title = d.title;
  manga.author = d.creators?.map((it) => `${it.title}: ${it.name}`).join(", ");
  let description = "";
  if (d.description != null) description += parseHtml(host.load, d.description, "").text();
  if (d.publisher && d.publisher.trim()) description += `\n\nPublisher: ${d.publisher}`;
  if (d.ageRating && d.ageRating.trim()) description += `\n\n${d.ageRating}`;
  manga.description = description;

  manga.genre = d.genres?.map((it) => it.name).join(", ");
  manga.thumbnail_url = d.thumbnails?.[0]?.url;
  manga.status = d.completionStatus === "Complete" ? SManga.COMPLETED : d.completionStatus === "Ongoing" ? SManga.ONGOING : SManga.UNKNOWN;
  return manga;
}

export interface Genre {
  name: string;
}

export interface Creator {
  name: string;
  title: string;
}

export interface PurchasedComic {
  id: number;
}

export interface ChapterResponse {
  id: number;
  name: string;
  publishDate?: string | null;
  readable?: Readable | null;
  variants?: Variant[] | null;
  chapters?: ChapterResponse[] | null;
  chapterNumber?: number | null;
  volumeNumber?: number | null;
}

export function isLocked(c: ChapterResponse, purchasedIds: Set<number>): boolean {
  const priceType = c.variants?.[0]?.priceType;
  const isPaid = priceType === "Paid";
  return isPaid && !purchasedIds.has(c.id);
}

export function requiresLogin(c: ChapterResponse, isLoggedIn: boolean): boolean {
  const priceType = c.variants?.[0]?.priceType;
  return priceType === "FreeForRegistered" && !isLoggedIn;
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);

export function chapterToSChapter(c: ChapterResponse, isLocked: boolean, requiresLogin: boolean): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${c.id}#${c.readable?.seriesReadableUrl ?? null}:${c.volumeNumber ?? null}:${c.chapterNumber ?? null}:${requiresLogin ? "1" : "0"}`;
  chapter.name = isLocked ? `🔒 ${c.name}` : c.name;
  chapter.date_upload = dateFormat.tryParseDateTime(c.publishDate);
  return chapter;
}

export interface Readable {
  seriesReadableUrl: string;
}

export interface Variant {
  priceType?: string | null;
}

export interface ViewerResponse {
  pageNumber: number;
  comicID: number;
}

export interface PageResponse {
  url: string;
}

export interface LoginRequestBody {
  UserName: string;
  Password: string;
}

export interface RefreshRequestBody {
  refresh_token: string;
}

/** @JsonNames("access_token") / ("refresh_token"): the snake_case names are accepted as aliases. */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  access_token?: string;
  refresh_token?: string;
}
