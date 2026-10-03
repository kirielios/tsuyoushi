// Port of keiyoushi/extensions-source lib-multisrc/mangataro/Dto.kt

/** SearchPayload: the list fields go out as JSON strings ("[1,2]"), as StringifiedListSerializer does. */
export interface SearchPayload {
  page: number;
  search: string;
  years: number[];
  genres: number[];
  types: string[];
  statuses: string[];
  sort: string;
  genreMatchMode: string;
}
export const searchPayloadJson = (p: SearchPayload) =>
  JSON.stringify({
    page: p.page,
    search: p.search,
    years: JSON.stringify(p.years),
    genres: JSON.stringify(p.genres),
    types: JSON.stringify(p.types),
    statuses: JSON.stringify(p.statuses),
    sort: p.sort,
    genreMatchMode: p.genreMatchMode,
  });

export interface SearchQueryPayload {
  limit: number;
  query: string;
}

export interface SearchQueryResponse {
  results: SearchQueryManga[];
}
export interface SearchQueryManga {
  id: number;
  slug: string;
  title: string;
  thumbnail: string;
  type: string;
  description: string;
  status: string;
}

export interface BrowseManga {
  id: string;
  url: string;
  title: string;
  cover: string;
  type: string;
  description: string;
  status: string;
}

export interface MangaUrl {
  id: string;
  slug: string;
  group?: number | null;
}
/** MangaUrl(...).toJsonString(): a null group is left out. */
export const mangaUrlJson = (id: string, slug: string, group: number | null = null) => JSON.stringify(group == null ? { id, slug } : { id, slug, group });

export interface MangaDetails {
  id: number;
  slug: string;
  title: Rendered;
  content: Rendered;
  type: string;
  _embedded: Embedded;
}

export interface Embedded {
  "wp:featuredmedia": Thumbnail[];
  "wp:term": Term[][];
}
export const getTerms = (embedded: Embedded, type: string): string[] => (embedded["wp:term"].find((it) => it[0]?.taxonomy === type) ?? []).map((it) => it.name);

export interface Term {
  name: string;
  taxonomy: string;
}

export interface Thumbnail {
  source_url: string;
}

export interface Rendered {
  rendered: string;
}

export interface ChapterList {
  chapters: Chapter[];
  has_more?: boolean;
}

export interface Chapter {
  url: string;
  chapter: string;
  title?: string | null;
  date: string;
  group_name?: string | null;
  language: string;
}

export interface Pages {
  images: string[];
}
