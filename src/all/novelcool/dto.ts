// Port of keiyoushi/extensions-source src/all/novelcool/Dto.kt
import { SManga } from "../../../sdk/index.ts";

/** Property names are the serial names (keyword, lc_type, page_size); a null keyword is left out (explicitNulls = false). */
export interface NovelCoolBrowsePayload {
  appId: string;
  keyword?: string | null;
  lang: string;
  lc_type: string;
  page: string;
  page_size: string;
  secret: string;
}

export interface NovelCoolBrowseResponse {
  list?: Manga[] | null;
}

export interface Manga {
  url: string;
  name: string;
  cover: string;
}

export function toSManga(manga: Manga): SManga {
  const result = SManga.create();
  result.title = manga.name;
  result.thumbnail_url = manga.cover;
  return result;
}
