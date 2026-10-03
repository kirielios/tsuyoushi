// Port of keiyoushi/extensions-source src/en/clowncorps/ClownCorps.kt
import {
  DateTimeFormatterBuilder,
  KeiSource,
  Locale,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseAs,
  toJsonString,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

const CREATOR = "Joe Chouinard";
const SETTING_KEY_SHOW_AUTHORS_NOTES = "showAuthorsNotes";
const CACHE_KEY_CHAPTERS = "chaptersCache";
const SETTING_KEY_CLEAR_CHAPTER_CACHE = "clearChapterCache";
const VALUE_CONFIRM = "yes";

interface SerializableChapter {
  fullLink: string;
  name: string;
  dateUpload: number;
}

const dateFormat = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("MMMM d, yyyy h:mm a").toFormatter(Locale.ENGLISH);

export default class ClownCorps extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(TextInterceptor());
  }

  private getManga(): SManga {
    const manga = SManga.create();
    manga.title = this.name;
    manga.artist = CREATOR;
    manga.author = CREATOR;
    manga.status = SManga.ONGOING;
    manga.initialized = true;
    // Image and description from: https://clowncorps.net/about/
    manga.thumbnail_url = `${this.baseUrl}/wp-content/uploads/2022/11/clowns41.jpg`;
    manga.description = "Clown Corps is a comic about crime-fighting clowns.\n" + 'It\'s pronounced "core." Like marine corps.';
    manga.url = "/comic";
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.getManga()], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(this.getManga(), chapters);
    this.applyClearCachePref();

    // The total number of webpages with chapters on them
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const currentPageIndicator = document.select("#paginav li.paginav-pages").text();
    const last = currentPageIndicator.split(" ").at(-1)!;
    if (!/^[+-]?\d+$/.test(last)) throw new Error(`For input string: "${last}"`);
    const totalWebpageCount = Number.parseInt(last, 10);

    // a set keyed by fullLink, like SerializableChapter.equals
    const allChapters = new Map<string, SerializableChapter>();
    for (const c of this.getChaptersFromCache()) allChapters.set(c.fullLink, c);
    // Fetch all the chapters from the website until we reached where the cache left off
    for (let webpageIndex = 1; webpageIndex <= totalWebpageCount; webpageIndex++) {
      const pageDoc = webpageIndex === 1 ? document : await this.fetchChapterWebpage(webpageIndex);
      let anyChaptersWereAdded = false;
      for (const c of this.extractChapters(pageDoc)) {
        if (!allChapters.has(c.fullLink)) {
          allChapters.set(c.fullLink, c);
          anyChaptersWereAdded = true;
        }
      }
      if (!anyChaptersWereAdded) break; // No new chapters were added from this webpage, so we're done
    }

    // Save the chapters to cache
    this.setChapterCache(toJsonString([...allChapters.values()]));

    // Convert the serializable chapters to SChapters
    const chapterList = [...allChapters.values()]
      .sort((a, b) => b.dateUpload - a.dateUpload)
      .map((c) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(c.fullLink);
        chapter.name = c.name;
        chapter.date_upload = c.dateUpload;
        return chapter;
      });

    return new SMangaUpdate(this.getManga(), chapterList);
  }

  private getChaptersFromCache(): SerializableChapter[] {
    const cachedChaps = this.getChapterCache();
    if (cachedChaps == null) return [];
    return parseAs<SerializableChapter[]>(cachedChaps);
  }

  private async fetchChapterWebpage(webpageIndex: number): Promise<Document> {
    return (await this.client.get(`${this.baseUrl}/comic/page/${webpageIndex}/`)).asJsoup();
  }

  private extractChapters(document: Document): SerializableChapter[] {
    return document.select(".comic").map((it) => {
      const link = it.selectFirst(".post-title a")!.attr("href");
      const title = it.selectFirst(".post-title a")!.text();
      const postDate = it.selectFirst(".post-date")!.text();
      const postTime = it.selectFirst(".post-time")!.text();
      const date = dateFormat.tryParseDateTime(`${postDate} ${postTime}`);
      return { fullLink: link, name: title, dateUpload: date };
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const doc = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pages: Page[] = [];

    const image = doc.selectFirst("#comic img");
    if (!image) return pages;

    pages.push(new Page(0, "", image.attr("src")));

    if (this.getShowAuthorsNotesPref()) {
      const title = image.attr("title");

      // Ignore chapters that don't really have author's notes
      if (/^chapter \d+ page \d+$/i.test(title)) return pages;

      const localURL = TextInterceptorHelper.createUrl(`Author's Notes from ${CREATOR}`, title);
      pages.push(new Page(pages.length, "", localURL));
    }

    return pages;
  }

  private getShowAuthorsNotesPref() {
    return this.preferences.getBoolean(SETTING_KEY_SHOW_AUTHORS_NOTES, false);
  }
  private getChapterCache() {
    return this.preferences.getString(CACHE_KEY_CHAPTERS, null);
  }
  private setChapterCache(json: string) {
    this.preferences.edit().putString(CACHE_KEY_CHAPTERS, json).apply();
  }
  private clearChapterCache() {
    this.preferences.edit().remove(CACHE_KEY_CHAPTERS).apply();
  }

  /**
   * Upstream's onPreferenceChange listener clears the cache right when "Yes, I'm sure" is ticked and never saves the
   * value. Our preference screen has no change listeners, so the ticked value is consumed here, on the next chapter fetch.
   */
  private applyClearCachePref() {
    if (this.preferences.getStringSet(SETTING_KEY_CLEAR_CHAPTER_CACHE).includes(VALUE_CONFIRM)) {
      this.clearChapterCache();
      this.preferences.edit().putStringSet(SETTING_KEY_CLEAR_CHAPTER_CACHE, []).apply();
    }
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const authorsNotesPref = new SwitchPreferenceCompat();
    authorsNotesPref.key = SETTING_KEY_SHOW_AUTHORS_NOTES;
    authorsNotesPref.title = "Show author's notes";
    authorsNotesPref.summary = "Enable to see the author's notes at the end of chapters (if they're there).";
    authorsNotesPref.setDefaultValue(false);
    screen.addPreference(authorsNotesPref);

    // A MultiSelectListPreference with a single option acts as a confirmation window (see applyClearCachePref).
    const clearCachePref = new MultiSelectListPreference();
    clearCachePref.key = SETTING_KEY_CLEAR_CHAPTER_CACHE;
    clearCachePref.title = "Clear chapter cache";
    clearCachePref.summary = "Clears the chapter cache, forcing a full re-fetch from the website.";
    clearCachePref.entries = ["Yes, I'm sure"];
    clearCachePref.entryValues = [VALUE_CONFIRM];
    clearCachePref.setDefaultValue([]);
    screen.addPreference(clearCachePref);
  }
}
