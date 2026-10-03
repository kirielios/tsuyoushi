// Port of keiyoushi/extensions-source src/all/lanraragi/LANmodels.kt

export interface Archive {
  arcid: string;
  title: string;
  tags: string | null;
  summary: string | null;
  isnew: boolean;
  pagecount: number;
  toc: ArchiveTOCEntry[] | null;
}

export interface ArchiveTOCEntry {
  name: string;
  page: number;
}

export interface ArchivePage {
  pages: string[];
}

export interface ArchiveSearchResult {
  data: Archive[];
  recordsFiltered: number | null;
  recordsTotal: number;
}

export interface Category {
  id: string;
  name: string | null;
  pinned: number | null;
}

export interface Tankoubon {
  result: TankoubonMetadataJson | null;
  total: number | null;
  filtered: number | null;
}

export interface TankoubonMetadataJson {
  id: string;
  name: string | null;
  summary: string | null;
  tags: string | null;
  archives: string[] | null;
  full_data: Archive[] | null;
}
