// Port of keiyoushi/extensions-source src/en/dynasty/Constants.kt
import { DateTimeFormatter, Locale, ZoneId } from "../../../sdk/index.ts";

export const SERIES_TYPE = "Series";
export const CHAPTER_TYPE = "Chapter";
export const ANTHOLOGY_TYPE = "Anthology";
export const DOUJIN_TYPE = "Doujin";
export const ISSUE_TYPE = "Issue";

export const SERIES_DIR = "series";
export const CHAPTERS_DIR = "chapters";
export const ANTHOLOGIES_DIR = "anthologies";
export const DOUJINS_DIR = "doujins";
export const ISSUES_DIR = "issues";

export const MANGA_TYPES = new Set([SERIES_TYPE, ANTHOLOGY_TYPE, DOUJIN_TYPE, ISSUE_TYPE]);

export const MANGA_DIRS = [SERIES_DIR, ANTHOLOGIES_DIR, DOUJINS_DIR, ISSUES_DIR, CHAPTERS_DIR];

export const COVER_FETCH_HOST = "keiyoushi-chapter-cover";
export const COVER_URL_FRAGMENT = "thumbnail";

export const COVER_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "jfif", "gif", "JPG", "JPEG", "PNG", "WEBP", "JFIF", "GIF"];

export const CHAPTER_SLUG_REGEX = /(.*?)_(ch[0-9_]+|volume_[0-9_\w]+)/;

export const UNICODE_REGEX = /\\u([0-9A-Fa-f]{4})/g;

export const AUTHORS_UPPER_LIMIT = 15;

export const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT).withZone(ZoneId.of("UTC"));

export const CHAPTER_FETCH_LIMIT_PREF = "chapterFetchLimit";
export const CHAPTER_FETCH_LIMITS = ["2", "5", "10", "all"];

// sort filters
export const SMART_SORT = "_smart_";
export const BEST_MATCH = "";
export const RELEASED_ON = "released_on";
