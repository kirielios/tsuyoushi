// Port of keiyoushi/extensions-source src/en/mangamo/MangamoConstants.kt
export const MangamoConstants = {
  USER_TOKEN_PREF: "userToken",
  HIDE_COIN_MANGA_PREF: "hideCoinManga",
  EXCLUSIVES_ONLY_PREF: "onlyShowExclusives",

  HIDE_COIN_MANGA_OPTION_IN_BROWSE: "inBrowse",
  HIDE_COIN_MANGA_OPTION_IN_SEARCH: "inSearch",
  HIDE_COIN_MANGA_OPTION_CHAPTERS: "chapters",

  EXCLUSIVES_ONLY_OPTION_IN_BROWSE: "inBrowse",
  EXCLUSIVES_ONLY_OPTION_IN_SEARCH: "inSearch",

  FIREBASE_API_KEY: "AIzaSyCU00GBJ4BPSK5owyaXvHZIXwMJ5Rq5F8c",
  FIREBASE_FUNCTION_BASE_PATH: "https://us-central1-mangamoapp1.cloudfunctions.net/api",
  FIRESTORE_API_BASE_PATH: "https://firestore.googleapis.com/v1/projects/mangamoapp1/databases/(default)/documents",
  FIRESTORE_CACHE_LENGTH: 600,

  SERIES_QUERY_PARAM: "series",
  CHAPTER_QUERY_PARAM: "chapter",

  BROWSE_PAGE_SIZE: 50,
} as const;
