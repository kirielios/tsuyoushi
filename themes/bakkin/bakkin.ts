// Port of keiyoushi/extensions-source lib-multisrc/bakkin/BakkinReaderX.kt and BakkinJSON.kt
import { KeiSource, ListPreference, MangasPage, Page, SChapter, SManga, SMangaUpdate, isBlank, substringAfter, substringAfterLast, substringBefore, type FilterList, type PreferenceScreen } from "../../sdk/index.ts";

// BakkinJSON.kt
interface Chapter {
  dir: string;
  name: string;
  pages: string[];
}
interface Volume {
  dir: string;
  name: string;
  chapters: Chapter[];
}
interface Series {
  dir: string;
  name: string;
  author?: string | null;
  status?: string | null;
  thumb?: string | null;
  volumes: Volume[];
}

const chapterNumber = (c: Chapter) => {
  const s = substringAfterLast(c.dir, "c");
  return s.trim() !== "" && !isNaN(Number(s)) ? Number(s) : -1;
};
const nameOf = (it: { name: string; dir: string }) => it.name || it.dir;
const coverOf = (s: Series) => s.thumb ?? "static/nocover.png";
/** Series.iterator(): every chapter, named "<volume> - <chapter>" with its full "series/volume/chapter" dir. */
const chaptersOf = (s: Series): Chapter[] => s.volumes.flatMap((vol) => vol.chapters.map((it) => ({ ...it, name: `${nameOf(vol)} - ${nameOf(it)}`, dir: `${s.dir}/${vol.dir}/${it.dir}` })));

// ponytail: upstream reads Build.VERSION.RELEASE and the app version; there is no Android here, so they are fixed.
const userAgent = "Mozilla/5.0 (Android 14; Mobile) Tachiyomi/0.16.4";

export abstract class BakkinReaderX extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private get mainUrl(): string {
    return this.baseUrl + "main.php" + this.preferences.getString("quality", "");
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", userAgent);
    return headers;
  }

  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", []);
  }

  override getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  override async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const matches = (await this.fetchAllSeries()).filter((series) => isBlank(query) || nameOf(series).toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(
      matches.map((it) => this.toSManga(it)),
      false,
    );
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;

    // Reader links look like "<baseUrl>#m=<series>&v=<volume>&c=<chapter>"
    const m = url.hash
      .replace(/^#/, "")
      .split("&")
      .find((it) => it.startsWith("m="));
    if (!url.hash || m == null) return null;
    const seriesDir = substringAfter(m, "m=");

    const series = (await this.fetchAllSeries()).find((it) => it.dir === seriesDir);
    return series ? this.toSManga(series) : null;
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const series = await this.fetchSeries(manga.url);

    const chapterList = chaptersOf(series)
      .map((chapter) => {
        const c = SChapter.create();
        c.url = chapter.dir;
        c.name = nameOf(chapter);
        c.chapter_number = chapterNumber(chapter);
        return c;
      })
      .reverse();

    return new SMangaUpdate(this.toSManga(series), chapterList);
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const seriesDir = substringBefore(chapter.url, "/");
    const pages = chaptersOf(await this.fetchSeries(seriesDir)).find((it) => it.dir === chapter.url);
    if (!pages) throw new Error("Collection contains no element matching the predicate.");

    return pages.pages.map((path, index) => new Page(index, "", this.baseUrl + path));
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}#m=${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const [m, v, c] = chapter.url.split("/");
    return `${this.baseUrl}#m=${m}&v=${v}&c=${c}`;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new ListPreference(screen.context);
    p.key = "quality";
    p.summary = "%s";
    p.title = "Image quality";
    p.entries = ["Original", "Compressed"];
    p.entryValues = ["?fullsize", ""];
    p.setDefaultValue("");
    screen.addPreference(p);
  }

  private seriesCache: Series[] = [];

  private async fetchAllSeries(): Promise<Series[]> {
    if (!this.seriesCache.length) {
      this.seriesCache = Object.values((await this.client.get(this.mainUrl)).parseAs<Record<string, Series>>());
    }
    return this.seriesCache;
  }

  private async fetchSeries(dir: string): Promise<Series> {
    const series = (await this.fetchAllSeries()).find((it) => it.dir === dir);
    if (!series) throw new Error("Collection contains no element matching the predicate.");
    return series;
  }

  private toSManga(series: Series): SManga {
    const manga = SManga.create();
    manga.url = series.dir;
    manga.title = nameOf(series);
    manga.thumbnail_url = this.baseUrl + coverOf(series);
    manga.author = series.author ?? undefined;
    manga.status = series.status === "Ongoing" ? SManga.ONGOING : series.status === "Completed" ? SManga.COMPLETED : SManga.UNKNOWN;
    return manga;
  }
}
