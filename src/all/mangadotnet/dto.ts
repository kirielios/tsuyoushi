// Port of keiyoushi/extensions-source src/all/mangadotnet/Dto.kt
// @JsonNames aliases are resolved by the small readers below (mangaListOf, paginationOf, browseId).
import { SManga } from "../../../sdk/index.ts";

export interface Data<T> {
  data: T;
}

interface PaginationRaw {
  total_pages?: number | null;
  totalPages?: number | null;
  last_page?: number | null;
  lastPage?: number | null;
  current_page?: number | null;
  currentPage?: number | null;
  page?: number | null;
  next_cursor?: string | null;
  nextCursor?: string | null;
  cursor?: string | null;
  per_page?: number | null;
  total_results?: number | null;
}

export interface MangaList {
  mangaList?: BrowseManga[] | null;
  results?: BrowseManga[] | null;
  manga_list?: BrowseManga[] | null;
  pagination?: PaginationRaw | null;
  facets?: FacetsData | null;
}

/** mangaList, with its @JsonNames("results", "manga_list") */
export const mangaListOf = (it: MangaList): BrowseManga[] | null | undefined => it.mangaList ?? it.results ?? it.manga_list;

export function hasNextPage(it: MangaList): boolean {
  const p = it.pagination;
  const total = p?.total_pages ?? p?.totalPages ?? p?.last_page ?? p?.lastPage;
  const current = p?.current_page ?? p?.currentPage ?? p?.page;
  const nextCursor = p?.next_cursor ?? p?.nextCursor ?? p?.cursor;
  if (current != null && total != null) return current < total;
  return !!nextCursor;
}

export interface ViewAllData {
  data: MangaList;
  allGenres?: string[];
}

export interface BrowseManga {
  manga_id?: number;
  id?: number;
  title: string;
  photo?: string | null;
  is_blurworthy?: unknown;
}

const browseId = (it: BrowseManga) => it.manga_id ?? it.id!;

function isAdult(it: BrowseManga): boolean {
  const v = it.is_blurworthy;
  // JsonPrimitive: intOrNull == 1 || booleanOrNull == true
  if (typeof v === "number") return v === 1;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "1" || v === "true";
  return false;
}

const photoUrl = (photo: string | null | undefined, baseUrl: string) => {
  if (photo == null) return undefined;
  if (photo.startsWith("/")) return baseUrl + photo;
  if (photo.startsWith("http")) return photo;
  return undefined;
};

export function browseMangaToSManga(it: BrowseManga, baseUrl: string, hideAdultCovers = false): SManga {
  const manga = SManga.create();
  manga.url = String(browseId(it));
  manga.title = it.title;
  manga.thumbnail_url = isAdult(it) && hideAdultCovers ? "https://fakeimg.cnbattle.com/400x600/?text=NSFW" : photoUrl(it.photo, baseUrl);
  return manga;
}

export interface BookmarksData {
  entries?: BrowseManga[];
  total?: number | null;
  page?: number | null;
  per_page?: number | null;
}

export function bookmarksHasNextPage(it: BookmarksData): boolean {
  const p = it.page ?? 1;
  const pp = it.per_page ?? 39;
  const t = it.total ?? 0;
  return p * pp < t;
}

export interface MangaData {
  mangaData: {
    manga: Manga;
    total_volumes?: number | null;
  };
}

export interface RelatedData {
  suggestions?: BrowseManga[];
  relationsData?: {
    /** RelationsMapSerializer: an array (PHP's empty map) reads as an empty map */
    relations?: Record<string, BrowseManga[]> | unknown[];
  } | null;
}

export interface Manga {
  id: number;
  title: string;
  genres?: string[];
  tags?: TagCategory[];
  description?: string | null;
  photo?: string | null;
  hiatus?: string | null;
  status?: string | null;
  source_url?: string | null;
  alt_titles?: string[];
  country_of_origin?: string | null;
  avg_rating?: number | null;
  anilist_id?: number | null;
  mangaupdates_id?: string | null;
  mangabaka_id?: number | null;
  mal_id?: number | null;
  kitsu_id?: number | null;
  anime_planet_id?: string | null;
  shikimori_id?: number | null;
  ann_id?: number | null;
  mangadex_id?: string | null;
  year?: number | null;
  chapter_count?: number | null;
  tracked_count?: number | null;
  rating_count?: number | null;
  content_rating?: string | null;
  authors?: string | null;
  artists?: string | null;
}

const multipleNewlinesRegex = /\n{3,}/g;
const listRegex = /\n\n(-|•|\d+\.)/g;

function joinJsonList(s: string | null | undefined): string | null {
  if (s == null) return null;
  try {
    const list = JSON.parse(s) as unknown;
    return Array.isArray(list) && list.every((x) => typeof x === "string") ? list.join(", ") : null;
  } catch {
    return null;
  }
}

