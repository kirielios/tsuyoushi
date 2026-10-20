// Port of yuzono/anime-extensions src/all/jable/JableIntl.kt
export interface Intl {
  popular: string;
  latestUpdate: string;
  sortLatestUpdate: string;
  sortMostView: string;
  sortMostFavorite: string;
  sortRecentBest: string;
  hotDay: string;
  hotWeek: string;
  hotMonth: string;
  hotAll: string;
  filterPopularSortTitle: string;
  filterTagsSortTitle: string;
  filterTagTitle: string;
}

const ZH: Intl = {
  popular: "熱度優先",
  latestUpdate: "新片優先",
  sortLatestUpdate: "最近更新",
  sortMostView: "最多觀看",
  sortMostFavorite: "最高收藏",
  sortRecentBest: "近期最佳",
  hotDay: "今日熱門",
  hotWeek: "本周熱門",
  hotMonth: "本月熱門",
  hotAll: "所有時間",
  filterPopularSortTitle: "熱門排序",
  filterTagsSortTitle: "通用排序",
  filterTagTitle: "標籤",
};

const JA: Intl = {
  popular: "人気優先",
  latestUpdate: "新作優先",
  sortLatestUpdate: "最近更新",
  sortMostView: "最も見ら",
  sortMostFavorite: "最もお気に入",
  sortRecentBest: "最近ベスト",
  hotDay: "今日のヒット",
  hotWeek: "今週のヒット",
  hotMonth: "今月のヒット",
  hotAll: "全ての時間",
  filterPopularSortTitle: "人気ソート",
  filterTagsSortTitle: "一般ソート",
  filterTagTitle: "タグ",
};

const EN: Intl = {
  popular: "Hot",
  latestUpdate: "Newest",
  sortLatestUpdate: "Recent Update",
  sortMostView: "Most Viewed",
  sortMostFavorite: "Most Favorite",
  sortRecentBest: "Best Recently",
  hotDay: "Today",
  hotWeek: "This Week",
  hotMonth: "This Month",
  hotAll: "All Time",
  filterPopularSortTitle: "Popular Sorting",
  filterTagsSortTitle: "General Sorting",
  filterTagTitle: "Tag",
};

export const JableIntl = (lang: string): Intl => ({ zh: ZH, ja: JA, en: EN })[lang] ?? ZH;
