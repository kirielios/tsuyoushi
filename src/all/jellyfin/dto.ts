// Port of yuzono/anime-extensions src/all/jellyfin/dto/*.kt (FiltersDto, ItemDto, ItemType, LoginDto, MediaLibraryDto,
// PlaybackInfoDto). Jellyfin's JSON is PascalCase (upstream's PascalCaseToCamelCase naming strategy), so the fields
// keep that case here.
//
// ponytail: SAnime's background_url, season_number, fetch_type and SEpisode's summary, preview_url are Aniyomi fields
// the host's models do not have; they are left out.
import { SAnime, SEpisode, tryParseInstant } from "../../../sdk/index.ts";
import { format, getImageUrl } from "./utils.ts";

// ItemType.kt
export const ItemType = ["BoxSet", "Movie", "Season", "Series", "Episode", "Other"] as const;
export type ItemType = (typeof ItemType)[number];
export const itemTypeFromString = (value: string | null | undefined): ItemType => ItemType.find((it) => it.toLowerCase() === value?.toLowerCase()) ?? "Other";

// FiltersDto.kt
export interface FiltersDto {
  Genres?: string[] | null;
  Tags?: string[] | null;
  OfficialRatings?: string[] | null;
  Years?: number[] | null;
}

// LoginDto.kt
export interface LoginDto {
  AccessToken: string;
  SessionInfo: { UserId: string };
}
export interface LoginRequestDto {
  Username: string;
  Pw: string;
}

// MediaLibraryDto.kt
export interface MediaLibraryDto {
  name: string;
  id: string;
}

// PlaybackInfoDto.kt
export interface PlaybackInfoDto {
  UserId: string;
  IsPlayback: boolean;
  MediaSourceId: string;
  MaxStreamingBitrate: number;
  EnableTranscoding: boolean;
  AudioStreamIndex?: string;
  SubtitleStreamIndex?: string;
  AlwaysBurnInSubtitleWhenTranscoding: boolean;
  DeviceProfile: DeviceProfileDto;
}
export interface DeviceProfileDto {
  Name: string;
  MaxStreamingBitrate: number;
  MaxStaticBitrate: number;
  MusicStreamingTranscodingBitrate: number;
  TranscodingProfiles: ProfileDto[];
  DirectPlayProfiles: ProfileDto[];
  ResponseProfiles: ProfileDto[];
  ContainerProfiles: ProfileDto[];
  CodecProfiles: ProfileDto[];
  SubtitleProfiles: SubtitleProfileDto[];
}
export interface ProfileDto {
  Type: string;
  Container?: string;
  Protocol?: string;
  AudioCodec?: string;
  VideoCodec?: string;
  MaxAudioChannels?: string;
}
export interface SubtitleProfileDto {
  Format: string;
  Method: string;
}

// ItemDto.kt
export interface ItemListDto {
  Items: ItemDto[];
  TotalRecordCount: number;
}

export interface ItemDto {
  // Common
  Name: string;
  Type: string; // ItemType, read with itemTypeFromString
  Id: string;
  LocationType: string;
  ImageTags: { Primary?: string | null };

  // Libraries
  CollectionType?: string | null;

  // Anime
  SeriesId?: string | null;
  SeriesName?: string | null;
  SeasonName?: string | null;
  SeriesPrimaryImageTag?: string | null;
  BackdropImageTags?: string[] | null;
  ParentBackdropItemId?: string | null;
  ParentBackdropImageTags?: string[] | null;

  // Anime Details
  Status?: string | null;
  Overview?: string | null;
  Genres?: string[] | null;
  Studios?: { Name: string }[] | null;

  // Episode
  OriginalTitle?: string | null;
  SortName?: string | null;
  IndexNumber?: number | null;
  PremiereDate?: string | null;
  RunTimeTicks?: number | null;
  DateCreated?: string | null;
  MediaSources?: MediaDto[] | null;
}

export interface SessionDto {
  MediaSources: MediaDto[];
  PlaySessionId: string;
}

export interface MediaDto {
  Size?: number | null;
  Id?: string | null;
  Bitrate?: number | null;
  TranscodingUrl?: string | null;
  TranscodingContainer?: string | null;
  IsRemote?: boolean;
  Path?: string | null;
  Name?: string | null;
  SupportsTranscoding: boolean;
  SupportsDirectStream: boolean;
  MediaStreams: MediaStreamDto[];
}

export interface MediaStreamDto {
  Codec?: string | null;
  Index: number;
  Type: string;
  SupportsExternalStream: boolean;
  IsExternal: boolean;
  Language?: string | null;
  DisplayTitle?: string | null;
  BitRate?: number | null;
}

const BOLD_REGEX = /<(b|strong)>(.*?)<\/\1>/gi;
const ITALICS_REGEX = /<(i|em)>(.*?)<\/\1>/gi;
const BREAK_REGEX = /<br\s*\/?>/gi;
const HORIZONTAL_RULE_REGEX = /<hr\s*\/?>/gi;
const TAG_REGEX = /<[^>]*>/gi;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Jsoup's Parser.unescapeEntities, for the entities an overview carries */
const unescapeEntities = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

function convertHtml(html: string): string {
  let markdown = html;
  markdown = markdown.replace(BOLD_REGEX, "**$2**");
  markdown = markdown.replace(ITALICS_REGEX, "*$2*");
  markdown = markdown.replace(BREAK_REGEX, "\n");
  markdown = markdown.replace(HORIZONTAL_RULE_REGEX, "\n---\n");
  markdown = markdown.replace(TAG_REGEX, " ");
  return unescapeEntities(markdown);
}

