// Port of keiyoushi/extensions-source src/all/manta/MantaDto.kt
import { DateTimeFormatter, Locale, SManga, substringBefore } from "../../../sdk/index.ts";

const isoDate = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);

const timestamp = (s: string | null | undefined): number => isoDate.tryParseDateTime(s == null ? null : substringBefore(substringBefore(substringBefore(s, "."), "+"), "Z"));

export interface MantaResponse<T> {
  data: T;
  status?: Status | null;
}

export interface Series<T> {
  data: T;
  id: number;
  image: Cover;
  episodes?: Episode[] | null;
}

export function seriesToSManga(series: Series<Title>, lang: string): SManga {
  const manga = SManga.create();
  manga.title = nameAsString(series.data.title, lang);
  manga.url = String(series.id);
  manga.thumbnail_url = coverToString(series.image);
  return manga;
}

export interface RelatedSeries {
  data: RelatedData;
}
export interface RelatedData {
  relatedSeriesList?: Series<Title>[];
}

export interface Title {
  title: Name;
}

export interface Details {
  tags: Tag[];
  isCompleted?: boolean | null;
  description: Description;
  creators: Creator[];
}
export const detailsArtists = (d: Details) => d.creators.filter((it) => it.role === "Illustration");
export const detailsAuthors = (d: Details) => {
  const authors = d.creators.filter((it) => it.role !== "Illustration");
  return authors.length > 0 ? authors : d.creators;
};

export interface Episode {
  id: number;
  ord: number;
  data?: EpisodeData | null;
  lockData?: LockData | null;
  openAt?: string | null;
  createdAt?: string | null;
  cutImages?: Image[] | null;
}

export function episodeTimestamp(e: Episode): number {
  return timestamp(e.openAt) || timestamp(e.createdAt);
}

export function episodeAsString(e: Episode, lang: string): string {
  let s = "";
  const episodeTitle = e.data?.title;
  if (episodeTitle != null) {
    s += episodeTitle;
  } else {
    s += lang === "es" ? "Episodio" : "Episode";
    s += ` ${e.ord}`;
  }
  if (isLocked(e.lockData)) s += " 🔒";
  return s;
}

export interface EpisodeData {
  title?: string | null;
}

export interface LockData {
  state?: number | null;
}
export const isLocked = (l: LockData | null | undefined): boolean => l?.state != null && ![110, 130].includes(l.state);

export interface Creator {
  name: string;
  role: string;
}

export interface Description {
  long: string;
  short?: string | null;
}
export const descriptionAsString = (d: Description): string => [d.short, d.long].filter((it): it is string => it != null).join("\n\n");

export interface Cover {
  "1280x1840_480"?: Image | null;
  "1280x1840_720"?: Image | null;
  "1440x3072"?: Image | null;
  "1440x1440_480"?: Image | null;
}
export const coverToString = (c: Cover): string => (c["1280x1840_480"] ?? c["1280x1840_720"] ?? c["1440x3072"] ?? c["1440x1440_480"])?.downloadUrl ?? "";

export interface Image {
  downloadUrl: string;
}

export interface Tag {
  name: Name;
}

export interface Name {
  en?: string | null;
  es?: string | null;
}
export const nameAsString = (n: Name, lang: string): string => (lang === "es" ? (n.es ?? n.en ?? "") : (n.en ?? n.es ?? ""));

export interface Status {
  description: string;
  message: string;
}

export interface Token {
  token: string;
}
