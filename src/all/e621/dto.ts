// Port of keiyoushi/extensions-source src/all/e621/Dto.kt
// kotlinx.serialization defaults are applied where the fields are read (see index.ts).

export interface Pool {
  id: number;
  name: string;
  description?: string;
  post_ids?: number[];
  is_active?: boolean | null;
  updated_at?: string;
}

export interface PostsResponse {
  posts?: Post[];
}

export interface Post {
  id: number;
  flags?: Flags;
  preview?: ImageData;
  sample?: ImageData;
  file?: ImageData;
  tags?: Tags;
  pools?: number[];
  created_at?: string;
  rating?: string;
  score?: Score;
}

export interface Score {
  total?: number;
}

export interface Flags {
  deleted?: boolean;
}

export interface ImageData {
  url?: string | null;
  has?: boolean;
  width?: number;
  height?: number;
}

export interface Tags {
  general?: string[];
  artist?: string[];
  copyright?: string[];
  character?: string[];
  species?: string[];
  lore?: string[];
  meta?: string[];
}

export const allTags = (t: Tags = {}): string[] => [
  ...(t.artist ?? []),
  ...(t.character ?? []),
  ...(t.copyright ?? []),
  ...(t.general ?? []),
  ...(t.lore ?? []),
  ...(t.meta ?? []),
  ...(t.species ?? []),
];

export interface UserMeResponse {
  blacklisted_tags?: string | null;
  user?: UserMeData | null;
}

export interface UserMeData {
  blacklisted_tags?: string | null;
}

export const blacklistedTags = (r: UserMeResponse): string | null => r.blacklisted_tags ?? r.user?.blacklisted_tags ?? null;
