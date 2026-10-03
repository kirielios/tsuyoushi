// Port of keiyoushi/extensions-source src/all/pixiv/PixivTypes.kt (+ PixivConstants.kt)
export const KNOWN_LOCALES = ["en", "ja", "zh", "zh-tw", "ko"];

export interface PixivApiResponse {
  error?: boolean;
  message?: string | null;
  body?: unknown;
}

export interface PixivResults {
  illusts?: PixivIllust[] | null;
}

export interface PixivIllust {
  author_details?: PixivAuthorDetails | null;
  comment?: string | null;
  id?: string | null;
  is_ad_container?: number | null;
  series?: PixivSearchResultSeries | null;
  tags?: string[] | null;
  title?: string | null;
  type?: string | null;
  upload_timestamp?: number | null;
  url?: string | null;
  x_restrict?: string | null;
}

export interface PixivSearchResultSeries {
  coverImage?: string | null;
  id?: string | null;
  title?: string | null;
  userId?: string | null;
}

export interface PixivIllustDetails {
  illust_details?: PixivIllust | null;
}

export interface PixivIllustsDetails {
  illust_details?: PixivIllust[] | null;
}

export interface PixivIllustPage {
  urls?: PixivIllustPageUrls | null;
}

export interface PixivIllustPageUrls {
  thumb_mini?: string | null;
  small?: string | null;
  regular?: string | null;
  original?: string | null;
}

export interface PixivAuthorDetails {
  user_id?: string | null;
  user_name?: string | null;
}

export interface PixivSeriesDetails {
  series: PixivSeries | null;
}

export interface PixivSeries {
  caption?: string | null;
  /** JsonPrimitive */
  coverImage?: unknown;
  id?: string | null;
  title?: string | null;
  /** CAUTION: sometimes this isn't passed! */
  userId?: string | null;
}

export interface PixivSeriesContents {
  series_contents?: PixivIllust[] | null;
}

export interface PixivRankings {
  ranking?: PixivRankingEntry[] | null;
}

export interface PixivRankingEntry {
  illustId?: string | null;
  rank?: number | null;
}

// Data models for parsing __NEXT_DATA__ from /search/users endpoint
export interface PixivNextData {
  props: { pageProps: PixivPageProps };
}

export interface PixivPageProps {
  userIds?: number[];
  userData?: { users?: Record<string, PixivUserInfo> } | null;
}

export interface PixivUserInfo {
  userId: string;
  name: string;
  image?: string | null;
  imageBig?: string | null;
  comment?: string | null;
}
