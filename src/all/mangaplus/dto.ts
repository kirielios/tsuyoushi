// Port of keiyoushi/extensions-source src/all/mangaplus/Dto.kt
import { SChapter, SManga, substringAfter, type ProtoSchema } from "../../../sdk/index.ts";

export const LANGUAGE_ENGLISH = 0;
export const LANGUAGE_SPANISH = 1;
export const LANGUAGE_FRENCH = 2;
export const LANGUAGE_INDONESIAN = 3;
export const LANGUAGE_PORTUGUESE_BR = 4;
export const LANGUAGE_RUSSIAN = 5;
export const LANGUAGE_THAI = 6;
export const LANGUAGE_GERMAN = 7;
export const LANGUAGE_VIETNAMESE = 9;

// Proto schemas: the @ProtoNumber annotations of each DTO class.
const PopupSchema: ProtoSchema = { 1: ["subject", "string"], 2: ["body", "string"] };
const ErrorResultSchema: ProtoSchema = { 2: ["englishPopup", PopupSchema], 3: ["spanishPopup", PopupSchema] };
const TagNameSchema: ProtoSchema = { 1: ["name", "string"], 2: ["slug", "string"] };
const TitleSchema: ProtoSchema = { 1: ["titleId", "int"], 2: ["name", "string"], 3: ["author", "string"], 4: ["portraitImageUrl", "string"], 7: ["language", "int"] };
const ChapterSchema: ProtoSchema = { 2: ["chapterId", "int"], 3: ["name", "string"], 4: ["subTitle", "string"], 6: ["startTimeStamp", "int"] };
const ChapterListGroupSchema: ProtoSchema = { 2: ["firstChapterList", ChapterSchema, true], 4: ["lastChapterList", ChapterSchema, true] };
const TitleDetailViewSchema: ProtoSchema = {
  1: ["title", TitleSchema],
  3: ["overview", "string"],
  7: ["viewingPeriodDescription", "string"],
  8: ["nonAppearanceInfo", "string"],
  28: ["chapterListGroup", ChapterListGroupSchema, true],
  31: ["genreList", TagNameSchema, true],
};
const MangaPageSchema: ProtoSchema = { 1: ["imageUrl", "string"], 5: ["encryptionKey", "string"] };
const MangaViewerSchema: ProtoSchema = { 1: ["pages", { 1: ["mangaPage", MangaPageSchema] }, true], 9: ["titleId", "int"], 19: ["viewToken", "string"] };
const UpdatedTitleSchema: ProtoSchema = { 3: ["latestChapters", { 1: ["title", TitleSchema] }, true], 6: ["updatedAt", "int"] };
const SuccessResultSchema: ProtoSchema = {
  8: ["titleDetailView", TitleDetailViewSchema],
  10: ["mangaViewer", MangaViewerSchema],
  25: ["allTitlesView", { 1: ["allTitlesGroup", { 2: ["titles", TitleSchema, true] }, true] }],
  35: ["allTitlesViewV3", { 2: ["tags", TagNameSchema, true], 3: ["titles", { 2: ["title", TitleSchema], 3: ["genres", TagNameSchema, true] }, true] }],
  37: ["titleRankingView", { 3: ["rankedTitles", { 2: ["titles", TitleSchema, true] }, true] }],
  38: ["webHomeView", { 2: ["groups", { 2: ["titles", UpdatedTitleSchema, true] }, true], 7: ["featured", { 2: ["title", UpdatedTitleSchema] }] }],
};
export const MangaPlusResponseSchema: ProtoSchema = { 1: ["success", SuccessResultSchema], 2: ["error", ErrorResultSchema] };

export interface MangaPlusResponse {
  success?: SuccessResult;
  error?: ErrorResult;
}

export interface ErrorResult {
  englishPopup?: Popup;
  spanishPopup?: Popup;
}
export function langPopup(error: ErrorResult, langCode: number): Popup | undefined {
  return langCode === LANGUAGE_SPANISH ? (error.spanishPopup ?? error.englishPopup) : error.englishPopup;
}

export interface Popup {
  subject?: string;
  body?: string;
}

export interface SuccessResult {
  titleDetailView?: TitleDetailView;
  mangaViewer?: MangaViewer;
  allTitlesView?: AllTitlesView;
  allTitlesViewV3?: AllTitlesViewV3;
  titleRankingView?: TitleRankingView;
  webHomeView?: WebHomeView;
}

