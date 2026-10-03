// Port of keiyoushi/extensions-source src/all/hentailoop/Dto.kt

export interface SourceFilters {
  artists: SourceFilter[];
  characters: SourceFilter[];
  circles: SourceFilter[];
  conventions: SourceFilter[];
  genres: SourceFilter[];
  languages: SourceFilter[];
  parodies: SourceFilter[];
  releases: SourceFilter[];
  tags: SourceFilter[];
}

export interface SourceFilter {
  id: number;
  name: string;
  slug: string;
}

export interface SearchRequest {
  query: string;
  filters: FilterValue[];
  specialFilters: SpecialFilter[];
  sorting: string;
}

export interface FilterValue {
  name: string;
  filterValues: string[];
  operator: string;
}

/** @JsonClassDiscriminator("name"): the @SerialName is the "name" property, written first. */
export type SpecialFilter =
  | { name: "yearFilter"; yearOperator: string; yearValue: string }
  | { name: "pagesFilter"; values: { min: number; max: number } }
  | { name: "checkboxFilter"; values: { purpose: string; checked: boolean } };

export interface Data<T> {
  success: boolean;
  data: T;
}

export interface AdvancedSearchResponse {
  more?: boolean; // = false
  posts?: string[]; // = emptyList()
  message?: string | null;
}

export interface QuerySearchResponse {
  posts: { id: number; title: string; thumb: string; link: string }[];
}

export interface SchemaGraph {
  "@graph": GraphItem[];
}
export interface GraphItem {
  datePublished?: string | null;
}
