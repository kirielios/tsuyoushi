// Port of keiyoushi/extensions-source src/all/xkcd/Xkcd.kt
import {
  Base64,
  DateTimeFormatter,
  KeiSource,
  ListPreference,
  Locale,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneOffset,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";
import { THUMBNAIL_PNG_BASE64 } from "./thumbnail.ts";

interface ZhStrip {
  id: number;
  title: string;
}

const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const ENGLISH_BASE_URL = "https://xkcd.com";

class OrganizationMethod {
  static readonly SINGLE = new OrganizationMethod("SINGLE", "Single manga (all comics)");
  static readonly BY_YEAR = new OrganizationMethod("BY_YEAR", "By year");
  static readonly BY_YEAR_MONTH = new OrganizationMethod("BY_YEAR_MONTH", "By year-month");
  static readonly entries = [OrganizationMethod.SINGLE, OrganizationMethod.BY_YEAR, OrganizationMethod.BY_YEAR_MONTH];
  static readonly PREF_KEY = "organization_method";
  static readonly defaultOption = OrganizationMethod.SINGLE;
  static fromKey(key: string) {
    return OrganizationMethod.entries.find((it) => it.key === key) ?? OrganizationMethod.defaultOption;
  }
  private constructor(
    readonly key: string,
    readonly displayName: string,
  ) {}
}

/** Kotlin's String.removeSurrounding(delimiter) */
const removeSurrounding = (s: string, d: string) => (s.length >= 2 * d.length && s.startsWith(d) && s.endsWith(d) ? s.slice(d.length, s.length - d.length) : s);
/** Kotlin's String.toIntOrNull() */
const toIntOrNull = (s: string): number | null => (/^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);
const pad2 = (n: number) => String(n).padStart(2, "0");

export default class Xkcd extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(TextInterceptor()).addChainInterceptor(async (chain) => {
      const request = chain.request();
      if (new URL(request.url).hostname !== "thumbnail") return chain.proceed(request);
      return Response.of(request.url, Base64.decode(THUMBNAIL_PNG_BASE64), "image/png");
    });
  }

  private get archive(): string {
    switch (this.lang) {
      case "fr":
        return "/tous-episodes.php";
      case "ru":
        return "/img";
      case "zh":
        return "/api/strips.json";
      default:
        return "/archive";
    }
  }

  private get creator(): string {
    switch (this.lang) {
      case "ru":
        return "Рэндел Манро";
      case "zh":
        return "兰德尔·门罗";
      default:
        return "Randall Munroe";
    }
  }

  private get synopsis(): string {
    switch (this.lang) {
      case "es":
        return "Un webcómic sobre romance, sarcasmo, mates y lenguaje.";
      case "fr":
        return "Un webcomic sarcastique qui parle de romance, de maths et de langage.";
      case "ru":
        return "о романтике, сарказме, математике и языке";
      case "zh":
        return "這裡翻譯某個關於浪漫、諷刺、數學、以及語言的漫畫";
      default:
        return "A webcomic of romance, sarcasm, math and language.";
    }
  }

  private get interactiveText(): string {
    switch (this.lang) {
      case "es":
        return "Para experimentar la versión interactiva de este cómic, ábralo en WebView/navegador.";
      case "zh":
        return "要體驗本漫畫的互動版請在WebView/瀏覽器中打開。";
      case "fr":
      case "ru":
        throw new Error("UnsupportedOperationException");
      default:
        return "To experience the interactive version of this comic, open it in WebView/browser.";
    }
  }

  private get chapterListSelector(): string {
    switch (this.lang) {
      case "es":
        return ".archive-entry > a";
      case "fr":
        return "#content .s > a:not(:last-of-type)";
      case "ru":
        return ".main > a";
      case "zh":
        throw new Error("UnsupportedOperationException");
      default:
        return "#middleContainer > a";
    }
  }

  private get imageSelector(): string {
    switch (this.lang) {
      case "es":
        return "#middleContent .strip";
      case "fr":
        return "#content .s";
      case "ru":
        return ".main";
      case "zh":
        return "#content > img:not([id])";
      default:
        return "#comic > img";
    }
  }

  private readonly defaultFallbackThumbnail = "https://thumbnail/xkcd.png";

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-M-d", Locale.ROOT);

  private timestamp(s: string): number {
    return this.dateFormat.tryParseDate(s, ZoneOffset.UTC);
  }

  private readonly chapterTitleFormatter = (number: number, text: string) => `${number}: ${text}`;

  // Preferences
  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new ListPreference(screen.context);
    pref.key = OrganizationMethod.PREF_KEY;
    pref.title = "Organization Method";
    pref.entries = OrganizationMethod.entries.map((it) => it.displayName);
    pref.entryValues = OrganizationMethod.entries.map((it) => it.key);
    pref.setDefaultValue(OrganizationMethod.defaultOption.key);
    pref.summary =
      "Current: %s\n\n" +
      "Changing this will show comics grouped differently. " +
      "Your reading progress is tied to the organization method.\n\n" +
      "Note: You may need to exit and re-enter the extension for the manga list to update.";
    screen.addPreference(pref);
  }

  private getOrganizationMethod(): OrganizationMethod {
    const key = this.preferences.getString(OrganizationMethod.PREF_KEY, OrganizationMethod.defaultOption.key)!;
    return OrganizationMethod.fromKey(key);
  }

  // what key to use for grouping comics into mangas
  private getChapterToKey(): (chapter: SChapter) => string {
    switch (this.getOrganizationMethod()) {
      case OrganizationMethod.BY_YEAR:
        return (chapter) => String(new Date(chapter.date_upload).getFullYear()).padStart(4, "0");
      case OrganizationMethod.BY_YEAR_MONTH:
        return (chapter) => {
          const d = new Date(chapter.date_upload);
          return `${String(d.getFullYear()).padStart(4, "0")}-${pad2(d.getMonth() + 1)}`;
        };
      default:
        return () => "SINGLE";
    }
  }

  private getKeyToTitleFormatter(): (key: string) => string {
    return this.getOrganizationMethod() === OrganizationMethod.SINGLE ? () => "xkcd" : (key) => `xkcd ${key}`;
  }

  // Archive caching

  private comicDateMapping: Map<number, string> | null = null; // Comic number -> date mapping from English
  private comicDateMappingTime = 0;
  private allChaptersCache: SChapter[] | null = null; // Full chapter list with dates
  private allChaptersCacheTime = 0;

  // some translations don't provide dates for their comics, but we can look up the dates
  // (of english publication) given the comic number which is shared across translations
  private async getComicDateMappingFromEnglishArchive(): Promise<Map<number, string>> {
    const now = Date.now();
    if (this.comicDateMapping == null || now - this.comicDateMappingTime > CACHE_EXPIRY_MS) {
      try {
        const map = new Map<number, string>();
        for (const element of (await this.client.get(`${ENGLISH_BASE_URL}/archive/`)).asJsoup().select("#middleContainer > a")) {
          const raw = removeSurrounding(element.attr("href"), "/");
          if (!/^[+-]?\d+$/.test(raw)) throw new Error(`NumberFormatException: ${raw}`);
          map.set(Number.parseInt(raw, 10), element.attr("title")); // "2026-1-9" format
        }
        this.comicDateMapping = map;
      } catch {
        this.comicDateMapping = new Map();
      }
      this.comicDateMappingTime = now;
    }
    return this.comicDateMapping ?? new Map();
  }

  private async getAllComicsAsChapters(): Promise<SChapter[]> {
    const now = Date.now();
    if (this.allChaptersCache == null || now - this.allChaptersCacheTime > CACHE_EXPIRY_MS) {
      this.allChaptersCache = await this.chapterListParse(await this.client.get(this.baseUrl + this.archive));
      this.allChaptersCacheTime = now;
    }
    return this.allChaptersCache;
  }

  private async getGroupedChapters(): Promise<Map<string, SChapter[]>> {
    const key = this.getChapterToKey();
    const grouped = new Map<string, SChapter[]>();
    for (const chapter of await this.getAllComicsAsChapters()) {
      const k = key(chapter);
      const list = grouped.get(k);
      if (list) list.push(chapter);
      else grouped.set(k, [chapter]);
    }
    return grouped;
  }

  // organize chapters into mangas according to the chosen key
  private async makeGroupedManga(page: number, perPage = 10): Promise<MangasPage> {
    const groupedChapters = await this.getGroupedChapters();
    const allKeys = [...groupedChapters.keys()].sort().reverse(); // Newest first

    const startIndex = (page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, allKeys.length);
    const hasNextPage = endIndex < allKeys.length;

    if (startIndex >= allKeys.length) {
      return new MangasPage([], false);
    }

    const pageKeys = allKeys.slice(startIndex, endIndex);
    const mangas: SManga[] = [];
    for (const key of pageKeys) {
      const chapters = groupedChapters.get(key)!;
      const firstChapter = chapters[0];
      const manga = SManga.create();
      manga.title = this.getKeyToTitleFormatter()(key);
      manga.url = key;
      manga.artist = this.creator;
      manga.author = this.creator;
      manga.description = this.synopsis;
      manga.status = SManga.ONGOING;
      manga.thumbnail_url = firstChapter != null && this.getOrganizationMethod() !== OrganizationMethod.SINGLE ? await this.fetchThumbnailUrlForChapter(firstChapter) : this.defaultFallbackThumbnail;
      manga.initialized = true;
      mangas.push(manga);
    }

    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.makeGroupedManga(page);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const newChapters = fetchChapters ? ((await this.getGroupedChapters()).get(manga.url) ?? []) : chapters;
    return new SMangaUpdate(manga, newChapters);
  }

  override getMangaUrl(_manga: SManga): string {
    return this.baseUrl;
  }

  // ============================= Chapters ==============================

  private async chapterListParse(response: Response): Promise<SChapter[]> {
    const englishDates = await this.getComicDateMappingFromEnglishArchive();

    if (this.lang === "zh") {
      return Object.values(response.parseAs<Record<string, ZhStrip>>()).map((strip) => {
        const comicNumber = strip.id;
        const chapter = SChapter.create();
        chapter.url = `/${comicNumber}`;
        chapter.name = this.chapterTitleFormatter(comicNumber, strip.title);
        chapter.chapter_number = comicNumber;
        chapter.date_upload = englishDates.has(comicNumber) ? this.timestamp(englishDates.get(comicNumber)!) : 0;
        return chapter;
      });
    }

    let chapters = response
      .asJsoup()
      .select(this.chapterListSelector)
      .map((element): SChapter | null => {
        switch (this.lang) {
          case "es": {
            const title = element.text();
            const timeElement = element.parent()?.selectFirst("time");
            if (!timeElement) return null;
            const datePart = timeElement.text();

            const spanishOverrides = new Map([["/strips/geografia/", 1472]]);
            const dateToNumber = new Map<string, number>();
            for (const [number, date] of englishDates) {
              const parts = date.split("-");
              const normalizedDate = parts.length === 3 ? `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}` : date;
              dateToNumber.set(normalizedDate, number);
            }

            const urlPath = substringAfter(element.absUrl("href"), this.baseUrl);
            const comicNumber = spanishOverrides.get(urlPath) ?? dateToNumber.get(datePart);
            if (comicNumber === undefined) return null;

            const chapter = SChapter.create();
            chapter.url = urlWithoutDomain(element.absUrl("href"));
            chapter.name = this.chapterTitleFormatter(comicNumber, title);
            chapter.chapter_number = comicNumber;
            chapter.date_upload = this.timestamp(datePart);
            return chapter;
          }
          case "fr": {
            const chapter = SChapter.create();
            chapter.url = urlWithoutDomain(element.absUrl("href"));
            const comicNumber = toIntOrNull(substringAfter(chapter.url, "="));
            chapter.name = this.chapterTitleFormatter(comicNumber ?? 0, element.text());
            chapter.chapter_number = comicNumber ?? 0;
            chapter.date_upload = comicNumber != null && englishDates.has(comicNumber) ? this.timestamp(englishDates.get(comicNumber)!) : 0;
            return chapter;
          }
          case "ru": {
            const chapter = SChapter.create();
            chapter.url = urlWithoutDomain(element.absUrl("href"));
            const comicNumber = toIntOrNull(removeSurrounding(chapter.url, "/"));
            const title = element.children()[0].attr("alt");
            chapter.name = this.chapterTitleFormatter(comicNumber ?? 0, title);
            chapter.chapter_number = comicNumber ?? 0;
            chapter.date_upload = comicNumber != null && englishDates.has(comicNumber) ? this.timestamp(englishDates.get(comicNumber)!) : 0;
            return chapter;
          }
          default: {
            // en
            const chapter = SChapter.create();
            chapter.url = urlWithoutDomain(element.absUrl("href"));
            const comicNumber = toIntOrNull(removeSurrounding(chapter.url, "/")) ?? 0;
            chapter.name = this.chapterTitleFormatter(comicNumber, element.text());
            chapter.chapter_number = comicNumber;
            chapter.date_upload = this.timestamp(element.attr("title"));
            return chapter;
          }
        }
      })
      .filter((it): it is SChapter => it !== null);

    if (this.lang === "fr") {
      chapters = chapters.reverse();
    }

    return chapters;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    const container = document.selectFirst(this.imageSelector);
    if (!container) throw new Error(this.interactiveText);

    let img: Element | null;
    switch (this.lang) {
      case "fr":
        img = container.selectFirst("img[src^='strips/']");
        break;
      case "ru":
        img = container.selectFirst("img[src*='/i/']");
        break;
      case "zh":
        img = container;
        break;
      default:
        img = container.nextElementSibling() == null ? container : null;
    }
    if (!img) throw new Error(this.interactiveText);

    let image: string;
    if (this.lang === "fr" || this.lang === "ru" || this.lang === "zh") image = img.absUrl("src");
    else if (!img.hasAttr("srcset")) image = img.absUrl("src");
    else image = substringBefore(img.absUrl("srcset"), " ");

    let textParam1: string;
    if (this.lang === "fr") {
      const t = document.selectFirst("#content .s")?.selectFirst("div:not(.buttons)")?.text();
      textParam1 = t ? t : img.attr("alt");
    } else textParam1 = img.attr("alt");

    let textParam2: string;
    if (this.lang === "ru") {
      const t = document.selectFirst(".comics_text")?.text();
      textParam2 = t ? t : img.attr("alt");
    } else textParam2 = img.attr("title");

    const text = TextInterceptorHelper.createUrl(textParam1, textParam2);

    return [new Page(0, "", image), new Page(1, "", text)];
  }

  // ============================= Utilities =============================

  private extractImageFromContainer(container: Element): Element | null {
    switch (this.lang) {
      case "fr":
        return container.selectFirst("img[src^='strips/']");
      case "ru":
        return container.selectFirst("img[src*='/i/']");
      default:
        return container;
    }
  }

  private async fetchThumbnailUrlForChapter(chapter: SChapter): Promise<string> {
    try {
      const response = await this.client.get(this.baseUrl + chapter.url, undefined, { ensureSuccess: false });
      if (!response.isSuccessful) {
        return this.defaultFallbackThumbnail;
      }

      const doc = response.asJsoup();
      const container = doc.selectFirst(this.imageSelector);

      const img = (container ? this.extractImageFromContainer(container) : null) ?? doc.selectFirst("img[alt]");

      let url: string | null = null;
      if (img) {
        if (img.hasAttr("srcset")) url = substringBefore(img.absUrl("srcset"), " ");
        else if (img.hasAttr("src")) url = img.absUrl("src");
      }

      return url && url.length > 0 && !url.includes("thumbnail") ? url : this.defaultFallbackThumbnail;
    } catch {
      return this.defaultFallbackThumbnail;
    }
  }
}
