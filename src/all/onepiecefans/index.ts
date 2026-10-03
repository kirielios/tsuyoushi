// Port of keiyoushi/extensions-source src/all/onepiecefans/OnePieceFans.kt
import { EditTextPreference, FilterList, KeiSource, MangasPage, Page, PreferenceScreen, SChapter, SManga, SMangaUpdate, toHttpUrlOrNull, type SharedPreferences } from "../../../sdk/index.ts";

interface Fansub {
  path: string;
  title: string;
}

const PREF_THUMBNAIL_URL = "pref_thumbnail_url";

export default class OnePieceFans extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private get internalLang(): string {
    return this.lang;
  }

  private get defaultThumbnailUrl(): string {
    return `${this.baseUrl}/images/luffy.png`;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const result = (await this.client.get(`${this.baseUrl}/fansubs-config.json`)).parseAs<Record<string, Fansub[]>>();

    const mangas =
      result[this.internalLang]?.map((fansub) => {
        const manga = SManga.create();
        manga.title = `One Piece (${fansub.title})`;
        manga.thumbnail_url = this.getThumbnailUrl(this.preferences);
        manga.url = fansub.path;
        manga.initialized = true;
        return manga;
      }) ?? [];

    return new MangasPage(mangas, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${this.internalLang}/${manga.url}`;
  }

  protected get chapterPrefix(): string {
    return "Chapter";
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const chapterNumbers = (await this.client.get(`${this.baseUrl}/server.php?lang=${this.internalLang}&folderName=${manga.url}`)).parseAs<string[]>();

    const newChapters = chapterNumbers.map((number) => {
      const chapter = SChapter.create();
      chapter.name = `${this.chapterPrefix} ${number}`;
      chapter.url = `${manga.url}/${number}`;
      return chapter;
    });

    return new SMangaUpdate(manga, newChapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/manga/${this.internalLang}/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const i = chapter.url.indexOf("/");
    const folderName = chapter.url.slice(0, i);
    const chapterNumber = chapter.url.slice(i + 1);
    const images = (await this.client.get(`${this.baseUrl}/server.php?lang=${this.internalLang}&folderName=${folderName}&chapter=${chapterNumber}`)).parseAs<string[]>();

    return images.map((fileName, index) => new Page(index, "", `${this.baseUrl}/mangafiles/${this.internalLang}/${folderName}/${chapterNumber}/${fileName}`));
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new EditTextPreference();
    p.key = PREF_THUMBNAIL_URL;
    p.title = "Thumbnail URL";
    p.summary = "Custom thumbnail image URL";
    p.dialogTitle = "Set Thumbnail URL";
    p.setDefaultValue(this.defaultThumbnailUrl);
    // upstream rejects an invalid value in the change listener (Toast "Invalid URL"); here it is ignored on read
    screen.addPreference(p);
  }

  private getThumbnailUrl(prefs: SharedPreferences): string {
    const value = prefs.getString(PREF_THUMBNAIL_URL, this.defaultThumbnailUrl)!;
    const v = value.trim();
    return v === "" || toHttpUrlOrNull(v) != null ? value : this.defaultThumbnailUrl;
  }
}
