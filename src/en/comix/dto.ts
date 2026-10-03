// Port of keiyoushi/extensions-source src/en/comix/Dto.kt
import { SChapter, SManga } from "../../../sdk/index.ts";

export const MANGA_ID_MEMO = "mangaId";
export const CHAPTER_ID_MEMO = "chapterId";
export const CHAPTER_VOTES_MEMO = "votes";
export const CHAPTER_OFFICIAL_MEMO = "official";
export const CHAPTER_GROUP_ID_MEMO = "groupId";
export const CHAPTER_LIST_DEDUPLICATED_MEMO = "chapterListDeduplicated";
export const CHAPTER_LIST_BLACKLIST_MEMO = "chapterListBlacklist";

export interface Term {
  title: string;
}

export interface TagSearchResponse {
  result?: TagSearchHit[];
}

export interface TagSearchHit {
  id: number;
}

export interface Poster {
  small?: string | null;
  medium?: string | null;
  large?: string | null;
}
function posterFrom(p: Poster, quality: string | null): string {
  switch (quality) {
    case "large":
      return p.large ?? p.medium ?? p.small ?? "";
    case "small":
      return p.small ?? p.medium ?? p.large ?? "";
    default:
      return p.medium ?? p.large ?? p.small ?? "";
  }
}

export interface Manga {
  hid: string;
  title: string;
  altTitles?: string[];
  alt_titles?: string[];
  synopsis?: string | null;
  type?: string;
  poster?: Poster | null;
  status?: string;
  contentRating?: string;
  authors?: Term[] | null;
  author?: Term[] | null;
  artists?: Term[] | null;
  artist?: Term[] | null;
  genres?: Term[] | null;
  genre?: Term[] | null;
  tags?: Term[] | null;
  theme?: Term[] | null;
  demographics?: Term[] | null;
  demographic?: Term[] | null;
  formats?: Term[] | null;
  ratedAvg?: number;
  ratedCount?: number;
  followsTotal?: number;
  rank?: number;
  year?: number | null;
  originalLanguage?: string | null;
  links?: Record<string, string | null> | null;
  url?: string | null;
}

function fancyScore(m: Manga): string {
  const ratedAvg = m.ratedAvg ?? 0;
  if (ratedAvg === 0) return "";
  // BigDecimal(score / 2).setScale(0, HALF_UP); Double.toString + stripTrailingZeros prints like JS numbers
  const stars = Math.round(ratedAvg / 2);
  const scoreString = String(ratedAvg);
  let s = "★".repeat(stars);
  if (stars < 5) s += "☆".repeat(5 - stars);
  return `${s} ${scoreString}`;
}

const mangaUrl = (m: Manga) => (m.url != null ? substringAfterTitle(m.url) : `/${m.hid}`);
const substringAfterTitle = (s: string) => {
  const i = s.indexOf("/title");
  return i < 0 ? s : s.slice(i + "/title".length);
};

export function toSManga(m: Manga, posterQuality: string | null, altTitlesInDesc = false, scorePosition: string, showExtraInfo = true, showTags = false): SManga {
  const out = SManga.create();
  out.url = mangaUrl(m);
  out.memo = { [MANGA_ID_MEMO]: m.hid };
  out.title = m.title;

  const actualAuthors = m.authors ?? m.author;
  const actualArtists = m.artists ?? m.artist;

  out.author = actualAuthors?.map((it) => it.title).join(", ");
  out.artist = actualArtists?.map((it) => it.title).join(", ");
  let d = "";
  if (scorePosition === "top") {
    const fs = fancyScore(m);
    if (fs) d += fs + "\n\n";
  }

  if (m.synopsis) d += m.synopsis;

  const altTitles = m.altTitles ?? [];
  const actualAltTitles = altTitles.length ? altTitles : (m.alt_titles ?? []);
  if (altTitlesInDesc && actualAltTitles.length) {
    d += "\n\n";
    d += "**Alternative Names**:\n";
    d += actualAltTitles.map((it) => `- ${it}`).join("\n");
  }

  if (showExtraInfo) {
    const extras = buildExtraInfo(m);
    if (extras.length) {
      if (d) d += "\n\n";
      d += extras.join("\n");
    }

    const trackerLinks = getTrackerLinks(m);
    if (trackerLinks.length) {
      if (d) d += "\n\n";
      d += "**Trackers**:\n";
      d += trackerLinks.map((it) => `- ${it}`).join("\n");
    }
  }

  if (scorePosition === "bottom") {
    const fs = fancyScore(m);
    if (fs) {
      if (d) d += "\n\n";
      d += fs;
    }
  }
  out.description = d;
  out.initialized = true;
  switch (m.status ?? "") {
    case "releasing":
      out.status = SManga.ONGOING;
      break;
    case "on_hiatus":
      out.status = SManga.ON_HIATUS;
      break;
    case "finished":
      out.status = SManga.COMPLETED;
      break;
    case "discontinued":
      out.status = SManga.CANCELLED;
      break;
    default:
      out.status = SManga.UNKNOWN;
  }
  out.thumbnail_url = m.poster ? posterFrom(m.poster, posterQuality) : undefined;
  out.genre = getGenres(m, showTags);
  return out;
}

