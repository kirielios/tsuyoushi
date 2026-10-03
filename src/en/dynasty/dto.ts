// Port of keiyoushi/extensions-source src/en/dynasty/Dto.kt
import { SManga } from "../../../sdk/index.ts";
import { ANTHOLOGIES_DIR, ANTHOLOGY_TYPE, DOUJINS_DIR, DOUJIN_TYPE, ISSUES_DIR, ISSUE_TYPE, SERIES_DIR, SERIES_TYPE } from "./constants.ts";

export interface BrowseResponse {
  chapters: BrowseChapter[];
  current_page: number;
  total_pages: number;
}
export const hasNextPage = (r: BrowseResponse) => r.current_page <= r.total_pages;

export interface BrowseChapter {
  title: string;
  permalink: string;
  tags: BrowseTag[];
}

export interface BrowseTag {
  type: string;
  name: string;
  permalink: string;
}

/** BrowseTag / MangaResponse / AuthorTaggable.directory */
export function directoryOf(type: string): string {
  switch (type) {
    case SERIES_TYPE:
      return SERIES_DIR;
    case ANTHOLOGY_TYPE:
      return ANTHOLOGIES_DIR;
    case DOUJIN_TYPE:
      return DOUJINS_DIR;
    case ISSUE_TYPE:
      return ISSUES_DIR;
    default:
      throw new Error(`Unsupported Type for directory: ${type}`);
  }
}

export interface TagSuggest {
  id: number;
  name: string;
  type: string;
}

/** Equality is by url (the LinkedHashSets below dedupe on it). */
export class MangaEntry {
  constructor(
    private readonly title: string,
    readonly url: string,
    private readonly cover: string | null,
  ) {}
  toSManga(): SManga {
    const manga = SManga.create();
    manga.url = this.url;
    manga.title = this.title;
    manga.thumbnail_url = this.cover ?? undefined;
    return manga;
  }
}

/** LinkedHashSet<MangaEntry>: first entry per url wins, insertion order kept. */
export class MangaEntrySet {
  private readonly map = new Map<string, MangaEntry>();
  add(entry: MangaEntry) {
    if (!this.map.has(entry.url)) this.map.set(entry.url, entry);
  }
  toList(): MangaEntry[] {
    return [...this.map.values()];
  }
}

export interface MangaResponse {
  name: string;
  type: string;
  permalink: string;
  tags: BrowseTag[];
  cover: string | null;
  description: string | null;
  aliases: string[];
  /** ChapterItemListSerializer: an object with "header" is a MangaChapterHeader, anything else a MangaChapter. */
  taggings: ChapterItem[];
  total_pages?: number;
}

export type ChapterItem = MangaChapterHeader | MangaChapter;

export interface MangaChapterHeader {
  header: string | null;
}

export interface MangaChapter {
  title: string;
  permalink: string;
  released_on: string;
  tags: BrowseTag[];
}

export const isHeader = (item: ChapterItem): item is MangaChapterHeader => "header" in item;

export interface ChapterResponse {
  title: string;
  permalink: string;
  tags: BrowseTag[];
  pages: ChapterPage[];
  released_on: string;
}

export interface ChapterPage {
  url: string;
}

export interface AuthorResponse {
  taggables: AuthorTaggable[];
  taggings: BrowseChapter[];
}

export interface AuthorTaggable {
  type: string;
  name: string;
  permalink: string;
}
