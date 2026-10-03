// Port of keiyoushi/extensions-source src/en/silentquill/SilentQuill.kt (+ Filters.kt, Dto.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ago,
  extractNextJs,
  extractNextJsFromDocument,
  firstInstanceOrNull,
  hasKeys,
  substringAfter,
  substringBefore,
  toHttpUrl,
  type FilterList as FilterListType,
  type Response,
} from "../../../sdk/index.ts";

// --- Filters.kt
class SelectFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}
class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
    ]);
  }
}
class GenreFilter extends SelectFilter {
  constructor() {
    super("Genres", [
      ["All", ""], ["Comedy", "comedy"], ["Fantasy", "fantasy"], ["Romance", "romance"], ["School Life", "school-life"],
      ["Shounen", "shounen"], ["Harem", "harem"], ["Ecchi", "ecchi"], ["Action", "action"], ["Seinen", "seinen"],
      ["Adventure", "adventure"], ["Drama", "drama"], ["Completed", "completed"], ["Adult", "adult"],
      ["Slice of Life", "slice-of-life"], ["Erotica", "erotica"], ["isekai", "isekai"], ["Mature", "mature"],
      ["Supernatural", "supernatural"], ["Mystery", "mystery"], ["Psychological", "psychological"],
      ["Sexual Violence", "sexual-violence"], ["Demons", "demons"], ["Magic", "magic"], ["Sci-fi", "sci-fi"],
      ["Adaptation", "adaptation"], ["Gender Bender", "gender-bender"], ["Gyaru", "gyaru"], ["Monsters", "monsters"],
      ["Reincarnation", "reincarnation"], ["Sports", "sports"], ["Tragedy", "tragedy"], ["Web Comic", "web-comic"],
      ["Ghosts", "ghosts"], ["Gore", "gore"], ["Horror", "horror"], ["Josei", "josei"], ["Monster Girls", "monster-girls"],
      ["One-shot", "one-shot"], ["Shoujo", "shoujo"], ["Survival", "survival"], ["Zombies", "zombies"], ["Aliens", "aliens"],
      ["Delinquents", "delinquents"], ["Full Color", "full-color"], ["Genderswap", "genderswap"], ["Girls' Love", "girls-love"],
      ["Hentai", "hentai"], ["Historical", "historical"], ["Martial Arts", "martial-arts"], ["Mecha", "mecha"],
      ["Myster", "myster"], ["Smut", "smut"], ["Suggestive", "suggestive"], ["Thriller", "thriller"],
      ["Video Games", "video-games"],
    ]);
  }
}

// --- Dto.kt
interface ChapterResponse {
  chapter_no: string;
  id: number;
  slug: string;
  time_ago: string;
}
interface ViewerResponse {
  pages: { url: string }[];
}

const CHAPTER_NUMBER_REGEX = /^\d+(?:\.\d+)?/;
const RELATIVE_DATE_REGEX = /(\d+)\s+(minute|hour|day|week|month|year)s?/;

function toSChapter(it: ChapterResponse, mangaSlug: string): SChapter {
  const c = SChapter.create();
  c.url = String(it.id);
  c.name = `Chapter ${it.chapter_no}`;
  c.chapter_number = CHAPTER_NUMBER_REGEX.exec(it.chapter_no) ? Number.parseFloat(CHAPTER_NUMBER_REGEX.exec(it.chapter_no)![0]) : -1;
  c.date_upload = toRelativeDate(it.time_ago);
  c.memo = { slug: it.slug, mangaSlug };
  return c;
}

function toRelativeDate(s: string): number {
  const m = RELATIVE_DATE_REGEX.exec(s);
  if (!m) return 0;
  return ago(Number.parseInt(m[1], 10), `${m[2]}s` as "minutes" | "hours" | "days" | "weeks" | "months" | "years");
}

