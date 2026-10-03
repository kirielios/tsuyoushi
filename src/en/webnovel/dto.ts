// Port of keiyoushi/extensions-source src/en/webnovel/WebNovelDto.kt
import { MangasPage, SManga } from "../../../sdk/index.ts";

export type CoverUrl = (id: string, coverUpdatedAt: number) => string;

export interface ResponseWrapper<T> {
  code: number;
  data?: T | null;
  msg: string;
}

export interface QuerySearchResponse {
  comicInfo: BrowseResponse<QuerySearchItem>;
}

export const querySearchToMangasPage = (r: QuerySearchResponse, coverUrl: CoverUrl): MangasPage => browseToMangasPage(r.comicInfo, coverUrl, querySearchItemToSManga);

export type FilterSearchResponse = BrowseResponse<FilterSearchItem>;

export interface BrowseResponse<T> {
  isLast: number;
  /** @JsonNames("comicItems") */
  items?: T[];
  comicItems?: T[];
}

export function browseToMangasPage<T>(r: BrowseResponse<T>, coverUrl: CoverUrl, toSManga: (item: T, coverUrl: CoverUrl) => SManga): MangasPage {
  const items = r.items ?? r.comicItems;
  if (items === undefined) throw new Error("Field 'items' is required");
  return new MangasPage(
    items.map((it) => toSManga(it, coverUrl)),
    r.isLast === 0,
  );
}

export interface QuerySearchItem {
  comicId: string;
  bookName: string;
  categoryName: string;
  CV: number;
}

export function querySearchItemToSManga(item: QuerySearchItem, coverUrl: CoverUrl): SManga {
  const it = SManga.create();
  it.url = item.comicId;
  it.title = item.bookName;
  it.genre = item.categoryName;
  it.thumbnail_url = coverUrl(item.comicId, item.CV);
  return it;
}

export interface FilterSearchItem {
  bookId: string;
  bookName: string;
  authorName: string;
  description: string;
  categoryName: string;
  coverUpdateTime: number;
}

export function filterSearchItemToSManga(item: FilterSearchItem, coverUrl: CoverUrl): SManga {
  const it = SManga.create();
  it.url = item.bookId;
  it.title = item.bookName;
  it.author = item.authorName;
  it.description = item.description;
  it.genre = item.categoryName;
  it.thumbnail_url = coverUrl(item.bookId, item.coverUpdateTime);
  return it;
}

export interface ComicDetailInfoResponse {
  comicInfo: ComicDetailInfo;
}

export interface ComicDetailInfo {
  comicId: string;
  comicName: string;
  authorName: string;
  description: string;
  updateCycle: string;
  categoryName: string;
  actionStatus: number;
  CV: number;
}

const ONGOING = 1;
const COMPLETED = 2;
const ON_HIATUS = 3;

export function comicDetailInfoToSManga(comic: ComicDetailInfo, coverUrl: CoverUrl): SManga {
  const it = SManga.create();
  it.url = comic.comicId;
  it.title = comic.comicName;
  it.author = comic.authorName;
  let description = comic.description;
  if (comic.actionStatus === ONGOING && comic.updateCycle.trim()) {
    description += "\n\nInformation:";
    description += `\n• ${comic.updateCycle.charAt(0).toUpperCase()}${comic.updateCycle.slice(1)}`;
  }
  it.description = description;
  it.genre = comic.categoryName;
  switch (comic.actionStatus) {
    case ONGOING:
      it.status = SManga.ONGOING;
      break;
    case COMPLETED:
      it.status = SManga.COMPLETED;
      break;
    case ON_HIATUS:
      it.status = SManga.ON_HIATUS;
      break;
    default:
      it.status = SManga.UNKNOWN;
  }
  it.thumbnail_url = coverUrl(comic.comicId, comic.CV);
  return it;
}

export interface ComicChapterListResponse {
  comicInfo: { comicId: string };
  comicChapters: ComicChapter[];
}

export interface ComicChapter {
  chapterId: string;
  chapterName: string;
  publishTime: string;

  chapterLevel: number;
  userLevel: number;
  price: number;
  isVip: number;
  isAuth: number;
}

// This can mean the chapter is free or user has paid to unlock it (check with isPremium for this case)
const isAccessibleByUser = (c: ComicChapter) => c.isAuth === 1;
const isPremium = (c: ComicChapter) => c.isVip !== 0 || c.price !== 0;
export const isLocked = (c: ComicChapter) => isPremium(c) && !isAccessibleByUser(c);

// You can pay to get some chapter earlier than others. This privilege is divided into some tiers
// We check if user's tier same or more than chapter's.
export const isVisible = (c: ComicChapter) => c.userLevel >= c.chapterLevel;

export interface ChapterContentResponse {
  chapterInfo: ChapterContent;
}

export interface ChapterContent {
  chapterId: number;
  chapterPage: ChapterPage[];
}

export interface ChapterPage {
  pageId: string;
  url: string;
}
