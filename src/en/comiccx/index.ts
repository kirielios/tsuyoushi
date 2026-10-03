// Port of keiyoushi/extensions-source src/en/comiccx/ComicCX.kt (+ Dto.kt)
import {
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isBlank,
  parseAs,
  substringAfter,
  substringBefore,
  tryParseInstant,
  type ClientBuilder,
} from "../../../sdk/index.ts";
import { DataImageInterceptor } from "../../../libs/dataimage/index.ts";

// ---- Dto.kt
interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
interface MangaListResponse {
  manga?: MangaItem[];
  pagination?: Pagination | null;
}
interface MangaItem {
  id: number;
  title: string;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  cover_image?: string | null;
  genres?: string[] | null;
  slug: string;
  required_tier?: string | null;
  tier?: string | null;
}
interface ChapterItem {
  id: number;
  chapter_number: number;
  title?: string | null;
  created_at?: string | null;
  pages?: string[];
}

function resolveCoverUrl(cover: string | null | undefined, baseUrl: string): string | undefined {
  if (isBlank(cover)) return undefined;
  if (cover.startsWith("data:")) return "https://127.0.0.1/?" + substringAfter(cover, ":");
  if (cover.startsWith("/")) return `${baseUrl}${cover}`;
  return cover;
}

function mangaToSManga(it: MangaItem, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = it.slug;
  manga.title = it.title;
  manga.thumbnail_url = resolveCoverUrl(it.cover_image, baseUrl);
  manga.author = it.author ?? undefined;
  manga.artist = it.artist ?? undefined;
  manga.genre = it.genres?.join(", ");
  const status = it.status?.toLowerCase();
  manga.status = status === "ongoing" ? SManga.ONGOING : status === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;
  let description = "";
  if (!isBlank(it.description)) description += it.description;
  const effectiveTier = it.required_tier ?? it.tier;
  if (!isBlank(effectiveTier) && effectiveTier !== "free" && effectiveTier !== "tier_0") {
    if (description.length > 0) description += "\n\n";
    description += `⚠ This title requires ${effectiveTier.replaceAll("_", " ").toUpperCase()} access. Log in via WebView to read.`;
  }
  manga.description = description;
  return manga;
}

const numStr = (n: number) => (n % 1 === 0 ? String(Math.trunc(n)) : String(n));

function chapterToSChapter(it: ChapterItem, mangaSlug: string): SChapter {
  const chapter = SChapter.create();
  chapter.url = `${mangaSlug}/${it.id}`;
  let name = `Chapter ${numStr(it.chapter_number)}`;
  if (!isBlank(it.title)) name += ` - ${it.title}`;
  chapter.name = name;
  chapter.chapter_number = it.chapter_number;
  chapter.date_upload = tryParseInstant(it.created_at);
  return chapter;
}

export default class ComicCX extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(DataImageInterceptor());
  }

  // =============================== MangasPage ===========================
  getPopularManga(page: number) {
    return this.getCatalog(page, "popularity");
  }
  getLatestUpdates(page: number) {
    return this.getCatalog(page, "latest");
  }
  getSearchMangaList(page: number, query: string, _filters: FilterList) {
    return this.getCatalog(page, undefined, query);
  }

  private async getCatalog(page: number, sort?: string, query = ""): Promise<MangasPage> {
    const b = HttpUrl.parse(`${this.apiUrl}/manga`).newBuilder().addQueryParameter("limit", "100").addQueryParameter("page", String(page));
    if (sort) b.addQueryParameter("sort", sort);
    if (!isBlank(query)) b.addQueryParameter("search", query);

    const data = (await this.client.get(b.build().toString())).parseAs<MangaListResponse>();
    const mangas = (data.manga ?? []).map((it) => mangaToSManga(it, this.baseUrl));
    const hasNextPage = (data.pagination?.page ?? 1) < (data.pagination?.pages ?? 1);
    return new MangasPage(mangas, hasNextPage);
  }

  // =========================== MangaUpdates =============================
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = manga.url;
    const [updatedManga, updatedChapters] = await Promise.all([
      (async () => (fetchDetails ? mangaToSManga((await this.client.get(`${this.apiUrl}/manga/${slug}`)).parseAs<MangaItem>(), this.baseUrl) : manga))(),
      (async () =>
        fetchChapters
          ? (await this.client.get(`${this.apiUrl}/manga/${slug}/chapters`)).parseAs<ChapterItem[]>().sort((a, b) => b.chapter_number - a.chapter_number).map((it) => chapterToSChapter(it, slug))
          : chapters)(),
    ]);
    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const slug = substringBefore(chapter.url, "/");
    return `${this.baseUrl}/manga/${slug}/reader/${numStr(chapter.chapter_number)}`;
  }

  // =============================== Pages ==================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = substringBefore(chapter.url, "/");
    const id = Number.parseInt(substringAfter(chapter.url, "/"), 10);
    if (Number.isNaN(id)) throw new Error(`For input string: "${substringAfter(chapter.url, "/")}"`);

    const url = HttpUrl.parse(`${this.apiUrl}/manga/${slug}/chapters`).newBuilder().addQueryParameter("chapter_id", String(id)).build();
    const chapters = (await this.client.get(url.toString())).parseAs<ChapterItem[]>();

    const found = chapters.find((it) => it.id === id);
    if (!found) throw new Error("Chapter not found");
    return (found.pages ?? []).map((url, index) => new Page(index, "", this.resolveImageUrl(url)));
  }

  // ============================= Utilities ================================
  private resolveImageUrl(url: string | null | undefined): string {
    if (isBlank(url)) return "";
    return url.startsWith("/") ? `${this.baseUrl}${url}` : url;
  }
}