export function mangaToSManga(m: Manga, baseUrl: string, showTags = true, extraVolumeCount: number | null = null): SManga {
  const manga = SManga.create();
  manga.url = String(m.id);
  manga.title = m.title;
  manga.thumbnail_url = photoUrl(m.photo, baseUrl);
  const authors = joinJsonList(m.authors);
  manga.author = authors != null ? `​${authors}` : undefined;
  const artists = joinJsonList(m.artists);
  manga.artist = artists != null ? `​​${artists}` : undefined;

  const genres = m.genres ?? [];
  const genre: string[] = [];
  const origin = { JP: "Manga", KR: "Manhwa", CN: "Manhua", EN: "OEL" }[m.country_of_origin ?? ""];
  if (origin) genre.push(origin);
  genres.forEach((it) => genre.push(it.trim()));
  if (showTags) {
    (m.tags ?? [])
      .flatMap((it) => it.tags ?? [])
      .map((it) => it.name.trim())
      .sort((a, b) => {
        const x = a.toLowerCase();
        const y = b.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      })
      .forEach((it) => genre.push(it));
  }
  manga.genre = genre.join(", ");

  if (genres.includes("One Shot")) manga.status = SManga.COMPLETED;
  else if (m.hiatus === "Yes") manga.status = SManga.ON_HIATUS;
  else {
    const s = m.status?.toLowerCase();
    manga.status = s === "ongoing" ? SManga.ONGOING : s === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;
  }

  let d = "";
  const rating = m.avg_rating;
  if (rating != null) {
    const stars = Math.min(Math.max(Math.round(rating / 2), 0), 5);
    // Kotlin prints a Float with at least one decimal
    d += `${"★".repeat(stars)}${"☆".repeat(5 - stars)} ${Number.isInteger(rating) ? rating.toFixed(1) : rating}\n\n`;
  }

  const metaInfo: string[] = [];
  if (m.year != null) metaInfo.push(`**Year:** ${m.year}`);
  if (m.chapter_count != null) metaInfo.push(`**Chapters:** ${m.chapter_count}`);
  if (extraVolumeCount != null) metaInfo.push(`**Volumes:** ${extraVolumeCount}`);
  if (m.tracked_count != null) metaInfo.push(`**Tracked:** ${m.tracked_count}`);
  if (m.content_rating != null) metaInfo.push(`**Content Rating:** ${m.content_rating.charAt(0).toUpperCase()}${m.content_rating.slice(1)}`);
  if (m.rating_count != null && m.rating_count > 0) metaInfo.push(`${m.rating_count} ratings`);
  if (metaInfo.length) d += `${metaInfo.join(" · ")}\n\n`;

  if (d.length) d += "---\n\n";

  if (m.description != null) {
    d += `${m.description.replaceAll("\r\n", "\n").replace(multipleNewlinesRegex, "\n\n").replace(listRegex, "\n$1").trim()}\n\n`;
  }

  const links = [
    m.anilist_id != null ? `[AniList](https://anilist.co/manga/${m.anilist_id})` : null,
    m.mangaupdates_id != null ? `[MangaUpdates](https://www.mangaupdates.com/series/${m.mangaupdates_id})` : null,
    m.mangabaka_id != null ? `[MangaBaka](https://mangabaka.org/${m.mangabaka_id})` : null,
    m.mal_id != null ? `[MyAnimeList](https://myanimelist.net/manga/${m.mal_id})` : null,
    m.kitsu_id != null ? `[Kitsu](https://kitsu.app/manga/${m.kitsu_id})` : null,
    m.anime_planet_id != null ? `[AnimePlanet](https://www.anime-planet.com/manga/${m.anime_planet_id})` : null,
    m.shikimori_id != null ? `[Shikimori](https://shikimori.io/mangas/${m.shikimori_id})` : null,
    m.ann_id != null ? `[AnimeNewsNetwork](https://www.animenewsnetwork.com/encyclopedia/manga.php?id=${m.ann_id})` : null,
    m.mangadex_id != null ? `[MangaDex](https://mangadex.org/title/${m.mangadex_id})` : null,
    m.source_url != null ? `[Source](${m.source_url})` : null,
  ].filter((it) => it != null);
  if (links.length) {
    d += "\n**Links:**\n";
    for (const link of links) d += `- ${link}\n`;
  }

  const altTitles = m.alt_titles ?? [];
  if (altTitles.length) {
    d += "\n**Alternative Names:**\n";
    for (const altTitle of altTitles) d += `- ${altTitle.trim()}\n`;
  }
  manga.description = d.trim();
  manga.initialized = true;
  return manga;
}

export interface Chapter {
  id: number;
  chapter_number?: number | null;
  volume_number?: number | null;
  chapter_title?: string | null;
  language?: string | null;
  group_id?: number | null;
  group_name?: string | null;
  scanlator_name?: string | null;
  date_added?: string | null;
  page_count?: number | null;
  source?: string; // "user"
  groups?: { id: number; name: string }[];
}

export interface Volume {
  id: number;
  volume_number?: number | null;
  group_name?: string | null;
  scanlator_name?: string | null;
  date_added?: string | null;
  source?: string; // "user"
  language?: string | null;
}

export interface ChapterUrl {
  id: string;
  source: string;
  isVolume: boolean;
}

export interface Images {
  manga: { id: number };
  images: { url: string }[];
}

export interface TagCategory {
  category: string;
  is_adult?: boolean;
  tags?: TagItem[];
}

export interface TagItem {
  name: string;
  weight?: string | null;
  is_adult?: boolean;
}

export interface MangaItemsResponse {
  items?: BrowseManga[];
}

export interface FacetsData {
  genres?: { key: string; count?: number | null }[];
  tags?: { key: string; count?: number | null; is_adult?: boolean }[];
}

export interface TagsResponse {
  categories?: TagCategory[];
}
