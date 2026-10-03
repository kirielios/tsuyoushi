// Port of keiyoushi/extensions-source src/en/grrlpower/GrrlPower.kt
import {
  DateTimeFormatterBuilder,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  urlWithoutDomain,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

const SHOW_AUTHORS_NOTES_KEY = "showAuthorsNotes";

const dateFormat = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("MMM d yyyy").toFormatter(Locale.US);

export default class GrrlPower extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private readonly comicAuthor = "David Barrack";
  private readonly startingYear = 2010;
  private readonly currentYear = new Date().getFullYear();

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(TextInterceptor());
  }

  // ============================== Popular ==============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = SManga.create();
    manga.artist = this.comicAuthor;
    manga.author = this.comicAuthor;
    manga.description = "Grrl Power is a comic about a crazy nerdette that becomes a superheroine. Humor, action, cheesecake, beefcake, 'explosions, and maybe some drama. Possibly ninjas.";
    manga.genre = "superhero, humor, action";
    manga.initialized = true;
    manga.status = SManga.ONGOING;
    manga.thumbnail_url = "https://static.tvtropes.org/pmwiki/pub/images/rsz_grrl_power.png";
    manga.title = "Grrl Power";
    manga.url = "/archive";
    return new MangasPage([manga], false);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================= Chapters ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const chapterList: SChapter[] = [];
    for (let year = this.startingYear; year <= this.currentYear; year++) {
      const document = (await this.client.get(`${this.baseUrl}/archive/?archive_year=${year}`)).asJsoup();
      for (const it of document.select(".archive-date")) {
        const dateStr = `${it.text()} ${year}`;
        const link = it.nextElementSibling()!.children()[0];
        const chapter = SChapter.create();
        chapter.name = link.text();
        chapter.url = urlWithoutDomain(link.absUrl("href"));
        chapter.date_upload = dateFormat.tryParseDate(dateStr);
        chapterList.push(chapter);
      }
    }
    chapterList.sort((a, b) => b.date_upload - a.date_upload);

    return new SMangaUpdate(manga, chapterList);
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const soup = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pages: Page[] = [];

    const comicImg = soup.selectFirst("div#comic img");
    if (comicImg != null) {
      pages.push(new Page(0, soup.location(), comicImg.absUrl("src")));
    }

    const text = soup.select(".entry").html();
    if (text.length > 0 && this.showAuthorsNotesPref()) {
      pages.push(new Page(pages.length, "", TextInterceptorHelper.createUrl(`Author's Notes from ${this.comicAuthor}`, text)));
    }

    return pages;
  }

  // ============================ Preferences ============================

  private showAuthorsNotesPref() {
    return this.preferences.getBoolean(SHOW_AUTHORS_NOTES_KEY, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const authorsNotesPref = new SwitchPreferenceCompat(screen.context);
    authorsNotesPref.key = SHOW_AUTHORS_NOTES_KEY;
    authorsNotesPref.title = "Show author's notes";
    authorsNotesPref.summary = "Enable to see the author's notes at the end of chapters (if they're there).";
    authorsNotesPref.setDefaultValue(false);
    screen.addPreference(authorsNotesPref);
  }
}
