// Port of keiyoushi/extensions-source src/all/hdoujin/Dto.kt
import { SManga, urlWithoutDomain } from "../../../sdk/index.ts";

/** SimpleDateFormat("EEEE, d MMM yyyy HH:mm (z)", Locale.ENGLISH).format(ms), in the system zone. */
function formatPosted(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute} (${parts.timeZoneName})`;
}

export interface MangaDetailTag {
  name: string;
  namespace?: number; // = 0
}
export interface Thumbnail {
  path: string;
}
export interface Thumbnails {
  base: string;
  main: Thumbnail;
  entries: Thumbnail[];
}
export interface MangaDetail {
  id: number;
  key: string;
  title: string;
  title_short: string | null;
  created_at?: number; // = 0L
  updated_at: number | null;
  subtitle: string | null;
  subtitle_short: string | null;
  thumbnails: Thumbnails;
  tags?: MangaDetailTag[]; // = emptyList()
}

/** String.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() } per space-separated word */
const capitalizeEach = (s: string) =>
  s
    .split(" ")
    .map((w) => {
      const first = [...w][0];
      return first !== undefined && first !== first.toUpperCase() ? first.toUpperCase() + w.slice(first.length) : w;
    })
    .join(" ");

export function mangaDetailToSManga(d: MangaDetail): SManga {
  const manga = SManga.create();
  const artists: string[] = [];
  const circles: string[] = [];
  const parodies: string[] = [];
  const characters: string[] = [];
  const females: string[] = [];
  const males: string[] = [];
  const mixed: string[] = [];
  const language: string[] = [];
  const other: string[] = [];
  const uploaders: string[] = [];
  const tags: string[] = [];
  for (const tag of d.tags ?? []) {
    switch (tag.namespace ?? 0) {
      case 1:
        artists.push(tag.name);
        break;
      case 2:
        circles.push(tag.name);
        break;
      case 3:
        parodies.push(tag.name);
        break;
      case 5:
        characters.push(tag.name);
        break;
      case 7:
        if (tag.name !== "anonymous") uploaders.push(tag.name);
        break;
      case 8:
        males.push(`${tag.name} ♂`);
        break;
      case 9:
        females.push(`${tag.name} ♀`);
        break;
      case 10:
        mixed.push(tag.name);
        break;
      case 11:
        language.push(tag.name);
        break;
      case 12:
        other.push(tag.name);
        break;
      default:
        tags.push(tag.name);
    }
  }

  let appended = false;
  const joinAndCapitalizeEach = (list: string[]): string | null => {
    if (list.length === 0) return null;
    appended = true;
    return list.map(capitalizeEach).join(", ");
  };

  manga.thumbnail_url = d.thumbnails.base + d.thumbnails.main.path;

  manga.author = (circles.length ? circles : artists).map(capitalizeEach).join(", ");
  manga.artist = artists.map(capitalizeEach).join(", ");
  manga.genre = [...artists, ...circles, ...parodies, ...characters, ...tags, ...females, ...males, ...mixed, ...other].map(capitalizeEach).join(", ");

  let description = "";
  const circlesText = joinAndCapitalizeEach(circles);
  if (circlesText != null) description += `Circles: ${circlesText}\n`;
  const uploadersText = joinAndCapitalizeEach(uploaders);
  if (uploadersText != null) description += `Uploaders: ${uploadersText}\n`;
  const parodiesText = joinAndCapitalizeEach(parodies);
  if (parodiesText != null) description += `Parodies: ${parodiesText}\n`;
  const charactersText = joinAndCapitalizeEach(characters);
  if (charactersText != null) description += `Characters: ${charactersText}\n`;

  if (appended) description += "\n";

  try {
    description += `Posted: ${formatPosted(d.created_at ?? 0)}\n`;
  } catch {
    // ignored
  }

  description += `Pages: ${d.thumbnails.entries.length}\n\n`;

  if ((d.subtitle ?? "").trim() || (d.subtitle_short ?? "").trim()) {
    const titles = [...new Set([d.subtitle, d.subtitle_short])].filter((it) => (it ?? "").trim());
    description += `Alternative Title(s): ${titles.map((it) => `\n- ${it}`).join(", ")}\n\n`;
  }
  manga.description = description;
  manga.status = SManga.COMPLETED;
  manga.initialized = true;
  return manga;
}

export interface DataKey {
  id?: number | null;
  size?: number; // = 0.0
  key?: string | null;
}
export interface Data {
  "0": DataKey;
  "780"?: DataKey | null;
  "980"?: DataKey | null;
  "1280"?: DataKey | null;
  "1600"?: DataKey | null;
}
export interface MangaData {
  data: Data;
}
export interface Entry {
  id: number;
  key: string;
  title: string;
  subtitle: string | null;
  thumbnail: Thumbnail;
}
export interface Entries {
  entries: Entry[];
  limit: number;
  page: number;
  total: number;
}
export function entryToSManga(e: Entry): SManga {
  const manga = SManga.create();
  manga.url = urlWithoutDomain(`${e.id}/${e.key}`);
  manga.title = e.title;
  manga.thumbnail_url = e.thumbnail.path;
  return manga;
}
export interface ImagePath {
  path: string;
}
export interface ImagesInfo {
  base: string;
  entries: ImagePath[];
}
