// Port of keiyoushi/extensions-source src/all/lunaranime/LunarAnimeDto.kt
import { Base64, DateTimeFormatter, Locale, SChapter, SManga, ZoneOffset, parseAs } from "../../../sdk/index.ts";

export interface LunarSearchResponse {
  manga?: LunarMangaDto[];
  page?: number;
  total_pages?: number;
}

export interface LunarMangaResponse {
  manga: LunarMangaDto;
}

export interface LunarMangaDto {
  slug: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  genres?: string | null;
  publication_status?: string | null;
  author?: string | null;
  artist?: string | null;
  alternative_titles?: string | null;
  demographic?: string | null;
  themes?: string | null;
}

export function mangaToSManga(dto: LunarMangaDto): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.thumbnail_url = dto.cover_url ?? undefined;
  manga.url = `/manga/${dto.slug}`;
  manga.author = dto.author?.trim();
  manga.artist = dto.artist?.trim();

  let description = dto.description ?? "";
  if (dto.alternative_titles != null) {
    try {
      const titles = parseAs<string[]>(dto.alternative_titles);
      if (titles.length) {
        if (description) description += "\n\n";
        description += "Alternative Titles: " + titles.join(", ");
      }
    } catch {
      /* ignored */
    }
  }
  manga.description = description;

  switch (dto.publication_status?.toLowerCase()) {
    case "ongoing":
    case "upcoming":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    case "cancelled":
      manga.status = SManga.CANCELLED;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }

  const genres: string[] = [];
  const d = dto.demographic;
  if (d?.trim()) genres.push(d.charAt(0).toUpperCase() + d.slice(1));
  if (dto.genres != null) {
    try {
      genres.push(...parseAs<string[]>(dto.genres));
    } catch {
      genres.push(dto.genres);
    }
  }
  if (dto.themes != null) {
    try {
      genres.push(...parseAs<string[]>(dto.themes));
    } catch {
      /* ignored */
    }
  }
  manga.genre = [...new Set(genres.filter((it) => it.trim()))].join(", ");
  return manga;
}

export interface LunarChapterListResponse {
  data?: LunarChapterDto[];
}

export interface LunarChapterDto {
  chapter: string;
  chapter_number: number;
  chapter_subnumber?: number | null;
  chapter_title?: string | null;
  language: string;
  uploaded_at?: string | null;
}

const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.US).withZone(ZoneOffset.UTC);

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

