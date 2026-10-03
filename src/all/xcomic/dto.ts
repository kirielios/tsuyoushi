// Port of keiyoushi/extensions-source src/all/xcomic/Dto.kt
import { SChapter, SManga } from "../../../sdk/index.ts";
import { languages } from "./filters.ts";

// ============================= Shared primitives =============================
export interface XComicName {
  name?: string | null;
}

export interface XComicData<T> {
  data: T;
}

export interface XComicPaging {
  next?: number | null;
  total?: number | null;
}
export const hasNextPage = (p: XComicPaging) => (p.next ?? 0) !== 0;

export interface DateYMD {
  y?: number | null;
  m?: number | null;
  d?: number | null;
}
function dateYMDToString(it: DateYMD): string {
  let s = "";
  if (it.y != null) s += it.y;
  if (it.m != null) s += `-${String(it.m).padStart(2, "0")}`;
  if (it.d != null) s += `-${String(it.d).padStart(2, "0")}`;
  return s;
}

export interface XComicStrings {
  text?: string | null;
}

// ====================== Title node (main identity) ========================
export interface ComicTrackingSites {
  mangaupdates?: string | null;
  myanimelist?: string | null;
  animeplanet?: string | null;
  anilist?: string | null;
  kitsu?: string | null;
}

export interface TitleTrackingSites {
  anilist?: number | null;
  myanimelist?: number | null;
  mangaupdates?: string | null; // hash slug
  kitsu?: number | null;
  animeplanet?: string | null; // text slug
  shikimori?: string | null; // = MAL id
  mangabaka?: number | null;
}

// ============================= Title Browse =============================
export interface TitleBrowseData {
  get_title_browse_items?: TitleBrowseNode[] | null;
}

export interface TitleBrowseNode {
  id?: string | null;
  data?: TitleBrowseItem | null;
}

// ====================== Comic Probe (browse fan-out) ======================
export interface ComicProbeEnvelope {
  get_comicNode?: XComicData<ComicProbeData | null> | null;
}

export interface ComicProbeData {
  name?: string | null;
  subName?: string | null;
  dbStatus?: string | null;
  isPublic?: boolean | null;
  translatedLanguage?: string | null;
  chaps_normal?: number | null;
  urlPath?: string | null;
  urlCover?: string | null;
}
/** ComicProbeData.isLive() / ComicNode.isLive() */
export const isLive = (it: { isPublic?: boolean | null; dbStatus?: string | null }) => it.isPublic !== false && (it.dbStatus == null || it.dbStatus === "normal");

export interface TitleBrowseItem {
  title?: string | null;
  native_title?: string | null;
  romanized_title?: string | null;
  original_language?: string | null;
  translated_languages?: (string | null)[] | null; // null elements 3×
  type?: string | null;
  chap_last_public_at?: number | null;
  cover_local_url?: string | null; // full-res — prefer
  cover_url?: string | null; // x250 thumb — fallback
  comic_ids?: string[] | null;
}

// ====================== Title Node (details backbone) =====================
export interface TitleNodeEnvelope {
  get_title_titleNode?: XComicData<TitleNodeData | null> | null;
}

