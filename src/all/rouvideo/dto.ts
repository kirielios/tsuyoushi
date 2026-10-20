// Port of yuzono/anime-extensions src/all/rouvideo/RouVideoDto.kt
// The pages' data now comes from TanStack Start loader data (see seroval.ts) instead of __NEXT_DATA__'s props.pageProps;
// the shapes below are the loader data, same field names as upstream's page props.
import { MangasPage, SAnime, SEpisode, type AnimesPage } from "../../../sdk/index.ts";
import { SORT_LIKE_KEY, SORT_VIEW_KEY, type Tag } from "./filters.ts";

export interface VideoList {
  order?: string | null; // createdAt...
  videos: Video[];
  pageNum: number;
  totalPage: number;
  totalVideoNum: number;
  hotSearches?: string[] | null; // only in Search
}
export const videoListToAnimePage = (p: VideoList): AnimesPage => new MangasPage(p.videos.map(toSAnime), p.pageNum < p.totalPage);

export interface HotVideoList {
  latestVideos?: Video[];
  dailyHotCNAV?: Video[];
  dailyHotSelfie?: Video[];
  dailyHot91?: Video[];
  dailyOnlyFans?: Video[];
  dailyJV?: Video[];
  hotCNAV?: Video[];
  hotSelfie?: Video[];
  hot91?: Video[];
}

export function hotVideoListToAnimePage(p: HotVideoList, sort: string | undefined): AnimesPage {
  const all = [p.latestVideos, p.dailyHotCNAV, p.dailyHotSelfie, p.dailyHot91, p.dailyOnlyFans, p.dailyJV, p.hotCNAV, p.hotSelfie, p.hot91].flatMap((l) => l ?? []);
  const byDate = (a: Video, b: Video) => b.createdAt.localeCompare(a.createdAt);
  all.sort((a, b) => {
    if (sort === SORT_VIEW_KEY) return b.viewCount - a.viewCount || byDate(a, b);
    if (sort === SORT_LIKE_KEY) {
      if (a.likeCount == null && b.likeCount != null) return 1;
      if (a.likeCount != null && b.likeCount == null) return -1;
      if (a.likeCount != null && b.likeCount != null) return a.likeCount > b.likeCount ? -1 : 1;
      return byDate(a, b);
    }
    return byDate(a, b);
  });
  // associateBy { it.id }: the last duplicate wins, in the first one's place
  const byId = new Map<string, Video>();
  for (const v of all) byId.set(v.id, v);
  return new MangasPage([...byId.values()].map(toSAnime), false);
}

export const listToAnimePage = (videos: Video[]): AnimesPage => new MangasPage(videos.map(toSAnime), false);

export interface VideoDetails {
  video: Video;
  relatedVideos: Video[];
  // Was a sources[]-free detail plus /api/v/<id>; the stream URL is now here, base64 with each char shifted by k.
  ev?: { d: string; k: number } | null;
}

export interface Video {
  id: string;
  vid?: string | null; // code
  name: string;
  description?: string | null;
  ref?: string | null;
  tags: string[];
  createdAt: string; // "2025-01-14T23:18:27.933Z"
  viewCount: number;
  likeCount?: number | null; // not available in search & relatedVideos
  duration: number; // in seconds
  coverImageUrl: string;
  nameZh?: string | null;
  tagZh?: string[] | null;
  sources?: { resolution: number }[] | null; // not available in details
}

export const resolutionDesc = (resolution: string) => `Resolution: ${resolution}p`;

function desc(v: Video): string {
  let s = "";
  const first = v.sources?.[0];
  if (first) s += `${resolutionDesc(String(first.resolution))}\n`;
  s += `Duration: ${formatDuration(Math.trunc(v.duration))}\n`;
  s += `View: ${v.viewCount}`;
  if (v.likeCount != null) s += ` - Like: ${v.likeCount}`;
  if (v.ref != null) s += `\nRef: ${v.ref}`;
  if (v.description != null) s += `\n\n${v.description}`;
  return s;
}

export function toSAnime(v: Video): SAnime {
  const majorCategory = v.tags[0];
  const anime = SAnime.create();
  anime.url = v.id;
  anime.title = v.name;
  anime.thumbnail_url = v.coverImageUrl;
  anime.artist = majorCategory;
  anime.author = majorCategory;
  anime.description = desc(v);
  anime.genre = [...(v.vid != null ? [v.vid] : []), ...v.tags].join(", ");
  anime.status = SAnime.COMPLETED;
  anime.initialized = true;
  return anime;
}

export function toEpisode(v: Video): SEpisode {
  const ep = SEpisode.create();
  ep.name = v.id;
  ep.url = v.id;
  ep.date_upload = Date.parse(v.createdAt.trim()) || 0;
  ep.episode_number = 1;
  return ep;
}

export const getTagList = (v: Video): Tag[] => v.tags.map((it) => [it, it]);

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours}:${minutes}:${seconds % 60}`;
}

export interface TagList {
  taxonomy: { cats?: { id: string }[]; genre?: { id: string }[] };
}
// Upstream read gcAV / madouAV / v91 / onlyfans; the /cat page now groups them as cats (top level) and genre.
export const toTagList = (p: TagList): Tag[] => [...(p.taxonomy.cats ?? []), ...(p.taxonomy.genre ?? [])].map((it) => [it.id, it.id]);