export function toBasicSManga(m: Manga, posterQuality: string | null): SManga {
  const out = SManga.create();
  out.url = mangaUrl(m);
  out.memo = { [MANGA_ID_MEMO]: m.hid };
  out.title = m.title;
  out.thumbnail_url = m.poster ? posterFrom(m.poster, posterQuality) : undefined;
  return out;
}

function buildExtraInfo(m: Manga): string[] {
  const out: string[] = [];
  if (m.year != null && m.year > 0) out.push(`**Year**: ${m.year}`);
  if (m.originalLanguage?.trim()) out.push(`**Language**: ${m.originalLanguage.toUpperCase()}`);
  const contentRating = m.contentRating ?? "safe";
  if (contentRating.trim()) out.push(`**Content rating**: ${contentRating[0].toUpperCase()}${contentRating.slice(1)}`);
  if ((m.rank ?? 0) > 0) out.push(`**Rank**: #${m.rank}`);
  if ((m.ratedCount ?? 0) > 0) out.push(`**Rated by**: ${m.ratedCount}`);
  if ((m.followsTotal ?? 0) > 0) out.push(`**Followed by**: ${m.followsTotal}`);
  return out;
}

function getTrackerLinks(m: Manga): string[] {
  const linkMap = m.links;
  if (linkMap == null) return [];
  const siteNames: [string, string][] = [
    ["al", "AniList"],
    ["mal", "MyAnimeList"],
    ["mu", "MangaUpdates"],
    ["md", "MangaDex"],
    ["mb", "MangaBaka"],
  ];
  const knownLinks = siteNames.flatMap(([key, name]) => {
    const url = linkMap[key];
    return url?.trim() ? [`[${name}](${url})`] : [];
  });
  const unknownLinks = Object.entries(linkMap)
    .filter(([k]) => !siteNames.some((it) => it[0] === k))
    .flatMap(([key, url]) => (url?.startsWith("http") ? [`[${key.toUpperCase()}](${url})`] : []));
  return [...knownLinks, ...unknownLinks];
}

// Tags are separate from the curated genres in the site's detail UI.
function getGenres(m: Manga, showTags: boolean): string {
  const out: string[] = [];
  switch (m.type ?? "") {
    case "manhwa":
      out.push("Manhwa");
      break;
    case "manhua":
      out.push("Manhua");
      break;
    case "manga":
      out.push("Manga");
      break;
    default:
      out.push("Other");
  }
  (m.genres ?? m.genre)?.forEach((it) => out.push(it.title));
  (m.demographics ?? m.demographic)?.forEach((it) => out.push(it.title));
  if (showTags) m.tags?.forEach((it) => out.push(it.title));
  const contentRating = m.contentRating ?? "safe";
  if (contentRating === "erotica" || contentRating === "pornographic") out.push("NSFW");
  return [...new Set(out)].join(", ");
}

export interface SingleMangaResponse {
  result: Manga;
}