function parseStatus(s: string | null | undefined): number {
  switch (s?.toLowerCase()) {
    case "ended":
      return SAnime.COMPLETED;
    case "continuing":
      return SAnime.ONGOING;
    default:
      return SAnime.UNKNOWN;
  }
}

/** keiyoushi.utils.formatBytes */
export function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} KB`;
  if (n > 1) return `${n} bytes`;
  if (n === 1) return `${n} byte`;
  return "";
}

/** The item's API URL, users path and type fragment included: what upstream keeps in SAnime.url. */
export function itemUrl(baseUrl: string, userId: string, id: string, fragment?: string): string {
  return `${baseUrl}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}${fragment != null ? `#${fragment}` : ""}`;
}

// =============================== Anime ================================

export function toSAnime(item: ItemDto, baseUrl: string, userId: string, concatenateNames: boolean): SAnime {
  const type = itemTypeFromString(item.Type);
  const typeMap: Partial<Record<ItemType, string>> = {
    Season: `season,${item.SeriesId ?? null}`,
    Movie: "movie",
    BoxSet: "boxSet",
    Series: "series",
    // Not using ItemType.Episode (episode) here
  };
  const anime = SAnime.create();
  anime.url = itemUrl(baseUrl, userId, item.Id, typeMap[type]);
  anime.thumbnail_url = item.ImageTags.Primary != null ? getImageUrl(item.ImageTags.Primary, baseUrl, item.Id) : undefined;
  anime.title = item.Name;
  anime.description = item.Overview != null ? convertHtml(item.Overview) : undefined;
  anime.genre = item.Genres?.join(", ");
  anime.author = item.Studios?.map((it) => it.Name).join(", ");

  anime.status = type === "Movie" ? SAnime.COMPLETED : parseStatus(item.Status);

  if (type === "Season") {
    if (item.LocationType === "Virtual") {
      anime.title = item.SeriesName ?? "Season";
      if (item.SeriesId != null) anime.thumbnail_url = item.SeriesPrimaryImageTag != null ? getImageUrl(item.SeriesPrimaryImageTag, baseUrl, item.SeriesId) : undefined;
    } else {
      anime.title = (concatenateNames && item.SeriesName?.trim() ? `${item.SeriesName} ` : "") + item.Name;
    }

    // Use series image as fallback
    if (item.ImageTags.Primary == null && item.SeriesId != null) {
      anime.thumbnail_url = item.SeriesPrimaryImageTag != null ? getImageUrl(item.SeriesPrimaryImageTag, baseUrl, item.SeriesId) : undefined;
    }
  }
  return anime;
}

// ============================== Episode ===============================

function formatSeconds(s: number): string {
  const minutes = Math.trunc(s / 60);
  const hours = Math.trunc(minutes / 60);
  const remainingSeconds = s % 60;
  const remainingMinutes = minutes % 60;
  const formattedHours = hours > 0 ? `${hours}h ` : "";
  const formattedMinutes = remainingMinutes > 0 ? `${remainingMinutes}m ` : "";
  return `${formattedHours}${formattedMinutes}${remainingSeconds}s`.trim();
}

export function toSEpisode(item: ItemDto, baseUrl: string, userId: string, epDetails: string[], episodeTemplate: string): SEpisode {
  const type = itemTypeFromString(item.Type);
  const episode = SEpisode.create();
  const runtimeInSec = item.RunTimeTicks != null ? Math.trunc(item.RunTimeTicks / 10_000_000) : null;
  const sizeBytes = item.MediaSources?.[0]?.Size;
  const size = sizeBytes != null ? formatBytes(sizeBytes) : null;
  const runTime = runtimeInSec != null ? formatSeconds(runtimeInSec) : null;
  const title = type === "Movie" ? "" : item.Name;

  const values: Record<string, string | number> = {
    title,
    originalTitle: item.OriginalTitle ?? "",
    sortTitle: item.SortName ?? "",
    type,
    typeShort: type.replace("Episode", "Ep."),
    seriesTitle: item.SeriesName ?? "",
    seasonTitle: item.SeasonName ?? "",
    number: item.IndexNumber ?? 1,
    createdDate: item.DateCreated?.split("T")[0] ?? "",
    releaseDate: item.PremiereDate?.split("T")[0] ?? "",
    size: size ?? "",
    sizeBytes: sizeBytes ?? 0,
    runtime: runTime ?? "",
    runtimeS: runtimeInSec ?? 0,
  };
  const extraInfo: string[] = [];
  if (epDetails.includes("Overview") && item.Overview != null && type === "Episode") extraInfo.push(item.Overview);
  if (epDetails.includes("Size") && size != null) extraInfo.push(size);
  if (epDetails.includes("Runtime") && runTime != null) extraInfo.push(runTime);

  let name = format(values, episodeTemplate).trim();
  if (name.endsWith("-")) name = name.slice(0, -1);
  if (name.startsWith("-")) name = name.slice(1);
  episode.name = name.trim();
  episode.url = itemUrl(baseUrl, userId, item.Id);
  episode.scanlator = extraInfo.join(" • ");
  if (item.PremiereDate != null) episode.date_upload = tryParseInstant(item.PremiereDate.endsWith("Z") ? item.PremiereDate : `${item.PremiereDate}Z`);
  if (type === "Movie") episode.episode_number = 1;
  return episode;
}
