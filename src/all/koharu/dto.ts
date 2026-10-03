// Port of keiyoushi/extensions-source src/all/koharu/KoharuDto.kt
import { SManga } from "../../../sdk/index.ts";
import { Artist, Circle, Female, Genre, Male, Mixed, Other, Parody, Tag as FilterTag } from "./filters.ts";

export interface Tag {
  name: string;
  namespace?: number; // = 0
}

export interface Filter {
  id: number;
  name: string;
  namespace?: number; // = 0
}

export function toTag(f: Filter): FilterTag {
  const { id, name } = f;
  const namespace = f.namespace ?? 0;
  switch (namespace) {
    case 0:
      return new Genre(id, name);
    case 1:
      return new Artist(id, name);
    case 2:
      return new Circle(id, name);
    case 3:
      return new Parody(id, name);
    case 8:
      return new Male(id, name);
    case 9:
      return new Female(id, name);
    case 10:
      return new Mixed(id, name);
    case 12:
      return new Other(id, name);
    default:
      return new FilterTag(id, name, namespace);
  }
}

export interface Books {
  entries?: Entry[];
  total?: number;
  limit?: number;
  page: number;
}

export interface Entry {
  id: number;
  key: string;
  title: string;
  thumbnail: Thumbnail;
}

export interface MangaDetail {
  id: number;
  title: string;
  key: string;
  created_at?: number; // = 0L
  updated_at?: number | null;
  thumbnails: Thumbnails;
  tags?: Tag[];
}

/** Koharu.dateReformat: SimpleDateFormat("EEEE, d MMM yyyy HH:mm (z)", Locale.ENGLISH) in the device time zone. */
function dateReformat(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
      .formatToParts(new Date(ms))
      .map((it) => [it.type, it.value]),
  );
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} (${p.timeZoneName})`;
}

const capitalizeEach = (s: string) =>
  s
    .split(" ")
    .map((w) => (w.length && w[0] !== w[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

export function toSManga(detail: MangaDetail): SManga {
  const manga = SManga.create();
  const artists: string[] = [];
  const circles: string[] = [];
  const parodies: string[] = [];
  const magazines: string[] = [];
  const characters: string[] = [];
  const cosplayers: string[] = [];
  const females: string[] = [];
  const males: string[] = [];
  const mixed: string[] = [];
  const language: string[] = [];
  const other: string[] = [];
  const uploaders: string[] = [];
  const tags: string[] = [];
  for (const tag of detail.tags ?? []) {
    switch (tag.namespace ?? 0) {
      case 1: artists.push(tag.name); break;
      case 2: circles.push(tag.name); break;
      case 3: parodies.push(tag.name); break;
      case 4: magazines.push(tag.name); break;
      case 5: characters.push(tag.name); break;
      case 6: cosplayers.push(tag.name); break;
      case 7: if (tag.name !== "anonymous") uploaders.push(tag.name); break;
      case 8: males.push(tag.name + " ♂"); break;
      case 9: females.push(tag.name + " ♀"); break;
      case 10: mixed.push(tag.name); break;
      case 11: language.push(tag.name); break;
      case 12: other.push(tag.name); break;
      default: tags.push(tag.name);
    }
  }

  let appended = false;
  const joinAndCapitalizeEach = (list: string[]): string | null => {
    if (list.length === 0) return null;
    appended = true;
    return list.map(capitalizeEach).join(", ");
  };
  const join = (list: string[]) => list.map(capitalizeEach).join(", ");

  manga.thumbnail_url = detail.thumbnails.base + detail.thumbnails.main.path;

  manga.author = join(circles.length ? circles : artists);
  manga.artist = join(artists);
  manga.genre = join([...artists, ...circles, ...parodies, ...magazines, ...characters, ...cosplayers, ...tags, ...females, ...males, ...mixed, ...other]);
  let description = "";
  for (const [label, list] of [
    ["Circles", circles],
    ["Uploaders", uploaders],
    ["Magazines", magazines],
    ["Cosplayers", cosplayers],
    ["Parodies", parodies],
    ["Characters", characters],
  ] as const) {
    const it = joinAndCapitalizeEach(list);
    if (it != null) description += `${label}: ${it}\n`;
  }
  if (appended) description += "\n";
  try {
    description += `Posted: ${dateReformat(detail.created_at ?? 0)}\n`;
  } catch {
    /* empty */
  }
  description += `Pages: ${detail.thumbnails.entries.length}\n\n`;
  manga.description = description;
  manga.status = SManga.COMPLETED;
  // ponytail: update_strategy = ONLY_FETCH_ONCE has no SManga field in the SDK
  manga.initialized = true;
  return manga;
}

export interface MangaData {
  data: Data;
  similar?: Entry[];
}

/** MangaData.size(quality): human-readable size of chapter. */
export function size(data: MangaData, quality: string): string {
  const d = data.data;
  let dataKey: DataKey;
  switch (quality) {
    case "1600": dataKey = d["1600"] ?? d["1280"] ?? d["0"]; break;
    case "1280": dataKey = d["1280"] ?? d["1600"] ?? d["0"]; break;
    case "980": dataKey = d["980"] ?? d["1280"] ?? d["0"]; break;
    case "780": dataKey = d["780"] ?? d["980"] ?? d["0"]; break;
    default: dataKey = d["0"];
  }
  return readableSize(dataKey);
}

export interface Thumbnails {
  base: string;
  main: Thumbnail;
  entries: Thumbnail[];
}

export interface Thumbnail {
  path: string;
}

export interface Data {
  "0": DataKey;
  "780"?: DataKey | null;
  "980"?: DataKey | null;
  "1280"?: DataKey | null;
  "1600"?: DataKey | null;
}

export interface DataKey {
  id?: number | null;
  size?: number; // = 0.0
  key?: string | null;
}

export function readableSize(k: DataKey): string {
  const size = k.size ?? 0;
  if (size >= 300 * 1000 * 1000) return `${(size / (1000 * 1000 * 1000)).toFixed(2)} GB`;
  if (size >= 100 * 1000) return `${(size / (1000 * 1000)).toFixed(2)} MB`;
  if (size >= 1000) return `${(size / 1000).toFixed(2)} kB`;
  return `${size.toFixed(1)} B`;
}

export interface ImagesInfo {
  base: string;
  entries: ImagePath[];
}

export interface ImagePath {
  path: string;
}
