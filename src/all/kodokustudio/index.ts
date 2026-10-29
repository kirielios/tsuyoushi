// Port of keiyoushi/extensions-source src/all/kodokustudio/KodokuStudio.kt and Dto.kt
import {
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

type SeriesDto = { slug: string; title: string; description?: string | null; coverUrl?: string | null };
type ChapterEntryDto = { chapterNumber: string; languageCode: string; available?: boolean; uploadedAt?: string | null; availableAt?: string | null };
type ChapterDetailDto = { images?: { sequence?: number; url: string }[] };

const SLUG = "reverend-insanity";
const SHOW_LOCKED = "pref_show_locked";
const LANG_ORDER = ["en", "ar", "tr", "ru", "vi"];

/** Instant.tryParse: ISO-8601 to epoch ms, 0 when missing or invalid. */
const tryParseInstant = (s: string) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};

function toSManga(dto: SeriesDto, languageCode: string): SManga {
  const manga = SManga.create();
  manga.url = `${dto.slug}/${languageCode}`;
  manga.title = `${dto.title} [${languageCode.toUpperCase()}]`;
  manga.thumbnail_url = dto.coverUrl ?? undefined;
  manga.description = dto.description ?? undefined;
  manga.status = SManga.ONGOING;
  return manga;
}

function toSChapter(dto: ChapterEntryDto): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${dto.chapterNumber}/${dto.languageCode}`;
  chapter.name = `${dto.available ? "" : "🔒 "}Chapter ${dto.chapterNumber}`;
  const n = parseFloat(dto.chapterNumber);
  chapter.chapter_number = Number.isNaN(n) ? 0 : n;
  chapter.date_upload = tryParseInstant(dto.availableAt ?? dto.uploadedAt ?? "");
  return chapter;
}

const substringBefore = (s: string, d: string) => (s.includes(d) ? s.slice(0, s.indexOf(d)) : s);
const substringAfter = (s: string, d: string, missing: string) => (s.includes(d) ? s.slice(s.indexOf(d) + d.length) : missing);

export default class KodokuStudio extends KeiSource {
  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  override async getPopularManga(_page: number): Promise<MangasPage> {
    const [series, chapters] = await Promise.all([
      this.client.get(`${this.baseUrl}/api/series`).then((r) => r.parseAs<SeriesDto[]>()),
      this.client.get(`${this.baseUrl}/api/series/${SLUG}/chapters`).then((r) => r.parseAs<ChapterEntryDto[]>()),
    ]);
    const detail = series.find((it) => it.slug === SLUG);
    if (!detail) throw new Error("Collection contains no element matching the predicate.");
    const rank = (code: string) => (LANG_ORDER.indexOf(code) >= 0 ? LANG_ORDER.indexOf(code) : Number.MAX_SAFE_INTEGER);
    const mangas = [...new Set(chapters.map((it) => it.languageCode))].sort((a, b) => rank(a) - rank(b)).map((it) => toSManga(detail, it));
    return new MangasPage(mangas, false);
  }

  override async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas = (await this.getPopularManga(page)).mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(mangas, false);
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringBefore(manga.url, "/");
    const lang = substringAfter(manga.url, "/", "en");
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(`${this.baseUrl}/api/series/${slug}`).then((r) => toSManga(r.parseAs<SeriesDto>(), lang)) : manga,
      fetchChapters
        ? this.client.get(`${this.baseUrl}/api/series/${slug}/chapters`).then((r) => {
            const showLocked = this.preferences.getBoolean(SHOW_LOCKED, false);
            return r
              .parseAs<ChapterEntryDto[]>()
              .filter((it) => it.languageCode === lang && (showLocked || it.available))
              .map(toSChapter)
              .sort((a, b) => b.chapter_number - a.chapter_number);
          })
        : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(`${this.baseUrl}/api/series/${SLUG}/chapters/${chapter.url}`, undefined, { ensureSuccess: false });
    if (response.code === 403) return [];
    return [...(response.parseAs<ChapterDetailDto>().images ?? [])]
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((image, index) => new Page(index, "", image.url));
  }

  override getMangaUrl(_manga: SManga): string {
    return `${this.baseUrl}/manhwa/${SLUG}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const [number, lang] = chapter.url.split("/");
    return `${this.baseUrl}/read/${SLUG}/${lang}/${number}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const first = segments[0];
    const slug = first === "manhwa" || first === "read" ? segments[1] : undefined;
    if (slug == null) return null;
    const lang = (first === "read" ? segments[2] : undefined) ?? "en";
    const response = await this.client.get(`${this.baseUrl}/api/series/${slug}`, undefined, { ensureSuccess: false });
    if (response.code === 404) return null;
    return toSManga(response.parseAs<SeriesDto>(), lang);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const it = new SwitchPreferenceCompat(screen.context);
    it.key = SHOW_LOCKED;
    it.title = "Show locked chapters";
    it.summary = "Locked chapters require Patreon access to read";
    it.setDefaultValue(false);
    screen.addPreference(it);
  }
}
