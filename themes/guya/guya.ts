// Port of keiyoushi/extensions-source lib-multisrc/guya/Guya.kt
import {
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  PreferenceScreen,
  SChapter,
  SManga,
  SMangaUpdate,
  parseHtml,
  type FilterList,
} from "../../sdk/index.ts";
import type { ChapterDto, SeriesDetailsDto, SeriesDto } from "./dto.ts";

export const SLUG_PREFIX = "slug:";
const SCANLATOR_PREFERENCE = "SCANLATOR_PREFERENCE";

export abstract class Guya extends KeiSource {
  // Upstream builds this from android.os.Build and the app version; fixed Android values stand in here.
  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", "(Android 14; Google Pixel 8) Tachiyomi/0.18.0 AP2A.240805.005");
    return headers;
  }

  // Scanlator id -> name, loaded while browsing so the preference screen can list them
  private scanlators: Record<string, string> = {};
  private scanlatorsJob: Promise<void> | null = null;

  private updateScanlators() {
    if (Object.keys(this.scanlators).length === 0 && this.scanlatorsJob == null) {
      this.scanlatorsJob = (async () => {
        try {
          this.scanlators = (await this.client.get(`${this.baseUrl}/api/get_all_groups/`)).parseAs<Record<string, string>>();
        } catch {
          this.scanlators = {};
        }
        this.scanlatorsJob = null;
      })();
    }
  }

  private async fetchAllSeries(): Promise<Record<string, SeriesDto>> {
    this.updateScanlators();
    return (await this.client.get(`${this.baseUrl}/api/get_all_series/`)).parseAs();
  }

  private async fetchSeries(slug: string): Promise<SeriesDetailsDto> {
    return (await this.client.get(`${this.baseUrl}/api/series/${slug}/`)).parseAs();
  }

  // Allows sources to limit which series are shown
  protected filterMangas(mangasPage: MangasPage): MangasPage {
    return mangasPage;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.filterMangas(this.parseManga(await this.fetchAllSeries()));
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const mangas = Object.entries(await this.fetchAllSeries())
      .sort((a, b) => (b[1].last_updated ?? -Infinity) - (a[1].last_updated ?? -Infinity))
      .map(([title, series]) => this.seriesToSManga(series, title));
    return this.filterMangas(new MangasPage(mangas, false));
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const series = await this.fetchAllSeries();
    let results: Record<string, SeriesDto>;
    if (query.startsWith(SLUG_PREFIX)) {
      const slug = query.slice(SLUG_PREFIX.length);
      results = Object.fromEntries(Object.entries(series).filter(([, it]) => it.slug === slug));
    } else {
      results = Object.fromEntries(Object.entries(series).filter(([key]) => key.toLowerCase().includes(query.toLowerCase())));
    }
    return this.filterMangas(this.parseManga(results));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const slug = url.pathname.slice(1).split("/")[2];
    if (slug == null) return null;
    return this.detailsToSManga(await this.fetchSeries(slug));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/reader/series/${manga.url}/`;
  }

  // Details and chapters come from the same response
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const series = await this.fetchSeries(manga.url);
    const details = this.detailsToSManga(series);
    details.title = manga.title;
    return new SMangaUpdate(details, this.parseChapterList(series, manga));
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/read/manga/${chapter.url.replaceAll(".", "-")}/1/`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const series = await this.fetchSeries(chapter.url.split("/")[0]);
    const chapterNum = chapter.name.split(" - ")[0];
    const chapterDto = series.chapters[chapterNum];
    if (!chapterDto) throw new Error(`Key ${chapterNum} is missing in the map.`);
    const scanlator = Object.entries(series.groups).find(([, v]) => v === chapter.scanlator)?.[0] ?? chapter.scanlator ?? "";
    const files = chapterDto.groups[scanlator];
    if (!files) throw new Error(`Key ${scanlator} is missing in the map.`);
    return files.map((filename, i) => new Page(i + 1, "", this.pageBuilder(series.slug, chapterDto.folder, filename, scanlator)));
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const scanlatorKeys = Object.keys(this.scanlators);

    const preference = new ListPreference(screen.context);
    preference.key = SCANLATOR_PREFERENCE;
    preference.title = "Preferred scanlator";
    preference.entries = scanlatorKeys.map((k) => this.scanlators[k]);
    preference.entryValues = scanlatorKeys;
    preference.summary =
      "Current: %s\n\n" +
      "This setting sets the scanlation group to prioritize " +
      "on chapter refresh/update. It will get the next available if " +
      "your preferred scanlator isn't an option (yet).";
    preference.setDefaultValue("1");

    screen.addPreference(preference);
  }

  // ------------- Helpers and whatnot ---------------

  private parseChapterList(series: SeriesDetailsDto, manga: SManga): SChapter[] {
    const chapterList: SChapter[] = [];

    // ponytail: JS objects list integer-like keys ("1", "2") before others ("10.5"), unlike Kotlin's LinkedHashMap,
    // so restore the API's ascending chapter order by number.
    const entries = Object.entries(series.chapters).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    for (const [chapterNum, chapterDto] of entries) {
      const sort = chapterDto.preferred_sort ?? series.preferred_sort;
      if (sort != null) {
        chapterList.push(this.parseChapterFromJson(chapterDto, chapterNum, sort, series));
      } else {
        for (const groupNum of Object.keys(chapterDto.groups)) {
          const chapter = SChapter.create();

          chapter.scanlator = series.groups[groupNum];
          const date = chapterDto.release_date?.[groupNum];
          if (date != null) chapter.date_upload = date * 1000;
          chapter.name = chapterNum + " - " + chapterDto.title;
          chapter.chapter_number = parseFloat(chapterNum);
          chapter.url = `${manga.url}/${chapterNum}`;
          chapterList.push(chapter);
        }
      }
    }

    return chapterList.reverse();
  }

  // Helper function to get all the listings
  private parseManga(payload: Record<string, SeriesDto>): MangasPage {
    return new MangasPage(
      Object.entries(payload).map(([title, series]) => this.seriesToSManga(series, title)),
      false,
    );
  }

  private seriesToSManga(series: SeriesDto, title: string): SManga {
    const it = SManga.create();
    it.title = title;
    it.artist = series.artist ?? undefined;
    it.author = series.author ?? undefined;
    it.description = series.description != null ? this.cleanDescription(series.description) : undefined;
    it.url = series.slug;
    it.thumbnail_url = series.cover != null ? this.toCoverUrl(series.cover) : undefined;
    return it;
  }

  private detailsToSManga(series: SeriesDetailsDto): SManga {
    const it = SManga.create();
    it.title = series.title;
    it.artist = series.artist ?? undefined;
    it.author = series.author ?? undefined;
    it.description = series.description != null ? this.cleanDescription(series.description) : undefined;
    it.url = series.slug;
    it.thumbnail_url = series.cover != null ? this.toCoverUrl(series.cover) : undefined;
    return it;
  }

  private cleanDescription(s: string): string {
    if (!s.includes("<")) return s; // no HTML
    const body = parseHtml(this.host.load, s, this.baseUrl);
    body.select("a").remove();
    return body.text();
  }

  private toCoverUrl(s: string): string | undefined {
    if (s.startsWith("http")) return s;
    if (s.length > 0) return `${this.baseUrl}/${s}`;
    return undefined;
  }

  private parseChapterFromJson(json: ChapterDto, num: string, sort: string[], series: SeriesDetailsDto): SChapter {
    const chapter = SChapter.create();

    // Get the scanlator info based on group ranking; do it first since we need it later
    const firstGroupId = this.getBestScanlator(Object.keys(json.groups), sort);
    chapter.scanlator = series.groups[firstGroupId] ?? firstGroupId;
    const date = json.release_date![firstGroupId];
    if (date == null) throw new Error(`Key ${firstGroupId} is missing in the map.`);
    chapter.date_upload = date * 1000;
    chapter.name = num + " - " + json.title;
    chapter.chapter_number = parseFloat(num);
    chapter.url = `${series.slug}/${num}`;

    return chapter;
  }

  private getBestScanlator(groups: string[], sort: string[]): string {
    const preferred = this.preferences.getString(SCANLATOR_PREFERENCE, null);

    if (preferred != null && groups.includes(preferred)) {
      return preferred;
    }
    // If all fails, fall-back to the next available key
    const found = sort.find((it) => groups.includes(it));
    if (found !== undefined) return found;
    if (groups.length === 0) throw new Error("Collection is empty.");
    return groups[0];
  }

  private pageBuilder(slug: string, folder: string, filename: string, groupId: string): string {
    return `${this.baseUrl}/media/manga/${slug}/chapters/${folder}/${groupId}/${filename}`;
  }
}