export interface AllTitlesViewV3 {
  tags: TagName[];
  titles: AllTitlesV3Entry[];
}
export interface AllTitlesV3Entry {
  title: Title;
  genres: TagName[];
}
export interface TitleRankingView {
  rankedTitles: RankedTitle[];
}
export interface RankedTitle {
  titles: Title[];
}
export interface AllTitlesView {
  allTitlesGroup: AllTitlesGroup[];
}
export interface AllTitlesGroup {
  titles: Title[];
}
export interface WebHomeView {
  groups: UpdatedTitleGroup[];
  featured?: FeaturedUpdate;
}
export interface FeaturedUpdate {
  title: UpdatedTitle;
}
export interface UpdatedTitleGroup {
  titles: UpdatedTitle[];
}
export interface UpdatedTitle {
  latestChapters: LatestChapter[];
  updatedAt?: number;
}
export interface LatestChapter {
  title: Title;
}

export interface Title {
  titleId?: number;
  name?: string;
  author?: string;
  portraitImageUrl?: string;
  language?: number; // default LANGUAGE_ENGLISH
}
export const titleLanguage = (t: Title) => t.language ?? LANGUAGE_ENGLISH;
export function titleToSManga(t: Title): SManga {
  const manga = SManga.create();
  manga.title = t.name ?? "";
  manga.author = t.author?.replaceAll(" / ", ", ");
  manga.artist = manga.author;
  manga.thumbnail_url = t.portraitImageUrl ?? "";
  manga.url = `#/titles/${t.titleId ?? 0}`;
  return manga;
}

export interface TitleDetailView {
  title: Title;
  overview?: string;
  viewingPeriodDescription?: string;
  nonAppearanceInfo?: string;
  chapterListGroup: ChapterListGroup[];
  genreList: TagName[];
}
export const chapterListOf = (v: TitleDetailView): Chapter[] => v.chapterListGroup.flatMap((it) => [...it.firstChapterList, ...it.lastChapterList]);

const COMPLETED_REGEX = /completado|completed?|completo/i;
const HIATUS_REGEX = /on a hiatus/i;

export function titleDetailToSManga(v: TitleDetailView): SManga {
  const manga = titleToSManga(v.title);
  const overview = v.overview ?? "";
  const viewingPeriodDescription = v.viewingPeriodDescription ?? "";
  const nonAppearanceInfo = v.nonAppearanceInfo ?? "";
  const isOneShot = v.genreList.some((it) => it.slug === "one-shot");
  manga.description = [overview, viewingPeriodDescription].filter((it) => it.length > 0).join("\n\n");
  manga.genre = v.genreList
    .map((it) => it.name ?? "")
    .filter((it) => it.length > 0)
    .join(", ");
  if (isOneShot || COMPLETED_REGEX.test(nonAppearanceInfo) || viewingPeriodDescription.includes("latest 0 chapters")) manga.status = SManga.COMPLETED;
  else if (HIATUS_REGEX.test(nonAppearanceInfo)) manga.status = SManga.ON_HIATUS;
  else manga.status = SManga.ONGOING;
  return manga;
}

export interface TagName {
  name?: string;
  slug?: string;
}

export interface ChapterListGroup {
  firstChapterList: Chapter[];
  lastChapterList: Chapter[];
}

export interface Chapter {
  chapterId?: number;
  name?: string;
  subTitle?: string;
  startTimeStamp?: number;
}
export const isExpired = (c: Chapter) => c.subTitle == null;
export function chapterToSChapter(c: Chapter, subtitlePref: boolean): SChapter {
  const chapter = SChapter.create();
  const name = c.name ?? "";
  chapter.name = subtitlePref && c.subTitle != null ? c.subTitle : `${name} - ${c.subTitle ?? null}`;
  chapter.date_upload = 1000 * (c.startTimeStamp ?? 0);
  chapter.url = `#/viewer/${c.chapterId ?? 0}`;
  const num = substringAfter(name, "#");
  chapter.chapter_number = num.trim() !== "" && !isNaN(Number(num)) ? Number(num) : -1;
  chapter.scanlator = "MANGA Plus";
  return chapter;
}

export interface MangaViewer {
  pages: MangaPlusPage[];
  titleId?: number;
  viewToken?: string;
}
export interface MangaPlusPage {
  mangaPage?: MangaPage;
}
export interface MangaPage {
  imageUrl?: string;
  encryptionKey?: string;
}
