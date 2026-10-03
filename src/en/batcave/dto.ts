// Port of keiyoushi/extensions-source src/en/batcave/Dto.kt

export interface XFilters {
  filter_items: XFilterItems;
}

export interface XFilterItems {
  /** @SerialName("p") */
  p: XFilterItem;
  /** @SerialName("g") */
  g: XFilterItem;
}

export interface XFilterItem {
  values?: FilterValue[];
}

export interface FilterValue {
  id: number;
  value: string;
}

export interface Chapters {
  news_id: number;
  chapters?: Chapter[];
  xhash?: string;
}

export interface Chapter {
  id: number;
  /** @SerialName("posi") */
  posi: number;
  title: string;
  date: string;
}

export interface ChapterRequestBody {
  news_id: string;
  chapter_id: string;
}

export interface ChapterApiResponse {
  data: Images;
}

export interface Images {
  images?: string[];
}

export interface RelatedComic {
  name: string;
  url: string;
  thumbnail?: string | null;
}
