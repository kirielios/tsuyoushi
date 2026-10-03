// Port of keiyoushi/extensions-source src/all/mangadex/MDConstants.kt and MangaDexIntl.kt
import type { Intl } from "../../../libs/i18n/index.ts";

// MangaDexIntl.kt
export const MangaDexIntl = {
  BRAZILIAN_PORTUGUESE: "pt-BR",
  CHINESE: "zh",
  ENGLISH: "en",
  JAPANESE: "ja",
  KOREAN: "ko",
  PORTUGUESE: "pt",
  SPANISH_LATAM: "es-419",
  SPANISH: "es",
  RUSSIAN: "ru",
  get AVAILABLE_LANGS() {
    return [this.ENGLISH, this.BRAZILIAN_PORTUGUESE, this.PORTUGUESE, this.SPANISH, this.SPANISH_LATAM, this.RUSSIAN];
  },
  MANGADEX_NAME: "MangaDex",
};

const COVER_QUALITY_PREF = "thumbnailQuality";
const DATA_SAVER_PREF = "dataSaverV5";
const STANDARD_HTTPS_PORT_PREF = "usePort443";
const CONTENT_RATING_PREF = "contentRating";
const ORIGINAL_LANGUAGE_PREF = "originalLanguage";
const GROUP_AZUKI = "5fed0576-8b94-4f9a-b6a7-08eecd69800d";
const GROUP_BILIBILI = "06a9fecb-b608-4f19-b93c-7caab06b7f44";
const GROUP_COMIKEY = "8d8ecf83-8d42-4f8c-add8-60963f9f28d9";
const GROUP_INKR = "caa63201-4a17-4b7f-95ff-ed884a2b7e60";
const GROUP_MANGA_HOT = "319c1b10-cbd0-4f55-a46e-c4ee17e65139";
const GROUP_MANGA_PLUS = "4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb";
const BLOCKED_GROUPS_PREF = "blockedGroups";
const BLOCKED_UPLOADER_PREF = "blockedUploader";
const HAS_SANITIZED_UUIDS_PREF = "hasSanitizedUuids";
const TRY_USING_FIRST_VOLUME_COVER_PREF = "tryUsingFirstVolumeCover";
const ALT_TITLES_IN_DESC_PREF = "altTitlesInDesc";
const PREFER_EXTENSION_LANG_TITLE_PREF = "preferExtensionLangTitle";
const FINAL_CHAPTER_IN_DESC_PREF = "finalChapterInDesc";
const INCLUDE_UNAVAILABLE_PREF = "includeUnavailable";
const TAG_GROUP_CONTENT = "content";
const TAG_GROUP_FORMAT = "format";
const TAG_GROUP_GENRE = "genre";
const TAG_GROUP_THEME = "theme";

const API_URL = "https://api.mangadex.org";