export interface Meta {
  page?: number;
  lastPage?: number;
  last_page?: number;
  hasNext?: boolean;
}
const actualLastPage = (m: { lastPage?: number; last_page?: number }) => Math.max(m.lastPage ?? 1, m.last_page ?? 1);

export interface Pagination {
  page?: number;
  lastPage?: number;
  last_page?: number;
}

export interface Items<T> {
  items?: T[];
  meta?: Meta | null;
  pagination?: Pagination | null;
}
export function hasNextPage(it: Items<unknown>): boolean {
  if (it.meta != null) return (it.meta.page ?? 1) < actualLastPage(it.meta);
  if (it.pagination != null) return (it.pagination.page ?? 1) < actualLastPage(it.pagination);
  return false;
}

export interface SearchResponse {
  result: Items<Manga>;
}

export interface ChapterDetailsResponse {
  result: Items<Chapter>;
}

export interface Chapter {
  id: number;
  url?: string;
  number: number;
  name?: string;
  votes?: number;
  createdAtFormatted?: string;
  group?: ScanlationGroup | null;
  isOfficial?: boolean;
}

export interface ScanlationGroup {
  id?: number | null;
  name: string;
}

const DATE_REGEX = /^(\d+)\s*(s|m|h|d|w|mo|mos|y|yr|yrs|min|mins|sec|secs|hr|hrs|day|days|week|weeks|month|months|year|years)$/;

/** Double.toString().removeSuffix(".0"): JS already prints whole numbers without the ".0". */
const numberText = (n: number) => String(n);

export function chapterToSChapter(c: Chapter, mangaSlug: string): SChapter {
  const ch = SChapter.create();
  const url = c.url ?? "";
  const index = url.indexOf("/title/");
  ch.url = index !== -1 ? url.slice(index + 1) : `title/${mangaSlug}/${c.id}-chapter-${numberText(c.number)}`;
  const memo: Record<string, unknown> = {
    [CHAPTER_ID_MEMO]: c.id,
    [CHAPTER_VOTES_MEMO]: c.votes ?? 0,
    [CHAPTER_OFFICIAL_MEMO]: c.isOfficial ?? false,
  };
  if (c.group?.id != null) memo[CHAPTER_GROUP_ID_MEMO] = c.group.id;
  ch.memo = memo;
  ch.name = `Chapter ${numberText(c.number)}${c.name ? `: ${c.name}` : ""}`;
  ch.date_upload = parseRelativeDate(c.createdAtFormatted ?? "");
  ch.chapter_number = c.number;
  ch.scanlator = c.group != null ? c.group.name : c.isOfficial ? "Official" : "Unknown";
  return ch;
}

function parseRelativeDate(dateStr: string): number {
  if (!dateStr) return 0;
  let trimmed = dateStr.trim().toLowerCase();
  if (trimmed.endsWith(" ago")) trimmed = trimmed.slice(0, -" ago".length);
  const match = DATE_REGEX.exec(trimmed);
  if (!match) return 0;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(amount)) return 0;
  const unit = match[2];

  const calendar = new Date();
  switch (unit) {
    case "s":
    case "sec":
    case "secs":
      calendar.setSeconds(calendar.getSeconds() - amount);
      break;
    case "m":
    case "min":
    case "mins":
      calendar.setMinutes(calendar.getMinutes() - amount);
      break;
    case "h":
    case "hr":
    case "hrs":
      calendar.setHours(calendar.getHours() - amount);
      break;
    case "d":
    case "day":
    case "days":
      calendar.setDate(calendar.getDate() - amount);
      break;
    case "w":
    case "week":
    case "weeks":
      calendar.setDate(calendar.getDate() - amount * 7);
      break;
    case "mo":
    case "mos":
    case "month":
    case "months":
      calendar.setMonth(calendar.getMonth() - amount);
      break;
    case "y":
    case "yr":
    case "yrs":
    case "year":
    case "years":
      calendar.setFullYear(calendar.getFullYear() - amount);
      break;
  }
  return calendar.getTime();
}

export interface ChapterResponse {
  result: { pages: Pages };
}

export interface Pages {
  baseUrl: string;
  items: PageDto[];
}

export interface PageDto {
  url: string;
  s?: number;
}
