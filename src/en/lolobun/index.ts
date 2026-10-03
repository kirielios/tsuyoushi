// Port of keiyoushi/extensions-source src/en/lolobun/Lolobun.kt (+ Dto.kt)
import {
  DateTimeFormatter,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  distinctBy,
  isBlank,
  substringAfter,
  substringAfterLast,
  type Document,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

// ---- Dto.kt
interface StatusDto {
  errorCode: number;
  msg: string | null;
}
interface ResponseDto<T> {
  status: StatusDto;
  data: T | null;
}
function requireData<T>(r: ResponseDto<T>): T {
  if (r.data === null || r.data === undefined) throw new Error(r.status.msg ?? `Request failed with code ${r.status.errorCode}`);
  return r.data;
}
interface SearchDto {
  HasMore: boolean;
  Items: SearchItemDto[];
}
interface SearchItemDto {
  EntityId: number;
  Title: string;
  Cover: string | null;
}
const COVER_URL = "https://osrs.sfacg.com/web/comic/images/Logo";
function searchItemToSManga(it: SearchItemDto): SManga {
  const manga = SManga.create();
  manga.url = String(it.EntityId);
  manga.title = it.Title;
  manga.thumbnail_url = it.Cover != null ? (it.Cover.startsWith("http") ? it.Cover : `${COVER_URL}/${it.Cover}`) : undefined;
  return manga;
}

const HIDE_LOCKED_PREF = "hide_locked_chapters";
const CHAPTER_NUMBER_REGEX = /^chapter\s*(\d+(?:\.\d+)?)$/i;
// A plain calendar date. Parsing it in the device's timezone keeps the same day as on the site
const DATE_FORMAT = DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.ENGLISH);

export default class Lolobun extends KeiSource {
  // The homepage section is the site's only comic listing
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const mangas = distinctBy(
      document.select(".section-item:has(a.name[href^=/c/])").map((element) => {
        const link = element.selectFirst("a.name")!;
        const manga = SManga.create();
        manga.url = substringAfterLast(link.attr("href"), "/");
        manga.title = link.text();
        manga.thumbnail_url = element.selectFirst("img.cover")?.absUrl("src");
        return manga;
      }),
      (it) => it.url,
    );
    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    if (isBlank(query)) return this.getPopularManga(page);

    const url = HttpUrl.parse(`${this.baseUrl}/ajax/Common.ashx`)
      .newBuilder()
      .addQueryParameter("op", "searchWorks")
      .addQueryParameter("q", query.trim())
      .addQueryParameter("type", "comic")
      .addQueryParameter("pi", String(page - 1))
      .build();
    const result = requireData((await this.client.get(url.toString())).parseAs<ResponseDto<SearchDto>>());
    return new MangasPage(result.Items.map(searchItemToSManga), result.HasMore);
  }

  protected override async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url = HttpUrl.parse(u.toString());
    if (url.host.replace(/^www\./, "") !== HttpUrl.parse(this.baseUrl).host.replace(/^www\./, "")) return null;
    if (url.pathSegments[0] !== "c") return null;
    const seg = url.pathSegments[1];
    if (seg === undefined || !/^[+-]?\d+$/.test(seg)) return null;
    const id = Number.parseInt(seg, 10);

    const manga = this.toSManga((await this.client.get(`${this.baseUrl}/c/${id}`)).asJsoup());
    manga.url = String(id);
    return manga;
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/c/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.toSManga(document);
    details.url = manga.url;
    return new SMangaUpdate(details, this.toSChapterList(document));
  }

  private toSManga(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst(".header-item-info .name")!.text();
    manga.thumbnail_url = document.selectFirst("img.header-item-cover")?.absUrl("src");
    manga.description = document.selectFirst("#comic-desc")?.wholeText().trim();

    // "Ongoing · Magic"
    const info = (document.selectFirst(".header-item-info .info")?.text() ?? "").split("·").map((it) => it.trim());
    const s = info[0].toLowerCase();
    manga.status = s === "ongoing" ? SManga.ONGOING : s === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;
    manga.genre = info.slice(1).join(", ") || undefined;
    return manga;
  }

  private toSChapterList(document: Document): SChapter[] {
    const items = document.select(".catalog-list .catalog-item");
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF, false);
    // The comic page only shows the latest chapter's release date
    const latestDate = DATE_FORMAT.tryParseDate(document.selectFirst(".lastest-update-time")?.text());
    // "Extra 01" etc. sit between numbered chapters. Number them right after the preceding chapter,
    // otherwise the app parses "Extra 01" as chapter 1
    let previousNumber = 0;
    let extrasSincePrevious = 0;

    const list: SChapter[] = [];
    items.forEach((element, index) => {
      const link = element.selectFirst(".title a")!;
      const title = link.text();
      const m = CHAPTER_NUMBER_REGEX.exec(title);
      const number = m ? Number.parseFloat(m[1]) : null;
      let chapterNumber: number;
      if (number !== null) {
        previousNumber = number;
        extrasSincePrevious = 0;
        chapterNumber = number;
      } else {
        extrasSincePrevious++;
        chapterNumber = previousNumber + extrasSincePrevious / 100;
      }
      const locked = element.selectFirst(".icon-box img[src*=lock]") != null;
      if (locked && hideLocked) return;

      const chapter = SChapter.create();
      chapter.url = substringAfter(link.attr("href"), "/c/");
      chapter.name = locked ? `🔒 ${title}` : title;
      chapter.chapter_number = chapterNumber;
      if (index === items.length - 1) chapter.date_upload = latestDate;
      list.push(chapter);
    });
    return list.reverse();
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/c/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const body = new URLSearchParams({ chapId: substringAfterLast(chapter.url, "/") });
    // Locked chapters come back as an empty list
    const res = await this.client.post(`${this.baseUrl}/ajax/comic.ashx?op=getChapterPic`, undefined, body);
    return requireData(res.parseAs<ResponseDto<string[]>>()).map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat();
    p.key = HIDE_LOCKED_PREF;
    p.title = "Hide locked chapters";
    p.summary = "Don't list paid chapters (🔒). Refresh a comic's chapter list to apply.";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