export const MDConstants = {
  uuidRegex: /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,

  MANGA_LIMIT: 20,
  LATEST_CHAPTER_LIMIT: 100,

  CHAPTER: "chapter",
  MANGA: "manga",
  COVER_ART: "cover_art",
  SCANLATION_GROUP: "scanlation_group",
  USER: "user",
  AUTHOR: "author",
  ARTIST: "artist",
  TAG: "tag",
  LIST: "custom_list",
  LEGACY_NO_GROUP_ID: "00e03853-1b96-4f41-9542-c71b8692033b",

  CDN_URL: "https://uploads.mangadex.org",
  API_URL,
  API_MANGA_URL: `${API_URL}/manga`,
  API_CHAPTER_URL: `${API_URL}/chapter`,
  API_LIST_URL: `${API_URL}/list`,
  whitespaceRegex: /\s/g,

  mdAtHomeTokenLifespan: 5 * 60 * 1000,

  /** DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss") of a UTC date-time */
  dateFormatterNoOffset: (utcMillis: number) => new Date(utcMillis).toISOString().slice(0, 19),

  PREFIX_ID_SEARCH: "id:",
  PREFIX_CH_SEARCH: "ch:",
  PREFIX_GRP_SEARCH: "grp:",
  PREFIX_AUTHOR_SEARCH: "author:",
  PREFIX_USER_SEARCH: "usr:",
  PREFIX_LIST_SEARCH: "list:",

  pathToSearchPrefix: {
    manga: "id:",
    title: "id:",
    chapter: "ch:",
    group: "grp:",
    author: "author:",
    user: "usr:",
    list: "list:",
  } as Record<string, string>,

  getCoverQualityPreferenceKey: (dexLang: string) => `${COVER_QUALITY_PREF}_${dexLang}`,
  getCoverQualityPreferenceEntries: (intl: Intl) => [intl.get("cover_quality_original"), intl.get("cover_quality_medium"), intl.get("cover_quality_low")],
  getCoverQualityPreferenceEntryValues: () => ["", ".512.jpg", ".256.jpg"],
  getCoverQualityPreferenceDefaultValue: () => "",

  getDataSaverPreferenceKey: (dexLang: string) => `${DATA_SAVER_PREF}_${dexLang}`,

  getStandardHttpsPreferenceKey: (dexLang: string) => `${STANDARD_HTTPS_PORT_PREF}_${dexLang}`,

  CONTENT_RATING_PREF_VAL_SAFE: "safe",
  CONTENT_RATING_PREF_VAL_SUGGESTIVE: "suggestive",
  CONTENT_RATING_PREF_VAL_EROTICA: "erotica",
  CONTENT_RATING_PREF_VAL_PORNOGRAPHIC: "pornographic",
  contentRatingPrefDefaults: ["safe", "suggestive"],
  allContentRatings: ["safe", "suggestive", "erotica", "pornographic"],
  getContentRatingPrefKey: (dexLang: string) => `${CONTENT_RATING_PREF}_${dexLang}`,

  ORIGINAL_LANGUAGE_PREF_VAL_JAPANESE: MangaDexIntl.JAPANESE,
  ORIGINAL_LANGUAGE_PREF_VAL_CHINESE: MangaDexIntl.CHINESE,
  ORIGINAL_LANGUAGE_PREF_VAL_CHINESE_HK: "zh-hk",
  ORIGINAL_LANGUAGE_PREF_VAL_KOREAN: MangaDexIntl.KOREAN,
  originalLanguagePrefDefaults: [] as string[],
  getOriginalLanguagePrefKey: (dexLang: string) => `${ORIGINAL_LANGUAGE_PREF}_${dexLang}`,

  defaultBlockedGroups: [GROUP_AZUKI, GROUP_BILIBILI, GROUP_COMIKEY, GROUP_INKR, GROUP_MANGA_HOT, GROUP_MANGA_PLUS],
  getBlockedGroupsPrefKey: (dexLang: string) => `${BLOCKED_GROUPS_PREF}_${dexLang}`,
  getBlockedUploaderPrefKey: (dexLang: string) => `${BLOCKED_UPLOADER_PREF}_${dexLang}`,
  getHasSanitizedUuidsPrefKey: (dexLang: string) => `${HAS_SANITIZED_UUIDS_PREF}_${dexLang}`,

  TRY_USING_FIRST_VOLUME_COVER_DEFAULT: false,
  getTryUsingFirstVolumeCoverPrefKey: (dexLang: string) => `${TRY_USING_FIRST_VOLUME_COVER_PREF}_${dexLang}`,
  getAltTitlesInDescPrefKey: (dexLang: string) => `${ALT_TITLES_IN_DESC_PREF}_${dexLang}`,
  getPreferExtensionLangTitlePrefKey: (dexLang: string) => `${PREFER_EXTENSION_LANG_TITLE_PREF}_${dexLang}`,
  getFinalChapterInDescPrefKey: (dexLang: string) => `${FINAL_CHAPTER_IN_DESC_PREF}_${dexLang}`,
  getIncludeUnavailablePrefKey: (dexLang: string) => `${INCLUDE_UNAVAILABLE_PREF}_${dexLang}`,

  TAG_GROUPS_ORDER: [TAG_GROUP_CONTENT, TAG_GROUP_FORMAT, TAG_GROUP_GENRE, TAG_GROUP_THEME],

  TAG_ANTHOLOGY_UUID: "51d83883-4103-437c-b4b1-731cb73d786c",
  TAG_ONE_SHOT_UUID: "0234a31e-a729-4e28-9d6a-3f87c4966b9e",

  romanizedLangCodes: {
    [MangaDexIntl.JAPANESE]: "ja-ro",
    [MangaDexIntl.KOREAN]: "ko-ro",
    [MangaDexIntl.CHINESE]: "zh-ro",
    "zh-hk": "zh-ro",
  } as Record<string, string>,
};