export function chapterToSChapter(dto: LunarChapterDto, mangaSlug: string, isLocked: boolean): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/manga/${mangaSlug}/${dto.chapter}?lang=${dto.language}`;
  const prefix = isLocked ? "🔒 " : "";
  const chapterName = removeSuffix(removeSuffix(dto.chapter, ".00"), ".0");
  const chapterNum = `Chapter ${chapterName}`;
  const title = dto.chapter_title;
  let name: string;
  if (!title?.trim()) name = chapterNum;
  else {
    const t = title.toLowerCase();
    if (t.includes(chapterNum.toLowerCase()) || t.includes(`ch.${chapterName}`.toLowerCase()) || t.includes("volume") || t.includes("vol.")) name = title;
    else name = `${chapterNum}: ${title}`;
  }
  chapter.name = prefix + name;
  const n = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(dto.chapter) ? Number(dto.chapter) : NaN;
  chapter.chapter_number = Number.isNaN(n) ? dto.chapter_number : n;
  chapter.date_upload = dto.uploaded_at != null ? DATE_FORMAT.tryParseDateTime(dto.uploaded_at) : 0;
  chapter.scanlator = dto.language.toUpperCase();
  return chapter;
}

/** The two seed strings every chapter token and session key is derived from. */
export class LunarSeeds {
  constructor(
    readonly axis: string,
    readonly pitch: string,
  ) {}
}

const HEADER_SIZE = 7;
const HEADER_FIELDS = 6;
const HEADER_VERSION = "3";
const MAX_OPCODE = 7;
const MAGIC_0 = 167;
const MAGIC_1 = 62;
const MAGIC_2 = 145;

/** Kotlin's String.toIntOrNull(16): null on anything that is not a whole hex number. */
const hexInt = (s: string): number | null => (/^[+-]?[0-9a-fA-F]+$/.test(s) ? parseInt(s, 16) : null);

class SeedHeader {
  constructor(
    private readonly seed: number,
    private readonly multiplier: number,
    private readonly increment: number,
    private readonly program: [number, number][],
    private readonly names: string[],
  ) {}

  /**
   * The named props concatenate into one hex string, each byte chained to the previous one and to an LCG keyed by
   * the header, then run backwards through the program.
   */
  decode(props: Record<string, string>): number[] | null {
    const hex = this.names.map((it) => props[it] ?? "").join("");
    if (hex.length < 2 || hex.length % 2 !== 0) return null;

    const out: number[] = [];
    let state = this.seed & 0xff;
    let previous = 0;
    for (let i = 0; i < hex.length; i += 2) {
      const current = hexInt(hex.substring(i, i + 2));
      if (current == null) return null;
      state = (Math.imul(state, this.multiplier) + this.increment) & 0xff;
      out.push(this.unprogram(current ^ previous, i / 2, state));
      previous = current;
    }
    return out;
  }

  private unprogram(value: number, index: number, state: number): number {
    let n = value & 0xff;
    for (const [op, arg] of [...this.program].reverse()) {
      switch (op) {
        case 0:
          n = n ^ arg;
          break;
        case 1:
          n = n - arg;
          break;
        case 2: {
          const shift = arg & 7 || 1;
          n = ((n & 0xff) >>> shift) | (n << (8 - shift));
          break;
        }
        case 3:
          n = ((n & 15) << 4) | ((n & 0xff) >>> 4);
          break;
        case 4:
          n = n ^ state;
          break;
        case 5:
          n = n ^ ((Math.imul(index, 1 | arg) + arg) & 0xff);
          break;
        case 6:
          n = ~n;
          break;
        default:
          n = arg - n;
      }
      n &= 0xff;
    }
    return n;
  }
}

/**
 * The seeds are not a field of their own: they arrive as the props of a reader component, under names randomised per
 * response. One prop holds a masked, reversed-base64 header that names the props carrying the payload; the payload
 * bytes are then chained through a small byte program described by that same header.
 *
 * Several decoy prop sets are rendered alongside the real one, so toSeeds is also what identifies it - a decoy either
 * fails to produce a header or misses the magic prefix.
 */
export class LunarSeedPropsDto {
  constructor(private readonly props: Record<string, string>) {}

  toSeeds(): LunarSeeds | null {
    for (const [name, value] of Object.entries(this.props)) {
      const header = this.parseHeader(name, value);
      if (header == null) continue;
      const bytes = header.decode(this.props);
      if (bytes == null) continue;

      if (bytes.length < HEADER_SIZE) continue;
      if (bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1 || bytes[2] !== MAGIC_2) return null;

      const axisLength = (bytes[3] << 8) | bytes[4];
      const pitchLength = (bytes[5] << 8) | bytes[6];
      if (axisLength <= 0 || pitchLength <= 0 || HEADER_SIZE + axisLength + pitchLength > bytes.length) return null;

      return new LunarSeeds(toLatin1(bytes, HEADER_SIZE, axisLength), toLatin1(bytes, HEADER_SIZE + axisLength, pitchLength));
    }
    return null;
  }

  /** The header prop is masked with a rolling key derived from its own name. */
  private parseHeader(name: string, value: string): SeedHeader | null {
    let decoded: Uint8Array;
    try {
      decoded = Base64.decode([...value].reverse().join(""));
    } catch {
      return null;
    }

    let nameHash = 0;
    for (let i = 0; i < name.length; i++) nameHash = (Math.imul(31, nameHash) + name.charCodeAt(i)) & 0xff;

    let unmasked = "";
    for (let i = 0; i < decoded.length; i++) unmasked += String.fromCharCode(decoded[i] ^ ((nameHash + 37 * i) & 0xff));

    const parts = unmasked.split("|");
    if (parts.length !== HEADER_FIELDS || parts[0] !== HEADER_VERSION) return null;

    const seed = hexInt(parts[1]);
    const multiplier = hexInt(parts[2]);
    const increment = hexInt(parts[3]);
    if (seed == null || multiplier == null || increment == null) return null;

    const programText = parts[4];
    if (!programText.length || programText.length % 3 !== 0) return null;

    const program: [number, number][] = [];
    for (let i = 0; i < programText.length; i += 3) {
      const op = hexInt(programText.substring(i, i + 1));
      const arg = hexInt(programText.substring(i + 1, i + 3));
      if (op == null || arg == null) return null;
      if (op > MAX_OPCODE) return null;
      program.push([op, arg]);
    }

    const names = parts[5].split(".").filter((it) => it.length);
    if (!names.length) return null;

    return new SeedHeader(seed, multiplier, increment, program, names);
  }

  /** Matches the flight element holding the seeds. Decoys share the shape, so the payload has to be decoded to tell them apart. */
  static matches(element: unknown): boolean {
    if (element == null || typeof element !== "object" || Array.isArray(element)) return false;
    const values = Object.values(element);
    return values.length > 0 && values.every((it) => typeof it === "string") && new LunarSeedPropsDto(element as Record<string, string>).toSeeds() != null;
  }
}

const toLatin1 = (bytes: number[], offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));

export interface LunarPageListData {
  images?: string[];
  session_data?: string | null;
}

export interface LunarPageListResponse {
  data?: LunarPageListData | null;
}

export interface LunarPageListDecrypted {
  data: LunarPageListData;
}

export interface LunarRecentResponse {
  our_mangas?: LunarMangaDto[];
  page?: number;
  limit?: number;
  total_count?: number;
}

export interface LunarPasswordInfoResponse {
  chapter_passwords?: LunarChapterPasswordDto[];
  has_series_password?: boolean;
}

export interface LunarChapterPasswordDto {
  chapter_number?: string | null;
  language?: string | null;
}
