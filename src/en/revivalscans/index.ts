// Port of keiyoushi/extensions-source src/en/revivalscans/RevivalScans.kt (+ Dto.kt)
import {
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  extractNextJs,
  hasKeys,
  tryParseInstant,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

// ---- Dto.kt
function parseStatus(status: string | null | undefined): number {
  switch (status?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    default:
      return SManga.UNKNOWN;
  }
}

interface SeriesResponseDto {
  series: SeriesDto[];
}
interface SeriesDto {
  id: string;
  title: string;
  coverImage?: string | null;
  status?: string | null;
}
function seriesToSManga(s: SeriesDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = s.title;
  manga.url = s.id;
  manga.thumbnail_url = s.coverImage != null ? `${baseUrl}${s.coverImage}` : undefined;
  manga.status = parseStatus(s.status);
  return manga;
}

interface ManhwaResponseDto {
  manhwa: ManhwaDto;
}
interface ManhwaDto {
  id: string;
  title: string;
  coverImage?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string[] | null;
  status?: string | null;
  chapters?: ChapterDto[] | null;
}
interface ChapterDto {
  id: string;
  number: number;
  title?: string | null;
  releaseDate?: string | null;
  accessRoles?: string[] | null;
}
const isPremium = (c: ChapterDto) => c.accessRoles != null && !c.accessRoles.includes("reader");

function manhwaToSManga(m: ManhwaDto, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.title = m.title;
  manga.url = m.id;
  manga.thumbnail_url = m.coverImage != null ? `${baseUrl}${m.coverImage}` : undefined;
  manga.description = m.description ?? undefined;
  manga.author = m.author ?? undefined;
  manga.artist = m.artist ?? undefined;
  manga.genre = m.genres?.join(", ");
  manga.status = parseStatus(m.status);
  manga.initialized = true;
  return manga;
}

function chapterToSChapter(c: ChapterDto, seriesId: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `/read/${seriesId}/${c.id}`;
  const chapterName = c.title ?? `Chapter ${String(c.number).replace(/\.0$/, "")}`;
  chapter.name = isPremium(c) ? `🔒 ${chapterName}` : chapterName;
  chapter.chapter_number = c.number;
  chapter.date_upload = tryParseInstant(c.releaseDate);
  return chapter;
}

function toSChapterList(m: ManhwaDto, showPremium: boolean): SChapter[] {
  return (m.chapters ?? [])
    .filter((it) => showPremium || !isPremium(it))
    .map((it) => chapterToSChapter(it, m.id))
    .sort((a, b) => b.chapter_number - a.chapter_number);
}

interface PagesResponseDto {
  pages: { url: string }[];
}

const PREF_SHOW_PREMIUM = "pref_show_premium";
const PREF_SHOW_PREMIUM_DEFAULT = false;

export default class RevivalScans extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private get apiHeaders(): Headers {
    const h = new Headers(this.headers);
    h.append("RSC", "1");
    return h;
  }

  // ============================== Popular ==============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    const dto = extractNextJs<SeriesResponseDto>(await this.client.get(`${this.baseUrl}/series`, this.apiHeaders), hasKeys("series"));
    if (!dto) throw new Error("Failed to extract popular manga");
    return new MangasPage(
      dto.series.map((it) => seriesToSManga(it, this.baseUrl)),
      false,
    );
  }

  // ============================== Latest ===============================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================
  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const filtered = (await this.getPopularManga(page)).mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(filtered, false);
  }

  // ============================== Details ==============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const dto = extractNextJs<ManhwaResponseDto>(await this.client.get(`${this.baseUrl}/series/${manga.url}`, this.apiHeaders), hasKeys("manhwa"));
    if (!dto) throw new Error("Failed to extract manga details");

    const showPremium = this.preferences.getBoolean(PREF_SHOW_PREMIUM, PREF_SHOW_PREMIUM_DEFAULT);
    return new SMangaUpdate(manhwaToSManga(dto.manhwa, this.baseUrl), toSChapterList(dto.manhwa, showPremium));
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const dto = extractNextJs<PagesResponseDto>(await this.client.get(this.baseUrl + chapter.url, this.apiHeaders), hasKeys("pages"));
    if (!dto) throw new Error("Failed to extract pages");

    return dto.pages.map((pageDto, index) => new Page(index, "", pageDto.url.startsWith("http") ? pageDto.url : this.baseUrl + pageDto.url));
  }

  // ============================= Utilities =============================
  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat();
    p.key = PREF_SHOW_PREMIUM;
    p.title = "Show premium chapters";
    p.summary = "Show chapters that require a paid subscription to read. (Note: These chapters cannot be read through the extension without an active subscription.)";
    p.setDefaultValue(PREF_SHOW_PREMIUM_DEFAULT);
    screen.addPreference(p);
  }
}
