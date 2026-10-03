// Port of keiyoushi/extensions-source src/en/manhwazone/Dto.kt
export interface LivewireRequestDto {
  _token: string;
  components: LivewireRequestComponentDto[];
}

export interface LivewireRequestComponentDto {
  snapshot: string;
  updates: Record<string, unknown>;
  calls: LivewireCallDto[];
}

export interface LivewireCallDto {
  path: string;
  method: string;
  params: string[];
}

export interface LivewireUpdateDto {
  components?: LivewireComponentDto[];
}

export interface LivewireComponentDto {
  snapshot?: string | null;
}

export interface SnapshotDto {
  data?: SnapshotDataDto | null;
}

export interface SnapshotDataDto {
  chapters?: unknown[] | null;
}

export interface ChapterDto {
  name?: string | null;
  published?: string | null;
  web_url?: string | null;
}