// --- JsonObject helpers (keiyoushi.utils.getStringOrNull, getArrayOrNull, getString)
type Json = unknown;
type JsonObject = Record<string, Json>;
const isObject = (e: Json): e is JsonObject => typeof e === "object" && e !== null && !Array.isArray(e);
const getStringOrNull = (o: JsonObject, k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
const getString = (o: JsonObject, k: string): string => {
  const v = getStringOrNull(o, k);
  if (v == null) throw new Error(`Missing string "${k}"`);
  return v;
};
const getArrayOrNull = (o: JsonObject, k: string): Json[] | null => (Array.isArray(o[k]) ? (o[k] as Json[]) : null);

function firstObjectOrNull(el: Json, predicate: (o: JsonObject) => boolean): JsonObject | null {
  if (isObject(el)) {
    if (predicate(el)) return el;
    for (const v of Object.values(el)) {
      const r = firstObjectOrNull(v, predicate);
      if (r != null) return r;
    }
    return null;
  }
  if (Array.isArray(el)) {
    for (const v of el) {
      const r = firstObjectOrNull(v, predicate);
      if (r != null) return r;
    }
  }
  return null;
}

// --- SilentQuill.kt
export default class SilentQuill extends KeiSource {
  private get rscHeaders() {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(this.baseUrl, this.rscHeaders), (element) => {
      return (
        isObject(element) &&
        getStringOrNull(element, "className")?.includes("grid-cols-4") === true &&
        firstObjectOrNull(element, (o) => getStringOrNull(o, "href") != null) != null
      );
    });
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const status = firstInstanceOrNull(filters, StatusFilter)?.value;
    const genre = firstInstanceOrNull(filters, GenreFilter)?.value;
    const b = toHttpUrl(`${this.baseUrl}/search/`)!.newBuilder();
    if (status) b.addQueryParameter("status", status);
    if (genre) b.addQueryParameter("genre", genre);
    b.addQueryParameter("q", query);
    b.addQueryParameter("page", String(page));
    const searchUrl = b.build();

    return this.toMangasPage(
      await this.client.get(searchUrl.toString(), this.rscHeaders),
      (element) => isObject(element) && firstObjectOrNull(element, (o) => getStringOrNull(o, "src") != null && getStringOrNull(o, "alt") != null) != null,
      (it) => firstObjectOrNull(it, (o) => getStringOrNull(o, "href")?.includes(`page=${page + 1}`) === true) != null,
      (it) => {
        const o = firstObjectOrNull(it, (obj) => getStringOrNull(obj, "className")?.includes("grid-cols") === true);
        return o ? getArrayOrNull(o, "children") : null;
      },
    );
  }

  private toMangasPage(
    response: Response,
    predicate: (element: Json) => boolean,
    hasNextPage: (o: JsonObject) => boolean = () => false,
    cards: (o: JsonObject) => Json[] | null = (it) => getArrayOrNull(it, "children"),
  ): MangasPage {
    const container = extractNextJs<JsonObject>(response, predicate);
    const mangas = ((container ? cards(container) : null) ?? []).map((card) => {
      const img = firstObjectOrNull(card, (it) => getStringOrNull(it, "src") != null && getStringOrNull(it, "alt") != null)!;
      const href = getString(firstObjectOrNull(card, (it) => getStringOrNull(it, "href") != null)!, "href");

      const manga = SManga.create();
      manga.url = new URL(this.baseUrl + href).pathname.split("/")[2];
      manga.title = getString(img, "alt");
      manga.thumbnail_url = this.baseUrl + getString(img, "src");
      return manga;
    });

    return new MangasPage(mangas, container ? hasNextPage(container) : false);
  }

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new StatusFilter(), new GenreFilter());
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    // List<ChapterResponse>: the first non-empty array of chapter objects
    const updatedChapters = (
      extractNextJsFromDocument<ChapterResponse[]>(document, (it) => Array.isArray(it) && it.length > 0 && it.every(hasKeys("chapter_no", "id", "slug", "time_ago"))) ?? []
    )
      .map((it) => toSChapter(it, manga.url))
      .sort((a, b) => b.chapter_number - a.chapter_number);

    const authorLine = document.selectFirst("p.mt-2.text-sm.text-ink-dim")?.textOrNull() ?? undefined;
    const state = document.selectFirst("dt:containsOwn(Status)")?.nextElementSibling()?.textOrNull() ?? undefined;
    const mangas = SManga.create();
    mangas.title = document.selectFirst("h1")!.text();
    mangas.author = authorLine == null ? undefined : substringBefore(authorLine, " · art by ");
    mangas.artist = authorLine == null ? undefined : substringAfter(authorLine, " · art by ", "") || undefined;
    mangas.description = document.selectFirst("div.reader-content")?.textOrNull() ?? undefined;
    mangas.genre = document.select("a[href^=/search/?genre=]").eachText().join(", ");
    switch (state?.toLowerCase()) {
      case "ongoing":
        mangas.status = SManga.ONGOING;
        break;
      case "completed":
        mangas.status = SManga.COMPLETED;
        break;
      default:
        mangas.status = SManga.UNKNOWN;
    }
    mangas.thumbnail_url = document.selectFirst("main img[src^=/img/]")?.absUrl("src");

    return new SMangaUpdate(mangas, updatedChapters);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const result = extractNextJs<ViewerResponse>(await this.client.get(this.getChapterUrl(chapter), this.rscHeaders), (it) => hasKeys("pages")(it) && Array.isArray((it as JsonObject).pages));
    return (result?.pages ?? []).map((url, index) => new Page(index, "", this.baseUrl + url.url));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}/`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/series/${chapter.memo["mangaSlug"] as string}/${chapter.memo["slug"] as string}/`;
  }
}
