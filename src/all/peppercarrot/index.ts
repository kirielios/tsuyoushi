// Port of keiyoushi/extensions-source src/all/peppercarrot/PepperCarrot.kt (+ Filters.kt, Dto.kt, Preferences.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseHtml,
  substringAfter,
  substringBeforeLast,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";

// --- Dto.kt
interface LangDto {
  translators: string[];
  local_name: string;
  iso_code: string;
}
type LangsDto = Record<string, LangDto>;

// Stored as JSON in the LANG_DATA preference (upstream uses ProtoBuf + Base64)
interface LangData {
  key: string;
  name: string;
  progress: string;
  translators: string;
  title: string | null;
}

interface Lang {
  key: string;
  name: string;
  code: string;
  translators: string;
  translatedCount: number;
}

interface EpisodeDto {
  translated_languages: string[];
}

// --- Filters.kt
class LangFilter extends Filter.CheckBox {
  constructor(
    readonly key: string,
    name: string,
    state: boolean,
  ) {
    super(name, state);
  }
}

const TITLE = "Pepper&Carrot";
const AUTHOR = "David Revoy";

const LANG_PREF = "LANG";
const LANG_DATA_PREF = "LANG_DATA";
const LAST_UPDATED_PREF = "LAST_UPDATED";
const HI_RES_PREF = "HI_RES";

const dateRegex = /\d{4}-\d{2}-\d{2}/;
const dateRegexFull = /^\d{4}-\d{2}-\d{2}$/;
const dateRegexGlobal = /\d{4}-\d{2}-\d{2}/;

/** DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT).tryParseDate(date, ZoneOffset.UTC); 0 on failure. */
function tryParseDate(date: string | null | undefined): number {
  const m = date != null ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return 0;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).getUTCMonth() === Number(m[2]) - 1 ? t : 0;
}

const uppercaseFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export default class PepperCarrot extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // --- Preferences.kt
  private get isHiRes() {
    return this.preferences.getBoolean(HI_RES_PREF, false);
  }
  private get lastUpdated() {
    return this.preferences.getInt(LAST_UPDATED_PREF, 0);
  }
  private get langPref(): string[] {
    const lang = this.preferences.getString(LANG_PREF, "")!;
    if (lang.length === 0) return [];
    return lang.split(", ");
  }
  private setLang(value: Iterable<string>) {
    this.preferences.edit().putString(LANG_PREF, [...value].join(", ")).apply();
  }
  private get langData(): LangData[] {
    const data = this.preferences.getString(LANG_DATA_PREF, "")!;
    if (data.length === 0) return [];
    return JSON.parse(data) as LangData[];
  }

  private langDataMutex: Promise<unknown> = Promise.resolve();
  private updateLangData(): Promise<void> {
    const run = this.langDataMutex.then(() => this.doUpdateLangData());
    this.langDataMutex = run.catch(() => undefined);
    return run;
  }

  private async doUpdateLangData() {
    const baseUrl = this.baseUrl;
    const lastUpdated = Number.parseInt((await this.client.get(`${baseUrl}/0_sources/last_updated.txt`, this.headers)).text().split("\n")[0], 10);
    if (Number.isNaN(lastUpdated)) throw new Error("NumberFormatException");

    if (lastUpdated <= this.lastUpdated) return;

    const episodes = (await this.client.get(`${baseUrl}/0_sources/episodes.json`, this.headers)).parseAs<EpisodeDto[]>();

    const total = episodes.length;
    const translatedCount = new Map<string, number>();
    for (const e of episodes) for (const l of e.translated_languages) translatedCount.set(l, (translatedCount.get(l) ?? 0) + 1);

    // framagit.org is IP blocked in some countries
    let titles: Map<string, string> | null;
    try {
      titles = await this.fetchTitles();
    } catch {
      titles = null;
    }

    const langsDto = (await this.client.get(`${baseUrl}/0_sources/langs.json`, this.headers)).parseAs<LangsDto>();
    const all: Lang[] = Object.entries(langsDto)
      .map(([key, dto]) => ({
        key,
        name: dto.local_name,
        code: dto.iso_code.length === 0 ? key : dto.iso_code,
        translators: dto.translators.join(", "),
        translatedCount: translatedCount.get(key) ?? 0,
      }))
      .filter((it) => it.translatedCount > 0);
    const byCode = new Map<string, Lang[]>();
    for (const l of all) byCode.set(l.code, [...(byCode.get(l.code) ?? []), l]);
    const sorted = [...byCode.values()].flatMap((g) => g.sort((a, b) => b.translatedCount - a.translatedCount));

    let chosenLang: string[] | null = null;
    if (this.langPref.length === 0) chosenLang = this.chooseLang(sorted);

    const langs: LangData[] = sorted.map((it) => {
      const progress = `${it.translatedCount}/${total} translated`;
      return { key: it.key, name: it.name, progress, translators: it.translators, title: titles?.get(it.key) ?? (it.key === "en" ? TITLE : `${TITLE} (${it.key.toUpperCase()})`) };
    });

    // upstream's editor applies everything at once, only when nothing above threw
    const editor = this.preferences.edit().putInt(LAST_UPDATED_PREF, lastUpdated);
    if (chosenLang) editor.putString(LANG_PREF, chosenLang.join(", "));
    editor.putString(LANG_DATA_PREF, JSON.stringify(langs)).apply();
  }

  private chooseLang(langs: Lang[]): string[] | null {
    const language = "en"; // Locale.getDefault().language
    const result = langs.filter((it) => it.code === language).map((it) => it.key);
    if (result.length === 0) return null;
    if (language !== "en") result.push("en");
    return result;
  }

  /** Parser.unescapeEntities(s, false): textarea content is RCDATA, so only entities are decoded. */
  private unescapeEntities(s: string): string {
    return parseHtml(this.host.load, `<textarea>${s.replaceAll("</textarea", "&lt;/textarea")}</textarea>`, this.baseUrl).selectFirst("textarea")!.wholeText();
  }

  private async fetchTitles(): Promise<Map<string, string>> {
    const url = "https://framagit.org/search?project_id=76196&search=core/mod-header.php:4";
    const document = (await this.client.get(url, this.headers)).asJsoup();
    const result = new Map<string, string>();
    for (const file of document.selectFirst(".search-results")!.children()) {
      const filename = file.selectFirst("strong")!.ownText();
      if (!filename.endsWith(".po") || !filename.startsWith("po/")) continue;
      const lang = filename.substring(3, filename.length - 3);

      const lines = file.select(".line");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].ownText() === 'msgid "Pepper&amp;Carrot"' && i + 1 < lines.length) {
          let title = lines[i + 1].ownText();
          if (title.startsWith('msgstr "')) title = title.slice('msgstr "'.length);
          if (title.endsWith('"')) title = title.slice(0, -1);
          const unescaped = this.unescapeEntities(title).trim();
          if (unescaped.length > 0 && unescaped !== TITLE) result.set(lang, unescaped);
          break;
        }
      }
    }

    const groups = new Map<string, string[]>();
    for (const [k, v] of result) groups.set(v, [...(groups.get(v) ?? []), k]);
    for (const [title, keys] of groups) {
      if (keys.length === 1) continue;
      for (const k of keys) result.set(k, `${title} (${k.toUpperCase()})`);
    }
    return result;
  }

  // ============================== Popular ==============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    await this.updateLangData();
    const lang = this.langPref;
    if (lang.length === 0) throw new Error("Please select language in the filter");
    const langMap = new Map(this.langData.map((langData) => [langData.key, langData]));
    const mangas = lang.map((key) => this.langToSManga(langMap.get(key)!));
    const miniFantasyTheaters = lang.map((key) => this.getMiniFantasyTheaterEntry(langMap.get(key)!));

    return new MangasPage([...mangas, ...miniFantasyTheaters, ...this.getArtworkList()], false);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.length > 0) throw new Error("No search");
    this.saveFrom(filters);
    return this.getPopularManga(page);
  }

  private saveFrom(filters: FilterList) {
    const langFilters = filters.filter((f): f is LangFilter => f instanceof LangFilter);
    if (langFilters.length === 0) return;
    const selected = new Set(langFilters.filter((it) => it.state).map((it) => it.key));
    const result = new Set(this.langPref.filter((it) => selected.has(it)));
    for (const s of selected) result.add(s);
    this.setLang(result);
  }

  // ============================== Details ==============================

  override getMangaUrl(manga: SManga): string {
    const key = manga.url;
    if (key.startsWith("#")) return `${this.baseUrl}/en/files/${key.substring(1)}.html`; // artwork
    if (key.startsWith("miniFantasyTheater")) {
      const langKey = substringAfter(key, "#");
      return `${this.baseUrl}/${langKey}/webcomics/miniFantasyTheater.html`;
    }
    return `${this.baseUrl}/${key}/webcomics/peppercarrot.html`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    await this.updateLangData();

    const updatedManga = fetchDetails ? this.getMangaDetails(manga.url) : manga;
    const updatedChapters = fetchChapters ? await this.getChapterList(manga.url) : chapters;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private getMangaDetails(key: string): SManga {
    if (key.startsWith("#")) return this.getArtworkEntry(key.substring(1));
    if (key.startsWith("miniFantasyTheater")) {
      const langKey = substringAfter(key, "#");
      return this.getMiniFantasyTheaterEntry(this.langData.find((lang) => lang.key === langKey)!);
    }
    return this.langToSManga(this.langData.find((lang) => lang.key === key)!);
  }

  // ============================= Chapters ==============================

  private async getChapterList(key: string): Promise<SChapter[]> {
    let listUrl: string;
    if (key.startsWith("#")) {
      // artwork
      listUrl = `${this.baseUrl}/0_sources/0ther/${key.substring(1)}/low-res/`;
    } else if (key.startsWith("miniFantasyTheater")) {
      const langKey = substringAfter(key, "#");
      listUrl = `${this.baseUrl}/${langKey}/webcomics/miniFantasyTheater.html`;
    } else {
      listUrl = `${this.baseUrl}/${key}/webcomics/peppercarrot.html`;
    }
    // ponytail: upstream sends a Cache-Control (maxStale since last_updated) so OkHttp's cache can answer; we have no HTTP cache, always fetch
    const response = await this.client.get(listUrl, this.headers);

    if (new URL(response.url).pathname.split("/")[1] === "0_sources") return this.parseArtwork(response);

    const figures = response.asJsoup().select("figure");
    const translatedChapters = [...figures].map((it, i) => ({ number: figures.length - i, it })).filter((x) => x.it.hasClass("translated"));

    return translatedChapters.map(({ number, it }) => {
      const chapter = SChapter.create();
      const href = it.selectFirst("a")!.attr("href");
      chapter.url = href.startsWith(this.baseUrl) ? href.slice(this.baseUrl.length) : href;
      const title = it.selectFirst("img")!.attr("title");
      const index = title.lastIndexOf("（");
      chapter.name = (index >= 0 ? title.substring(0, index) : substringBeforeLast(title, "(")).trimEnd();
      const text = it.selectFirst("figcaption")?.text();
      chapter.date_upload = (text != null ? tryParseDate(dateRegexGlobal.exec(text)?.[0]) : 0) || 0;
      chapter.chapter_number = number;
      return chapter;
    });
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = chapter.url;
    if (url.endsWith(".jpg")) return [new Page(0, "", this.baseUrl + url)];

    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const urls = [...document.select(".webcomic-page img").map((it) => it.attr("src")), ...document.select(".mft-cv-image").map((it) => it.attr("src"))];

    if (urls.length === 0) return [];

    const thumbnail = urls[0].toLowerCase().includes("miniFantasyTheater".toLowerCase()) ? [] : [urls[0].replace("P00.jpg", ".jpg")];

    return [...thumbnail, ...urls].map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  override imageRequest(page: Page) {
    const url = page.imageUrl!;
    const newUrl = this.isHiRes ? url.replace("/low-res/", "/hi-res/") : url;
    return { ...super.imageRequest(page), url: newUrl };
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    const langData = this.langData;
    const list: Filter[] = [];
    if (langData.length === 0) {
      list.push(new Filter.Header("Tap 'Reset' to load languages"));
    } else {
      list.push(new Filter.Header("Languages"));
      const lang = new Set(this.langPref);
      for (const it of langData) list.push(new LangFilter(it.key, `${it.name} (${it.progress})`, lang.has(it.key)));
    }
    return FilterList(...list);
  }

  // ============================= Utilities =============================

  private getArtworkList(): SManga[] {
    return ["artworks", "wallpapers", "sketchbook", "misc", "book-publishing", "comissions", "eshop", "framasoft", "press", "references", "wiki"].map((k) => this.getArtworkEntry(k));
  }

  private getArtworkEntry(key: string): SManga {
    const m = SManga.create();
    m.url = `#${key}`;
    m.title = key === "comissions" ? "Commissions" : key === "eshop" ? "Shop" : uppercaseFirst(key);
    m.author = AUTHOR;
    m.status = SManga.ONGOING;
    m.thumbnail_url = `${this.baseUrl}/0_sources/0ther/press/low-res/2015-10-12_logo_by-David-Revoy.jpg`;
    m.initialized = true;
    return m;
  }

  private langToSManga(l: LangData): SManga {
    const m = SManga.create();
    m.url = l.key;
    m.title = l.title ?? (l.key === "en" ? TITLE : `${TITLE} (${l.key.toUpperCase()})`);
    m.author = AUTHOR;
    m.description = `Language: ${l.name}\nTranslators: ${l.translators}`;
    m.status = SManga.ONGOING;
    m.thumbnail_url = `${this.baseUrl}/0_sources/0ther/artworks/low-res/2016-02-24_vertical-cover_remake_by-David-Revoy.jpg`;
    m.initialized = true;
    return m;
  }

  private getMiniFantasyTheaterEntry(l: LangData): SManga {
    const m = SManga.create();
    m.url = `miniFantasyTheater#${l.key}`;
    m.title = "Mini Fantasy Theater" + (l.key !== "en" ? ` (${l.key.toUpperCase()})` : "");
    m.author = AUTHOR;
    m.description =
      "A webcomic series featuring short stories set in the enchanting world of Pepper&Carrot. With its playful humor and whimsical tales, this collection of gag strips is perfect for audiences of all ages.";
    m.status = SManga.ONGOING;
    m.thumbnail_url = `${this.baseUrl}/0_sources/0ther/artworks/low-res/2018-11-22_vertical-cover-book-three_by-David-Revoy.jpg`;
    m.initialized = true;
    return m;
  }

  private parseArtwork(response: Response): SChapter[] {
    const baseDir = response.url.startsWith(this.baseUrl) ? response.url.slice(this.baseUrl.length) : response.url;
    const chapters: SChapter[] = [];
    for (const it of [...response.asJsoup().select("a")].reverse()) {
      const filename = it.attr("href");
      if (!filename.endsWith(".jpg")) continue;

      let file = filename.slice(0, -".jpg".length);
      if (file.endsWith("_by-David-Revoy")) file = file.slice(0, -"_by-David-Revoy".length);
      let fileStripped: string;
      let date: number;
      if (file.length >= 10 && dateRegexFull.test(file.substring(0, 10))) {
        fileStripped = file.substring(10);
        date = tryParseDate(file.substring(0, 10));
      } else {
        fileStripped = file;
        const lastModified = it.nextSiblingText();
        date = tryParseDate(lastModified != null ? dateRegex.exec(lastModified)?.[0] : null);
      }
      const fileNormalized = uppercaseFirst(fileStripped.replaceAll("_", " ").replaceAll("-", " ").trim());

      const chapter = SChapter.create();
      chapter.url = baseDir + filename;
      chapter.name = fileNormalized;
      chapter.date_upload = date;
      chapter.chapter_number = -2;
      chapters.push(chapter);
    }
    return chapters;
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HI_RES_PREF;
    p.title = "High resolution images";
    p.summary = "Changes will not be applied to images that are already cached or downloaded " + "until you clear the chapter cache or delete the chapter download.";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
