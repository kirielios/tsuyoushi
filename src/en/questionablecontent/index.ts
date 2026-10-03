// Port of keiyoushi/extensions-source src/en/questionablecontent/QuestionableContent.kt
import {
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  distinctBy,
  urlWithoutDomain,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

const LAST_CHAPTER_URL = "QC_LAST_CHAPTER_URL";
const LAST_CHAPTER_DATE = "QC_LAST_CHAPTER_DATE";
const SHOW_AUTHORS_NOTES_KEY = "showAuthorsNotes";
const AUTHOR = "Jeph Jacques";
const URL_REGEX = /view\.php\?comic=(.*)/;
const LINK_TEXT_REGEX = /^See #(\d+): "(.*)" with newspost$/;

export default class QuestionableContent extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    builder.addChainInterceptor(TextInterceptor());
    // The site's zstd responses get cut off after the first frame, which truncates the archive page
    // ponytail: upstream is a network interceptor; here it rewrites the outgoing request (no redirect targets)
    builder.addInterceptor((request) => {
      const headers = new Headers(request.headers);
      headers.set("Accept-Encoding", "br, gzip");
      headers.delete("Origin");
      return { ...request, headers };
    });
    return builder;
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.title = this.name;
    manga.artist = AUTHOR;
    manga.author = AUTHOR;
    manga.status = SManga.ONGOING;
    manga.url = "/archive.php";
    manga.description = "An internet comic strip about romance and robots";
    manga.thumbnail_url = "https://i.ibb.co/ZVL9ncS/qc-teh.png";
    manga.initialized = true;
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.createManga() : manga;
    const chapterList = fetchChapters ? await this.fetchChapterList(manga) : chapters;

    return new SMangaUpdate(details, chapterList);
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const chapters = distinctBy(
      document.select('div#container a[href^="view.php?comic="]').map((element) => {
        const chapterUrl = element.attr("href");
        const number = URL_REGEX.exec(chapterUrl)![1];

        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(`/${chapterUrl}`);
        const text = element.text();
        const m = LINK_TEXT_REGEX.exec(text);
        chapter.name = m ? `${m[1]}: ${m[2]}` : text;
        chapter.chapter_number = Number.parseFloat(number);
        return chapter;
      }),
      (it) => it.url,
    );

    if (chapters.length > 0) {
      const firstChapter = chapters[0];
      if (firstChapter.url !== this.preferences.getString(LAST_CHAPTER_URL, null)) {
        const date = Date.now();
        firstChapter.date_upload = date;
        // ponytail: SharedPreferences has no putLong/getLong; the store holds plain numbers, so putInt/getInt carry the epoch ms
        this.preferences.edit().putString(LAST_CHAPTER_URL, firstChapter.url).putInt(LAST_CHAPTER_DATE, date).apply();
      } else {
        firstChapter.date_upload = this.preferences.getInt(LAST_CHAPTER_DATE, 0);
      }
    }

    return chapters;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pages = document.select("#strip").map((element, i) => new Page(i, "", element.absUrl("src")));

    if (this.showAuthorsNotesPref()) {
      const str = document.selectFirst("#newspost")?.html();
      if (str != null && str.length > 0) {
        pages.push(new Page(pages.length, "", TextInterceptorHelper.createUrl(`Author's Notes from ${AUTHOR}`, str)));
      }
    }
    return pages;
  }

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