export interface TitleNodeData {
  id?: string | null;
  title?: string | null;
  alt_titles?: (string | null)[] | null;
  native_title?: string | null;
  romanized_title?: string | null;
  original_language?: string | null;
  translated_languages?: (string | null)[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  // taxonomy — SLUG STRINGS (doc's Int claim wrong; triple-verified live)
  content_rating_id?: string | null;
  type_id?: string | null;
  demographic_ids?: string[] | null;
  genre_ids?: string[] | null;
  format_ids?: string[] | null;
  year?: number | null;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  cover_local_url?: string | null; // full-res — prefer
  cover_local?: string | null; // raw key (redundant)
  cover_url?: string | null; // x250 thumb — fallback
  urlPath?: string | null;
  total_comics?: number | null;
  total_chapters?: number | null;
  total_follows?: number | null;
  total_reviews?: number | null;
  total_comments?: number | null;
  vote_avg?: number | null;
  vote_users?: number | null;
  vote_bay?: number | null;
  vote_val?: number | null;
  chap_last_public_at?: number | null; // work-level freshness
  created_at?: number | null;
  updated_at?: number | null;
  is_merged?: boolean | null;
  merged_to?: string | null;
  comic_ids?: string[] | null;
  tracking_sites?: TitleTrackingSites | null;
}

export function toMarkdownLinks(t: TitleTrackingSites | null | undefined): string[] {
  const out: string[] = [];
  if (t?.anilist != null) out.push(`[AniList](https://anilist.co/manga/${t.anilist})`);
  if (t?.myanimelist != null) out.push(`[MyAnimeList](https://myanimelist.net/manga/${t.myanimelist})`);
  if (t?.mangaupdates != null) out.push(`[MangaUpdates](https://www.mangaupdates.com/series/${t.mangaupdates})`);
  if (t?.kitsu != null) out.push(`[Kitsu](https://kitsu.app/manga/${t.kitsu})`);
  if (t?.animeplanet != null) out.push(`[Anime-Planet](https://www.anime-planet.com/manga/${t.animeplanet})`);
  if (t?.shikimori != null) out.push(`[Shikimori](https://shikimori.io/mangas/${t.shikimori})`);
  if (t?.mangabaka != null) out.push(`[MangaBaka](https://mangabaka.org/${t.mangabaka})`);
  return out;
}

// ================== Comic node (source / upload identity) =================
export interface ComicNode {
  id: string;
  name: string;
  subName?: string | null;
  altNames?: string[] | null;
  authors?: string[] | null;
  authorNodes?: XComicData<XComicName | null>[] | null;
  artists?: string[] | null;
  artistNodes?: XComicData<XComicName | null>[] | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  originalStatus?: string | null;
  originalPubFrom?: DateYMD | null;
  originalPubTill?: DateYMD | null;
  originalPubZone?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
  publishers?: string[] | null;
  publisherNodes?: XComicData<XComicName | null>[] | null;
  tagNodes?: XComicData<XComicName | null>[] | null;
  summary?: XComicStrings | null;
  extraInfo?: XComicStrings | null;
  readDirection?: string | null;
  dbStatus?: string | null;
  isPublic?: boolean | null;
  is_hot?: boolean | null;
  is_new?: boolean | null;
  follows?: number | null;
  reviews?: number | null;
  comments_total?: number | null;
  score_val?: number | null;
  chaps_normal?: number | null;
  dateUpload?: number | null;
  chapterNode_up_to?: ChapterUpToNode | null;
  trackingSites?: ComicTrackingSites | null;
  urlPath?: string | null;
  urlCover?: string | null;
}

const names = (nodes: XComicData<XComicName | null>[] | null | undefined) => nodes?.map((it) => it.data?.name).filter((it): it is string => it != null);
const nonEmpty = <T>(list: T[] | null | undefined) => (list && list.length ? list : undefined);
const label = (code: string) => languages.find((it) => it[1] === code)?.[0];

export function comicToSManga(c: ComicNode, baseUrl: string, cleanTitle: (s: string) => string): SManga {
  const m = SManga.create();
  m.url = c.id;
  m.title = cleanTitle(c.name);

  m.author = nonEmpty(names(c.authorNodes))?.join(", ");
  m.artist = nonEmpty(names(c.artistNodes))?.join(", ");

  const genre = new Set<string>();
  if (c.type != null) genre.add(toTitleCase(c.type));
  c.demographics?.forEach((d) => genre.add(toTitleCase(d)));
  if (c.contentRating != null) genre.add(toTitleCase(c.contentRating));
  c.genres?.forEach((g) => genre.add(toTitleCase(g)));
  m.genre = [...genre].join(", ");

  m.memo = c.urlPath != null ? { urlPath: c.urlPath } : {};

  const statusToCheck = c.originalStatus ?? c.uploadStatus;
  m.status =
    statusToCheck == null
      ? SManga.UNKNOWN
      : statusToCheck.includes("pending")
        ? SManga.UNKNOWN
        : statusToCheck.includes("ongoing")
          ? SManga.ONGOING
          : statusToCheck.includes("cancelled")
            ? SManga.CANCELLED
            : statusToCheck.includes("hiatus")
              ? SManga.ON_HIATUS
              : statusToCheck.includes("completed")
                ? c.uploadStatus?.includes("ongoing")
                  ? SManga.PUBLISHING_FINISHED
                  : SManga.COMPLETED
                : SManga.UNKNOWN;
  m.thumbnail_url = c.urlCover != null ? (c.urlCover.startsWith("http") ? c.urlCover : `${baseUrl}${c.urlCover}`) : undefined;

  let d = "";
  if (c.is_hot === true) d += "🔥 HOT ";
  if (c.is_new === true) d += "✨ NEW";
  if (c.is_hot === true || c.is_new === true) d += "\n\n";

  const metadata: string[] = [];
  if (c.originalLanguage != null) metadata.push(`**Original**: ${label(c.originalLanguage) ?? c.originalLanguage}`);
  if (c.translatedLanguage != null) metadata.push(`**Translated**: ${label(c.translatedLanguage) ?? c.translatedLanguage}`);
  if (c.originalPubFrom != null) {
    const till = c.originalPubTill != null ? dateYMDToString(c.originalPubTill) : "Ongoing";
    metadata.push(`**Publication**: ${dateYMDToString(c.originalPubFrom)} - ${till}`);
  }
  if (c.originalPubZone) metadata.push(`**Region**: ${c.originalPubZone}`);
  if (c.readDirection != null) {
    const directionValues: [string, string][] = [
      ["ttb", "⬇️ Top To Bottom"],
      ["rtl", "⬅️ Right To Left"],
      ["ltr", "➡️ Left To Right"],
    ];
    metadata.push(`**Read Direction**: ${directionValues.find((it) => it[0] === c.readDirection)?.[1] ?? c.readDirection}`);
  }
  if (metadata.length) d += metadata.join("\n") + "\n\n";

  const stats: string[] = [];
  if (c.score_val != null && c.score_val > 0) stats.push(`**Score**: ${c.score_val.toFixed(1)}`);
  if (c.follows != null && c.follows > 0) stats.push(`**Follows**: ${c.follows}`);
  if (c.reviews != null && c.reviews > 0) stats.push(`**Reviews**: ${c.reviews}`);
  if (c.comments_total != null && c.comments_total > 0) stats.push(`**Comments**: ${c.comments_total}`);
  if (c.chaps_normal != null && c.chaps_normal > 0) stats.push(`**Chapters**: ${c.chaps_normal}`);
  if (stats.length) d += `**Statistics**\n${stats.join(" · ")}\n\n`;

  if (metadata.length) d += "\n\n---\n\n";

  const summaryText = c.summary?.text;
  if (summaryText) d += toMarkdownUrls(summaryText);

  const t = c.trackingSites;
  const links: string[] = [];
  if (t?.mangaupdates != null) links.push(`[MangaUpdates](https://www.mangaupdates.com/series/${t.mangaupdates})`);
  if (t?.myanimelist != null) links.push(`[MyAnimeList](https://myanimelist.net/manga/${t.myanimelist})`);
  if (t?.animeplanet != null) links.push(`[Anime-Planet](https://www.anime-planet.com/manga/${t.animeplanet})`);
  if (t?.anilist != null) links.push(`[AniList](https://anilist.co/manga/${t.anilist})`);
  if (t?.kitsu != null) links.push(`[Kitsu](https://kitsu.app/manga/${t.kitsu})`);
  if (links.length) {
    if (d) d += "\n\n";
    d += "**External Links**:\n" + links.map((it) => `- ${it}`).join("\n");
  }

  const extras: string[] = [];
  const pubList = nonEmpty(names(c.publisherNodes)) ?? c.publishers;
  if (pubList?.length) extras.push(`**Publishers**: ${pubList.join(", ")}`);
  const tagList = nonEmpty(names(c.tagNodes)) ?? c.tags;
  if (tagList?.length) extras.push(`**Tags**: ${tagList.join(", ")}`);
  if (extras.length) {
    if (d) d += "\n\n";
    d += extras.join("\n\n");
  }

  if (c.altNames?.length) {
    if (d) d += "\n\n";
    d += "**Alternative Titles**:\n" + c.altNames.map((it) => `- ${it}`).join("\n");
  }

  const extraInfoText = c.extraInfo?.text;
  if (extraInfoText) {
    if (d) d += "\n\n**Extra Info**:\n";
    d += toMarkdownUrls(extraInfoText);
  }
  m.description = d;
  m.initialized = c.originalStatus != null;
  return m;
}

// ================== Comic browse (legacy path / deep links) ===============
export interface ComicNodeData {
  get_comicNode: XComicData<ComicNode>;
}

export interface ChapterUpToNode {
  id?: string | null;
  data?: ChapterUpToData | null;
}

export interface ChapterUpToData {
  dname?: string | null;
  datePublic?: number | null;
}

// ================================ Chapters ================================
export interface ChapterListData {
  get_comic_chapterList_fullList: ChapterListItems;
}

export interface ChapterListUniqData {
  get_comic_chapterList_uniqList: ChapterListItems;
}

export interface ChapterListItems {
  paging: XComicPaging;
  items: ApiChapterWrapper[];
}

export interface ChapterPagesData {
  get_chapterNode: ChapterNodeWithImages;
}

export interface ChapterNodeWithImages {
  id: string;
  data: ChapterImageUrls;
}

export interface ChapterImageUrls {
  imageUrls: string[];
}

export interface ApiChapterWrapper {
  id: string;
  data: ChapterData;
}

export interface ChapterData {
  id: string;
  comicId?: string | null;
  dbStatus?: string | null;
  isFinal?: boolean | null;
  volume?: unknown;
  serial?: number | null;
  dname?: string | null;
  title?: string | null;
  urlPath?: string | null;
  sfw_result?: unknown;
  chaDuplications?: unknown;
  dateCreate?: number | null;
  datePublic?: number | null;
  dateModify?: number | null;
  chaNum?: number | null;
  volNum?: number | null;
  count_images?: number | null;
  is_new?: boolean | null;
  srcName?: string | null;
  srcTitle?: string | null;
  srcColor?: string | null;
  comments_topic?: number | null;
  comments_total?: number | null;
  views_login?: number | null;
  views_guest?: number | null;
  profileNodes?: (XComicData<XComicName | null> | null)[] | null;
}

export function chapterToSChapter(c: ChapterData): SChapter {
  const ch = SChapter.create();
  ch.url = c.id;
  const displayName = c.dname ?? "";
  const num = c.chaNum ?? c.serial;
  // Float.toString(): whole numbers print as "1.0", hence removeSuffix(".0")
  const number = num != null ? String(num) : null;
  let name = "";
  if (number != null && !displayName.includes(number)) name += `Chapter ${number}`;
  if (displayName) {
    if (name) name += ": ";
    name += displayName;
  }
  if (c.title) {
    if (name) name += ": ";
    name += c.title;
  }
  ch.name = name;

  ch.memo = c.urlPath != null ? { urlPath: c.urlPath } : {};

  if (num != null) ch.chapter_number = num;
  ch.date_upload = c.dateModify ?? c.dateCreate ?? c.datePublic ?? 0;

  const profiles = c.profileNodes
    ?.map((it) => it?.data?.name)
    .filter((it): it is string => it != null)
    .join(", ");
  ch.scanlator = c.srcName ? c.srcName[0].toUpperCase() + c.srcName.slice(1) : profiles || undefined;
  return ch;
}

// ================================ Helpers =================================

export const toTitleCase = (s: string): string =>
  s
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => {
      const w = word.toLowerCase();
      return w ? w[0].toUpperCase() + w.slice(1) : w;
    })
    .join(" ");

const urlRegex = /(?<![[(])(https?:\/\/[^\s<"]+)/g;

export const toMarkdownUrls = (s: string): string => s.replace(urlRegex, (url) => `[${url}](${url})`);
